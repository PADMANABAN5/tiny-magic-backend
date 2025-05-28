require('dotenv').config();

module.exports = {
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD,
        name: process.env.DB_NAME || 'tinymagiq'
    },
    
    jwt: {
        secret: process.env.JWT_SECRET || 'fallback-secret-key',
        expiresIn: '24h'
    },
    
    cors: {
        origins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
    },
    
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    }
};