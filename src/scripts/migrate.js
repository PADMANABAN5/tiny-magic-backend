const { pool } = require('../config/database');

const createTables = async () => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        // Create prompt_templates table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS prompt_templates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                template_type VARCHAR(50) NOT NULL,
                content LONGTEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_user_type (username, template_type),
                INDEX idx_active (username, template_type, is_active),
                UNIQUE KEY unique_active (username, template_type, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // Create users table (optional, for authentication)
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_username (username),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await connection.commit();
        console.log('✅ Database tables created successfully');

    } catch (error) {
        await connection.rollback();
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        connection.release();
    }
};

// Run migration if called directly
if (require.main === module) {
    createTables()
        .then(() => {
            console.log('Migration completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { createTables };