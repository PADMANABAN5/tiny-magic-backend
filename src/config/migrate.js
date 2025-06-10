
const { pool } = require('./database');

const createTables = async () => {
    let client;
    
    try {
        console.log('🔄 Starting database migration...');
        client = await pool.connect();
        await client.query('BEGIN');

        // Create prompt_templates table (PostgreSQL syntax)
        console.log('📝 Creating prompt_templates table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS prompt_templates (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                template_type VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for prompt_templates
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_prompt_user_type ON prompt_templates(username, template_type);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_prompt_active ON prompt_templates(username, template_type, is_active);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_prompt_version ON prompt_templates(username, template_type, version);
        `);

        // Create unique constraint for active templates (PostgreSQL syntax)
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS unique_active_template 
            ON prompt_templates(username, template_type) 
            WHERE is_active = TRUE;
        `);

        // Create users table (PostgreSQL syntax)
        console.log('👥 Creating users table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for users
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);

        // Create chat table with JSONB support (PostgreSQL)
        console.log('💬 Creating chat table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                conversation JSONB NOT NULL,
                status VARCHAR(50) DEFAULT 'incomplete',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for chat table
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_user_id ON chat(user_id);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_status ON chat(status);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat(created_at DESC);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_user_status ON chat(user_id, status);
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_user_created ON chat(user_id, created_at DESC);
        `);

        await client.query('COMMIT');
        console.log('✅ Database tables created successfully');
        console.log('📊 Tables created: prompt_templates, users, chat');
        console.log('🚀 Migration completed!');

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        
        // Check if it's a "relation already exists" error
        if (error.code === '42P07') {
            console.log('ℹ️  Tables already exist, skipping creation');
            return;
        }
        
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        if (client) {
            client.release();
        }
    }
};

// Run migration if called directly
if (require.main === module) {
    createTables()
        .then(() => {
            console.log('🎉 Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Migration failed:', error.message);
            process.exit(1);
        });
}

module.exports = { createTables };