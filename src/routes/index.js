const express = require('express');
const templateRoutes = require('./templates/templates');
const { sanitizeRequest } = require('../middleware/validation');

const router = express.Router();

// Apply sanitization to all routes
router.use(sanitizeRequest);

// API version info
router.get('/', (req, res) => {
    res.json({
        name: 'Template Management API',
        version: '1.0.0',
        description: 'API for managing versioned prompt templates',
        endpoints: {
            templates: '/api/templates',
            defaults: '/api/templates/defaults',
            list: '/api/templates/list',
            process: '/api/templates/process',
            restore: '/api/templates/restore'
        },
        documentation: 'See README.md for detailed API documentation'
    });
});

// Template management routes
router.use('/templates', templateRoutes);

// Legacy compatibility routes (if needed)
router.use('/templates/update', templateRoutes);
router.use('/templates/get', templateRoutes);
router.use('/templates/delete', templateRoutes);

module.exports = router;