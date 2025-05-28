// src/config/database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool with corrected configuration
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'tinymagiq',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Remove invalid options for mysql2
    // acquireTimeout, timeout, reconnect are not valid for mysql2
});

// Test connection function
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Connection details:', {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            database: process.env.DB_NAME || 'tinymagiq',
            passwordProvided: !!process.env.DB_PASSWORD
        });
        return false;
    }
};

module.exports = { pool, testConnection };