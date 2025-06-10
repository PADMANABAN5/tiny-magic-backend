// src/routes/index.js
const express = require('express');

// Import routes
const templateRoutes = require('./templates/templates');

// Import sanitization middleware with error handling
let sanitizeRequest;
try {
    const { sanitizeRequest: sanitize } = require('../middleware/validation');
    sanitizeRequest = sanitize || ((req, res, next) => next());
    console.log('✅ Validation middleware loaded successfully');
} catch (error) {
    console.warn('❌ Validation middleware not found, using no-op sanitizer:', error.message);
    sanitizeRequest = (req, res, next) => next();
}

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeRequest);

// API version info
router.get('/', (req, res) => {
    res.json({
        name: 'TinyMagiq API',
        version: '1.0.0',
        description: 'API for managing templates and chat conversations',
        endpoints: {
            // Template endpoints
            templates: '/api/templates',
            defaults: '/api/templates/defaults',
            list: '/api/templates/list',
            process: '/api/templates/process',
            restore: '/api/templates/restore',
            
            // Chat endpoints
            chat: '/api/chat',
            latestChat: '/api/chat/latest/:user_id',
            chatCounts: '/api/chat/counts/:user_id',
            userChats: '/api/chat/user/:user_id',
            
            // Utility endpoints
            health: '/health'
        },
        documentation: 'See README.md for detailed API documentation'
    });
});

// Template management routes
router.use('/templates', templateRoutes);

// Chat routes - with error handling
try {
    const chatRoutes = require('./chat/chat');
    router.use('/chat', chatRoutes);
    console.log('✅ Chat routes loaded successfully');
} catch (error) {
    console.error('❌ Failed to load chat routes:', error.message);
    // Provide a fallback route
    router.use('/chat', (req, res) => {
        res.status(503).json({
            error: 'Chat service unavailable',
            message: 'Chat routes failed to load. Make sure chat controller and routes are properly set up.',
            details: error.message
        });
    });
}

// Legacy compatibility routes (if needed)
router.use('/templates/update', templateRoutes);
router.use('/templates/get', templateRoutes);
router.use('/templates/delete', templateRoutes);

module.exports = router;