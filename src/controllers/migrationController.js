// src/controllers/migrationController.js
const { createTables } = require('../config/migrate');

class MigrationController {
    async runMigrations(req, res) {
        try {
            // Add basic security - you can make this more secure
            const { secret } = req.body;
            const expectedSecret = process.env.MIGRATION_SECRET || 'your-migration-secret-2024';
            
            if (secret !== expectedSecret) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Invalid migration secret'
                });
            }

            console.log('🔄 Running database migrations via API...');
            await createTables();
            
            res.json({
                success: true,
                message: 'Database migrations completed successfully',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Migration failed:', error);
            res.status(500).json({
                error: 'Migration failed',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    async getMigrationStatus(req, res) {
        try {
            const { pool } = require('../config/database');
            
            // Check if tables exist
            const result = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('chat', 'prompt_templates', 'users')
                ORDER BY table_name
            `);

            const existingTables = result.rows.map(row => row.table_name);
            const expectedTables = ['chat', 'prompt_templates', 'users'];
            const missingTables = expectedTables.filter(table => !existingTables.includes(table));

            res.json({
                success: true,
                data: {
                    existingTables,
                    missingTables,
                    allTablesExist: missingTables.length === 0,
                    timestamp: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('❌ Error checking migration status:', error);
            res.status(500).json({
                error: 'Failed to check migration status',
                message: error.message
            });
        }
    }
}

module.exports = new MigrationController();