const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

class TemplateController {
    // Get template(s) - supports latest, specific version, or history
    async getTemplate(req, res, next) {
        try {
            const { username, templateType, version, includeHistory } = req.query;

            if (!username || !templateType) {
                return res.status(400).json({
                    error: 'Missing required query parameters: username, templateType'
                });
            }

            const validTypes = ['conceptMentor', 'assessmentPrompt', 'defaultTemplateValues'];
            if (!validTypes.includes(templateType)) {
                return res.status(400).json({
                    error: `Invalid templateType. Must be one of: ${validTypes.join(', ')}`
                });
            }

            let query, params;

            if (version) {
                // Get specific version
                query = `
                    SELECT id, username, template_type, content, version, is_active, created_at, updated_at
                    FROM prompt_templates 
                    WHERE username = $1 AND template_type = $2 AND version = $3
                `;
                params = [username, templateType, parseInt(version)];
            } else if (includeHistory === 'true') {
                // Get all versions (history)
                query = `
                    SELECT id, username, template_type, content, version, is_active, created_at, updated_at
                    FROM prompt_templates 
                    WHERE username = $1 AND template_type = $2
                    ORDER BY version DESC
                `;
                params = [username, templateType];
            } else {
                // Get latest active version (default behavior)
                query = `
                    SELECT id, username, template_type, content, version, is_active, created_at, updated_at
                    FROM prompt_templates 
                    WHERE username = $1 AND template_type = $2 AND is_active = TRUE
                `;
                params = [username, templateType];
            }

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'Template not found',
                    message: `No template found for user: ${username}, type: ${templateType}`
                });
            }

            const responseData = includeHistory === 'true' ? {
                templates: result.rows,
                totalVersions: result.rows.length,
                latestVersion: Math.max(...result.rows.map(t => t.version))
            } : {
                template: result.rows[0]
            };

            res.json({
                success: true,
                data: responseData
            });

        } catch (error) {
            console.error('Error fetching template:', error);
            next(error);
        }
    }

    // Create or update template (creates new version)
    async updateTemplate(req, res, next) {
        const client = await pool.connect();
        
        try {
            const { username, templateType, content } = req.body;

            if (!username || !templateType || !content) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType, content'
                });
            }

            const validTypes = ['conceptMentor', 'assessmentPrompt', 'defaultTemplateValues'];
            if (!validTypes.includes(templateType)) {
                return res.status(400).json({
                    error: `Invalid templateType. Must be one of: ${validTypes.join(', ')}`
                });
            }

            await client.query('BEGIN');

            // Get next version number using PostgreSQL function or manual query
            let nextVersion;
            try {
                // Try using the PostgreSQL function if it exists
                const versionResult = await client.query(
                    'SELECT get_next_version($1, $2) as next_version',
                    [username, templateType]
                );
                nextVersion = versionResult.rows[0].next_version;
            } catch (functionError) {
                // Fallback to manual query if function doesn't exist
                const versionResult = await client.query(
                    'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM prompt_templates WHERE username = $1 AND template_type = $2',
                    [username, templateType]
                );
                nextVersion = versionResult.rows[0].next_version;
            }

            // Deactivate current active version
            await client.query(
                'UPDATE prompt_templates SET is_active = FALSE WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                [username, templateType]
            );

            // Insert new version
            const insertResult = await client.query(
                `INSERT INTO prompt_templates (username, template_type, content, version, is_active, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
                 RETURNING id, version, created_at`,
                [username, templateType, content, nextVersion]
            );

            await client.query('COMMIT');

            const newTemplate = insertResult.rows[0];

            res.status(201).json({
                success: true,
                message: 'Template updated successfully',
                data: {
                    id: newTemplate.id,
                    username,
                    templateType,
                    version: newTemplate.version,
                    createdAt: newTemplate.created_at
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error updating template:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // List all templates for a user
    async listTemplates(req, res, next) {
        try {
            const { username } = req.query;

            if (!username) {
                return res.status(400).json({
                    error: 'Missing required query parameter: username'
                });
            }

            const result = await pool.query(`
                SELECT 
                    template_type,
                    version,
                    is_active,
                    created_at,
                    updated_at,
                    LENGTH(content) as content_length
                FROM prompt_templates 
                WHERE username = $1 
                ORDER BY template_type, version DESC
            `, [username]);

            // Group by template type
            const templatesByType = result.rows.reduce((acc, template) => {
                if (!acc[template.template_type]) {
                    acc[template.template_type] = [];
                }
                acc[template.template_type].push(template);
                return acc;
            }, {});

            res.json({
                success: true,
                data: {
                    username,
                    templates: templatesByType,
                    totalTemplates: result.rows.length
                }
            });

        } catch (error) {
            console.error('Error listing templates:', error);
            next(error);
        }
    }

    // Delete template(s)
    async deleteTemplate(req, res, next) {
        const client = await pool.connect();
        
        try {
            const { username, templateType, version, deleteAll = false } = req.body;

            if (!username || !templateType) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType'
                });
            }

            await client.query('BEGIN');

            let query, params, message;

            if (deleteAll) {
                query = 'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2';
                params = [username, templateType];
                message = `All versions of ${templateType} deleted for user ${username}`;
            } else if (version) {
                query = 'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2 AND version = $3';
                params = [username, templateType, parseInt(version)];
                message = `Version ${version} of ${templateType} deleted for user ${username}`;
            } else {
                query = 'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = TRUE';
                params = [username, templateType];
                message = `Active version of ${templateType} deleted for user ${username}`;
            }

            const result = await client.query(query, params);

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    error: 'No matching templates found to delete'
                });
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message,
                deletedCount: result.rowCount
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error deleting template:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // Restore previous version as active
    async restoreTemplate(req, res, next) {
        const client = await pool.connect();
        
        try {
            const { username, templateType, version } = req.body;

            if (!username || !templateType || !version) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType, version'
                });
            }

            await client.query('BEGIN');

            // Check if the version exists
            const checkResult = await client.query(
                'SELECT id FROM prompt_templates WHERE username = $1 AND template_type = $2 AND version = $3',
                [username, templateType, parseInt(version)]
            );

            if (checkResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    error: `Version ${version} not found for ${templateType}`
                });
            }

            // Deactivate current active version
            await client.query(
                'UPDATE prompt_templates SET is_active = FALSE WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                [username, templateType]
            );

            // Activate the specified version
            await client.query(
                'UPDATE prompt_templates SET is_active = TRUE WHERE username = $1 AND template_type = $2 AND version = $3',
                [username, templateType, parseInt(version)]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Version ${version} of ${templateType} restored as active for user ${username}`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error restoring template version:', error);
            next(error);
        } finally {
            client.release();
        }
    }

    // Get default templates
    async getDefaultTemplates(req, res, next) {
        try {
            const { templateType, format = 'json' } = req.query;

            const baseDir = path.join(process.cwd(), 'src/data');

            // Define default template files and their content
            const defaultTemplates = {
                conceptMentor: {
                    file: 'conceptMentor.txt',
                    description: 'Learning coach template with UbD principles',
                    type: 'text'
                },
                assessmentPrompt: {
                    file: 'assessmentPrompt.txt', 
                    description: 'Evaluation template for measuring conceptual understanding',
                    type: 'text'
                },
                defaultTemplateValues: {
                    file: 'defaultTemplateValues.txt',
                    description: 'JSON configuration template with concept variables',
                    type: 'json'
                }
            };

            // If specific template type requested
            if (templateType) {
                if (!defaultTemplates[templateType]) {
                    return res.status(400).json({
                        error: 'Invalid template type',
                        message: `Template type must be one of: ${Object.keys(defaultTemplates).join(', ')}`
                    });
                }

                const template = defaultTemplates[templateType];
                const filePath = path.join(baseDir, template.file);

                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({
                        error: 'Template file not found',
                        message: `Default template file '${template.file}' not found`
                    });
                }

                const content = fs.readFileSync(filePath, 'utf8');

                if (format === 'raw') {
                    return res.set({
                        'Content-Type': template.type === 'json' ? 'application/json' : 'text/plain',
                        'Content-Disposition': `attachment; filename="${template.file}"`
                    }).send(content);
                }

                return res.json({
                    success: true,
                    data: {
                        templateType,
                        content,
                        description: template.description,
                        type: template.type,
                        filename: template.file,
                        lastModified: fs.statSync(filePath).mtime
                    }
                });
            }

            // Return all default templates
            const allTemplates = {};
            const templateInfo = {};

            for (const [type, template] of Object.entries(defaultTemplates)) {
                const filePath = path.join(baseDir, template.file);
                
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const stats = fs.statSync(filePath);
                    
                    allTemplates[type] = {
                        content,
                        description: template.description,
                        type: template.type,
                        filename: template.file,
                        size: stats.size,
                        lastModified: stats.mtime
                    };

                    templateInfo[type] = {
                        description: template.description,
                        type: template.type,
                        filename: template.file,
                        size: stats.size,
                        lastModified: stats.mtime,
                        contentLength: content.length
                    };
                } else {
                    allTemplates[type] = {
                        error: `File '${template.file}' not found`,
                        description: template.description,
                        type: template.type,
                        filename: template.file
                    };
                }
            }

            if (format === 'info') {
                return res.json({
                    success: true,
                    data: {
                        templates: templateInfo,
                        totalTemplates: Object.keys(templateInfo).length,
                        availableTypes: Object.keys(defaultTemplates)
                    }
                });
            }

            res.json({
                success: true,
                data: {
                    templates: allTemplates,
                    totalTemplates: Object.keys(allTemplates).length,
                    availableTypes: Object.keys(defaultTemplates)
                }
            });

        } catch (error) {
            console.error('Error fetching default templates:', error);
            next(error);
        }
    }

    // Reset template to default
    async resetToDefault(req, res, next) {
        try {
            const { username, templateType, resetToDefault = false } = req.body;

            if (!resetToDefault) {
                return res.status(400).json({
                    error: 'Invalid operation',
                    message: 'Set resetToDefault: true to reset template'
                });
            }

            if (!username || !templateType) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType'
                });
            }

            const baseDir = path.join(process.cwd(), 'src/data');
            const templateFiles = {
                conceptMentor: 'conceptMentor.txt',
                assessmentPrompt: 'assessmentPrompt.txt',
                defaultTemplateValues: 'defaultTemplateValues.txt'
            };

            if (!templateFiles[templateType]) {
                return res.status(400).json({
                    error: 'Invalid template type',
                    message: `Template type must be one of: ${Object.keys(templateFiles).join(', ')}`
                });
            }

            const filePath = path.join(baseDir, templateFiles[templateType]);
            
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    error: 'Default template file not found',
                    message: `File '${templateFiles[templateType]}' not found`
                });
            }

            const defaultContent = fs.readFileSync(filePath, 'utf8');

            res.json({
                success: true,
                message: 'Default template content retrieved for reset',
                data: {
                    username,
                    templateType,
                    defaultContent,
                    action: 'ready_for_reset',
                    instructions: 'Use the defaultContent with your update API to reset the template'
                }
            });

        } catch (error) {
            console.error('Error processing template reset:', error);
            next(error);
        }
    }

    // Process prompt (your original API with database integration)
    async processPrompt(req, res, next) {
        try {
            const { username, promptType, llmProvider = 'default', userInput = '' } = req.body;

            if (!username || !promptType) {
                return res.status(400).json({
                    error: 'Missing required fields: username, promptType'
                });
            }

            // Load prompt template structure
            const baseDir = path.join(process.cwd(), 'src/data');
            const promptTemplatePath = path.join(baseDir, 'promptTemplate.json');
            
            if (!fs.existsSync(promptTemplatePath)) {
                return res.status(404).json({ 
                    error: `'promptTemplate.json' not found.` 
                });
            }
            
            const promptTemplate = JSON.parse(fs.readFileSync(promptTemplatePath, 'utf8'));

            // Try to get user-specific template variables from database first
            let userVariables;
            try {
                const dbResult = await pool.query(
                    'SELECT content FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                    [username, 'defaultTemplateValues']
                );
                
                if (dbResult.rows.length > 0) {
                    userVariables = JSON.parse(dbResult.rows[0].content);
                    console.log(`Using database template values for user: ${username}`);
                } else {
                    throw new Error('No database template found');
                }
            } catch (dbError) {
                console.warn(`Database template not found for user ${username}. Falling back to file system.`);
                
                // Fallback to file system
                const defaultTemplatePath = path.join(baseDir, 'defaultTemplateValues.txt');
                if (!fs.existsSync(defaultTemplatePath)) {
                    return res.status(404).json({
                        error: `Default template values not found at '${defaultTemplatePath}'.`
                    });
                }
                userVariables = JSON.parse(fs.readFileSync(defaultTemplatePath, 'utf8'));
            }

            // Try to get system content from database first
            let systemContentTemplate;
            try {
                const dbResult = await pool.query(
                    'SELECT content FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                    [username, promptType]
                );
                
                if (dbResult.rows.length > 0) {
                    systemContentTemplate = dbResult.rows[0].content;
                    console.log(`Using database system content for user: ${username}, type: ${promptType}`);
                } else {
                    throw new Error('No database template found');
                }
            } catch (dbError) {
                console.warn(`Database system content not found for user ${username}, type ${promptType}. Falling back to file system.`);
                
                // Fallback to file system
                let systemContentPath;
                if (promptType === 'conceptMentor') {
                    systemContentPath = path.join(baseDir, 'conceptMentor.txt');
                } else if (promptType === 'assessmentPrompt') {
                    systemContentPath = path.join(baseDir, 'assessmentPrompt.txt');
                } else {
                    return res.status(400).json({ 
                        error: `'${promptType}.txt' file not found for system content.` 
                    });
                }

                if (!fs.existsSync(systemContentPath)) {
                    return res.status(404).json({ 
                        error: `'${systemContentPath}' not found.` 
                    });
                }
                systemContentTemplate = fs.readFileSync(systemContentPath, 'utf8');
            }

            const systemContent = this.replacePlaceholders(systemContentTemplate, userVariables);

            // Load LLM config
            const llmConfigPath = path.join(baseDir, 'llmConfigs.json');
            if (!fs.existsSync(llmConfigPath)) {
                return res.status(404).json({ 
                    error: `LLM config 'llmConfigs.json' not found.` 
                });
            }
            const llmConfigs = JSON.parse(fs.readFileSync(llmConfigPath, 'utf8'));
            const llmConfig = llmConfigs[llmProvider.toLowerCase()] || llmConfigs.default;

            const finalMessages = promptTemplate.map(item => {
                if (item.role === 'system') {
                    return { role: item.role, content: systemContent };
                }
                if (item.role === 'user') {
                    return { role: item.role, content: userInput };
                }
                return item;
            });

            res.json({
                messages: finalMessages,
                llmConfig,
                templateSource: 'database'
            });

        } catch (error) {
            console.error('Error processing prompt:', error);
            next(error);
        }
    }

    // Helper function to replace placeholders
    replacePlaceholders(text, data) {
        return text.replace(/{{(.*?)}}/g, (_, key) => data[key.trim()] ?? '');
    }
}

module.exports = new TemplateController();