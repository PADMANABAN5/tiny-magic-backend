// src/controllers/templateController.js - Simplified and Robust Version
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

function replacePlaceholders(text, data) {
    return text.replace(/{{(.*?)}}/g, (_, key) => data[key.trim()] ?? '');
}

class TemplateController {
    // Create or update template (creates new version) - SIMPLIFIED VERSION
    // Add this at the very start of your updateTemplate method
    // Modified updateTemplate method that works around the constraint issue
    async updateTemplate(req, res, next) {
        let client;

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

            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Get next version number
                const versionResult = await client.query(
                    'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM prompt_templates WHERE username = $1 AND template_type = $2',
                    [username, templateType]
                );
                const nextVersion = versionResult.rows[0].next_version;

                // WORKAROUND: Delete old inactive versions to avoid constraint violation
                // Keep only the current active version before creating new one
                await client.query(
                    'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = FALSE',
                    [username, templateType]
                );

                // Now deactivate current active version (if any)
                const updateResult = await client.query(
                    'UPDATE prompt_templates SET is_active = FALSE WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                    [username, templateType]
                );

                // Insert new version
                const insertResult = await client.query(
                    'INSERT INTO prompt_templates (username, template_type, content, version, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW()) RETURNING id, version, created_at',
                    [username, templateType, content, nextVersion]
                );

                await client.query('COMMIT');

                const newTemplate = insertResult.rows[0];

                console.log(`✅ Template created successfully: ${username}/${templateType} v${nextVersion}`);

                res.status(201).json({
                    success: true,
                    message: 'Template updated successfully',
                    data: {
                        id: newTemplate.id,
                        username,
                        templateType,
                        version: newTemplate.version,
                        createdAt: newTemplate.created_at
                    },
                    note: 'Previous inactive versions were removed due to database constraints'
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error updating template:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Constraint violation',
                    message: 'Database constraint prevents this operation. Please fix the database schema or contact support.',
                    technical: 'The current constraint design prevents multiple inactive versions. Database schema needs updating.'
                });
            }

            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to update template',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });

        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Get template(s) - No transaction needed (read-only)
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
                query = `
                    SELECT id, username, template_type, content, version, is_active, created_at, updated_at
                    FROM prompt_templates 
                    WHERE username = $1 AND template_type = $2 AND version = $3
                `;
                params = [username, templateType, parseInt(version)];
            } else if (includeHistory === 'true') {
                query = `
                    SELECT id, username, template_type, content, version, is_active, created_at, updated_at
                    FROM prompt_templates 
                    WHERE username = $1 AND template_type = $2
                    ORDER BY version DESC
                `;
                params = [username, templateType];
            } else {
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
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to fetch template'
            });
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
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to list templates'
            });
        }
    }

    // Delete template(s) - Simplified version
    async deleteTemplate(req, res, next) {
        let client;

        try {
            const { username, templateType, version, deleteAll = false } = req.body;

            if (!username || !templateType) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType'
                });
            }

            client = await pool.connect();

            try {
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

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('Error deleting template:', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to delete template'
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Restore previous version as active
    async restoreTemplate(req, res, next) {
        let client;

        try {
            const { username, templateType, version } = req.body;

            if (!username || !templateType || !version) {
                return res.status(400).json({
                    error: 'Missing required fields: username, templateType, version'
                });
            }

            client = await pool.connect();

            try {
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

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('Error restoring template version:', error);
            return res.status(500).json({
                error: 'Database error',
                message: 'Failed to restore template version'
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Get default templates - File system only, no database
    async getDefaultTemplates(req, res, next) {
        try {
            const { templateType, format = 'json' } = req.query;
            const baseDir = path.join(process.cwd(), 'src/data');

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
                } else {
                    allTemplates[type] = {
                        error: `File '${template.file}' not found`,
                        description: template.description,
                        type: template.type,
                        filename: template.file
                    };
                }
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
            return res.status(500).json({
                error: 'File system error',
                message: 'Failed to read default templates'
            });
        }
    }

    // Reset template to default
    // Reset template to default - FIXED VERSION
    async resetToDefault(req, res, next) {
        let client;

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

            const baseDir = path.join(process.cwd(), 'src/data');
            const filePath = path.join(baseDir, templateFiles[templateType]);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    error: 'Default template file not found',
                    message: `File '${templateFiles[templateType]}' not found`
                });
            }

            const defaultContent = fs.readFileSync(filePath, 'utf8');

            // Get database connection
            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Check if user has any existing templates of this type
                const existingResult = await client.query(
                    'SELECT id, version FROM prompt_templates WHERE username = $1 AND template_type = $2 ORDER BY version DESC LIMIT 1',
                    [username, templateType]
                );

                let nextVersion = 1;
                if (existingResult.rows.length > 0) {
                    // User has existing templates, get next version number
                    const versionResult = await client.query(
                        'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM prompt_templates WHERE username = $1 AND template_type = $2',
                        [username, templateType]
                    );
                    nextVersion = versionResult.rows[0].next_version;

                    // Deactivate all existing versions
                    await client.query(
                        'UPDATE prompt_templates SET is_active = FALSE WHERE username = $1 AND template_type = $2',
                        [username, templateType]
                    );

                    // Clean up old inactive versions to avoid constraint issues
                    await client.query(
                        'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = FALSE AND version < $3',
                        [username, templateType, nextVersion]
                    );
                }

                // Insert new template with default content
                const insertResult = await client.query(
                    'INSERT INTO prompt_templates (username, template_type, content, version, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW()) RETURNING id, version, created_at',
                    [username, templateType, defaultContent, nextVersion]
                );

                await client.query('COMMIT');

                const newTemplate = insertResult.rows[0];

                console.log(`✅ Template reset to default successfully: ${username}/${templateType} v${nextVersion}`);

                res.json({
                    success: true,
                    message: `${templateType} template has been reset to default for user ${username}`,
                    data: {
                        username,
                        templateType,
                        defaultContent,
                        action: 'reset_completed',
                        newVersion: newTemplate.version,
                        templateId: newTemplate.id,
                        createdAt: newTemplate.created_at
                    }
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error resetting template to default:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Database constraint violation',
                    message: 'Unable to reset template due to database constraints. Please contact support.',
                    technical: error.message
                });
            }

            return res.status(500).json({
                error: 'Server error',
                message: 'Failed to reset template to default',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

    // Process prompt (your original API with database integration)
    // Process prompt (updated to handle empty userInput)
    async processPrompt(req, res, next) {
        try {
            const { username, promptType, llmProvider = 'default', userInput } = req.body;

            if (!username || !promptType) {
                return res.status(400).json({
                    error: 'Missing required fields: username, promptType'
                });
            }

            const processedUserInput = userInput || '';
            const baseDir = path.join(process.cwd(), 'src/data');

            // Load prompt template structure
            const promptTemplatePath = path.join(baseDir, 'promptTemplate.json');
            if (!fs.existsSync(promptTemplatePath)) {
                return res.status(404).json({
                    error: `'promptTemplate.json' not found.`
                });
            }
            const promptTemplate = JSON.parse(fs.readFileSync(promptTemplatePath, 'utf8'));

            // Step 1: Try to get user-specific template for this promptType from database
            let systemContentTemplate;
            let templateSource = 'file'; // Track where the template came from

            try {
                const dbResult = await pool.query(
                    'SELECT content FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                    [username, promptType]
                );

                if (dbResult.rows.length > 0) {
                    // Found user-specific template in database
                    systemContentTemplate = dbResult.rows[0].content;
                    templateSource = 'database';
                    console.log(`✅ Using database template for user: ${username}, type: ${promptType}`);
                } else {
                    throw new Error('No user-specific template found in database');
                }
            } catch (dbError) {
                // Fallback to default file system template
                console.log(`ℹ️  No database template found for user ${username}, type ${promptType}. Using default template.`);

                let systemContentPath;
                if (promptType === 'conceptMentor') {
                    systemContentPath = path.join(baseDir, 'conceptMentor.txt');
                } else if (promptType === 'assessmentPrompt') {
                    systemContentPath = path.join(baseDir, 'assessmentPrompt.txt');
                } else {
                    return res.status(400).json({
                        error: `Invalid promptType '${promptType}'. Must be 'conceptMentor' or 'assessmentPrompt'.`
                    });
                }

                if (!fs.existsSync(systemContentPath)) {
                    return res.status(404).json({
                        error: `Default template file '${systemContentPath}' not found.`
                    });
                }

                systemContentTemplate = fs.readFileSync(systemContentPath, 'utf8');
                templateSource = 'file';
            }

            // Step 2: Get template variables (defaultTemplateValues)
            // Always try database first for template variables, then fallback to file
            let userVariables;
            try {
                const dbResult = await pool.query(
                    'SELECT content FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                    [username, 'defaultTemplateValues']
                );

                if (dbResult.rows.length > 0) {
                    userVariables = JSON.parse(dbResult.rows[0].content);
                    console.log(`✅ Using database template values for user: ${username}`);
                } else {
                    throw new Error('No database template values found');
                }
            } catch (dbError) {
                console.log(`ℹ️  No database template values found for user ${username}. Using default values.`);

                // Fallback to default template values
                const defaultTemplatePath = path.join(baseDir, 'defaultTemplateValues.txt');
                if (!fs.existsSync(defaultTemplatePath)) {
                    return res.status(404).json({
                        error: `Default template values not found at '${defaultTemplatePath}'.`
                    });
                }
                userVariables = JSON.parse(fs.readFileSync(defaultTemplatePath, 'utf8'));
            }

            // Step 3: Replace placeholders in the system content
            const systemContent = replacePlaceholders(systemContentTemplate, userVariables);

            // Step 4: Load LLM config
            const llmConfigPath = path.join(baseDir, 'llmConfigs.json');
            if (!fs.existsSync(llmConfigPath)) {
                return res.status(404).json({
                    error: `LLM config 'llmConfigs.json' not found.`
                });
            }
            const llmConfigs = JSON.parse(fs.readFileSync(llmConfigPath, 'utf8'));
            const llmConfig = llmConfigs[llmProvider.toLowerCase()] || llmConfigs.default;

            // Step 5: Build final messages
            const finalMessages = promptTemplate.map(item => {
                if (item.role === 'system') {
                    return { role: item.role, content: systemContent };
                }
                if (item.role === 'user') {
                    return { role: item.role, content: processedUserInput };
                }
                return item;
            });

            // Step 6: Return response with source information
            res.json({
                success: true,
                messages: finalMessages,
                llmConfig,
                templateSource: templateSource, // 'database' or 'file'
                metadata: {
                    username,
                    promptType,
                    llmProvider,
                    userInputLength: processedUserInput.length,
                    systemContentSource: templateSource === 'database' ? 'User Custom Template' : 'Default Template'
                }
            });

        } catch (error) {
            console.error('❌ Error processing prompt:', error);
            return res.status(500).json({
                error: 'Server error processing prompt',
                details: error.message
            });
        }
    }
    // Add this method to your TemplateController class (before the closing bracket and module.exports)

    // Update ALL users to latest defaultTemplateValues.txt
    async updateAllUsersToLatestDefaults(req, res, next) {
        let client;

        try {
            const { confirmUpdate = false } = req.body;

            if (!confirmUpdate) {
                return res.status(400).json({
                    error: 'Confirmation required',
                    message: 'Set confirmUpdate: true to update ALL users with latest defaultTemplateValues.txt',
                    warning: 'This will affect ALL users in the system'
                });
            }

            // Read the updated defaultTemplateValues.txt file
            const baseDir = path.join(process.cwd(), 'src/data');
            const filePath = path.join(baseDir, 'defaultTemplateValues.txt');

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    error: 'Default template file not found',
                    message: 'defaultTemplateValues.txt not found in src/data directory'
                });
            }

            const updatedDefaultContent = fs.readFileSync(filePath, 'utf8');
            console.log(`📄 Loaded updated defaultTemplateValues.txt (${updatedDefaultContent.length} characters)`);

            // Get database connection
            client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Get ALL unique users who have any templates
                const allUsersResult = await pool.query(
                    'SELECT DISTINCT username FROM prompt_templates ORDER BY username'
                );

                const allUsernames = allUsersResult.rows.map(row => row.username);
                console.log(`👥 Found ${allUsernames.length} total users in the system`);

                if (allUsernames.length === 0) {
                    await client.query('COMMIT');
                    return res.json({
                        success: true,
                        message: 'No users found in the system',
                        data: { updatedUsers: 0 }
                    });
                }

                let successCount = 0;
                let errorCount = 0;
                const updateResults = [];

                // Update each user
                for (const username of allUsernames) {
                    try {
                        // Get next version number for defaultTemplateValues for this user
                        const versionResult = await client.query(
                            'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM prompt_templates WHERE username = $1 AND template_type = $2',
                            [username, 'defaultTemplateValues']
                        );
                        const nextVersion = versionResult.rows[0].next_version;

                        // Clean up old inactive versions to avoid constraint issues
                        await client.query(
                            'DELETE FROM prompt_templates WHERE username = $1 AND template_type = $2 AND is_active = FALSE',
                            [username, 'defaultTemplateValues']
                        );

                        // Deactivate current active defaultTemplateValues version (if exists)
                        await client.query(
                            'UPDATE prompt_templates SET is_active = FALSE WHERE username = $1 AND template_type = $2 AND is_active = TRUE',
                            [username, 'defaultTemplateValues']
                        );

                        // Insert new version with updated default content
                        const insertResult = await client.query(
                            'INSERT INTO prompt_templates (username, template_type, content, version, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW()) RETURNING id, version',
                            [username, 'defaultTemplateValues', updatedDefaultContent, nextVersion]
                        );

                        updateResults.push({
                            username,
                            success: true,
                            newVersion: insertResult.rows[0].version,
                            templateId: insertResult.rows[0].id,
                            action: nextVersion === 1 ? 'created' : 'updated'
                        });

                        successCount++;
                        console.log(`✅ ${nextVersion === 1 ? 'Created' : 'Updated'} ${username} defaultTemplateValues v${nextVersion}`);

                    } catch (userError) {
                        console.error(`❌ Failed to update user ${username}:`, userError);
                        updateResults.push({
                            username,
                            success: false,
                            error: userError.message
                        });
                        errorCount++;
                    }
                }

                await client.query('COMMIT');

                // Success response
                res.json({
                    success: successCount > 0,
                    message: `✅ Bulk update completed! Updated ${successCount} users with latest defaultTemplateValues.txt`,
                    data: {
                        templateType: 'defaultTemplateValues',
                        totalUsers: allUsernames.length,
                        successfulUpdates: successCount,
                        failedUpdates: errorCount,
                        newContentPreview: updatedDefaultContent.substring(0, 200) + '...',
                        updateResults: updateResults
                    },
                    warnings: errorCount > 0 ? `${errorCount} users failed to update` : null
                });

            } catch (transactionError) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Rollback failed:', rollbackError);
                }
                throw transactionError;
            }

        } catch (error) {
            console.error('❌ Error in bulk update all users:', error);

            return res.status(500).json({
                error: 'Server error',
                message: 'Failed to update all users with latest defaultTemplateValues.txt',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });

        } finally {
            if (client) {
                try {
                    client.release();
                } catch (releaseError) {
                    console.error('Error releasing client:', releaseError);
                }
            }
        }
    }

}


module.exports = new TemplateController();