// src/server.js - With Auto-Migration
const app = require('./app');
const config = require('./config/config');
const { testConnection } = require('./config/database');

// Import migration function
let createTables;
try {
    const migrate = require('./config/migrate');
    createTables = migrate.createTables;
} catch (error) {
    console.warn('⚠️  Migration file not found, skipping auto-migration');
    createTables = null;
}

const startServer = async () => {
    try {
        // Test database connection
        console.log('🔄 Testing database connection...');
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('Failed to connect to database. Exiting...');
            process.exit(1);
        }

        // Run database migrations automatically
        if (createTables) {
            console.log('🔄 Running database migrations...');
            try {
                await createTables();
                console.log('✅ Database migrations completed successfully');
            } catch (migrationError) {
                console.error('❌ Migration failed:', migrationError.message);
                // Don't exit on migration failure in production
                if (config.nodeEnv === 'production') {
                    console.log('⚠️  Continuing server startup despite migration failure...');
                } else {
                    console.log('💡 Note: This might be normal if tables already exist');
                }
            }
        } else {
            console.log('⚠️  No migration function found, skipping auto-migration');
        }

        // Start server
        const server = app.listen(config.port, () => {
            console.log(`🚀 Server running on port ${config.port}`);
            console.log(`📝 Environment: ${config.nodeEnv}`);
            console.log(`🔗 Health check: http://localhost:${config.port}/health`);
            console.log(`📚 API base URL: http://localhost:${config.port}/api`);
            console.log(`💬 Chat API: http://localhost:${config.port}/api/chat`);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('SIGINT received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();