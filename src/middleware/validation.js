// src/middleware/validation.js
const Joi = require('joi');

// Valid template types
const VALID_TEMPLATE_TYPES = ['conceptMentor', 'assessmentPrompt', 'defaultTemplateValues'];

// Template creation/update validation
const templateSchema = Joi.object({
    username: Joi.string().min(1).max(255).required().messages({
        'string.empty': 'Username cannot be empty',
        'string.max': 'Username cannot exceed 255 characters',
        'any.required': 'Username is required'
    }),
    templateType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required().messages({
        'any.only': `Template type must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`,
        'any.required': 'Template type is required'
    }),
    content: Joi.string().min(1).max(1000000).required().messages({
        'string.empty': 'Content cannot be empty',
        'string.max': 'Content cannot exceed 1MB',
        'any.required': 'Content is required'
    })
});

// Template query validation
const templateQuerySchema = Joi.object({
    username: Joi.string().min(1).max(255).required(),
    templateType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required(),
    version: Joi.number().integer().min(1).optional(),
    includeHistory: Joi.string().valid('true', 'false').optional()
});

// Template deletion validation
const templateDeleteSchema = Joi.object({
    username: Joi.string().min(1).max(255).required(),
    templateType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required(),
    version: Joi.number().integer().min(1).optional(),
    deleteAll: Joi.boolean().optional().default(false)
});

// Template restore validation
const templateRestoreSchema = Joi.object({
    username: Joi.string().min(1).max(255).required(),
    templateType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required(),
    version: Joi.number().integer().min(1).required()
});

// Prompt processing validation - FIXED with explicit empty string allowance
const promptProcessSchema = Joi.object({
    username: Joi.string().min(1).max(255).required(),
    promptType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required(),
    llmProvider: Joi.string().min(1).max(50).optional().default('default'),
    userInput: Joi.string().allow('').optional().default('')  // Explicitly allow empty strings
});

// Reset to default validation
const resetDefaultSchema = Joi.object({
    username: Joi.string().min(1).max(255).required(),
    templateType: Joi.string().valid(...VALID_TEMPLATE_TYPES).required(),
    resetToDefault: Joi.boolean().valid(true).required().messages({
        'any.only': 'resetToDefault must be true to perform reset operation'
    })
});

// Chat validation schemas
const chatCreateSchema = Joi.object({
    user_id: Joi.string().min(1).max(255).required().messages({
        'string.empty': 'User ID cannot be empty',
        'any.required': 'User ID is required'
    }),
    conversation: Joi.array().items(Joi.object()).required().messages({
        'array.base': 'Conversation must be an array',
        'any.required': 'Conversation is required'
    }),
    status: Joi.string().valid('paused', 'completed', 'stopped', 'incomplete').optional().default('incomplete')
});

const chatUserParamsSchema = Joi.object({
    user_id: Joi.string().min(1).max(255).required().messages({
        'string.empty': 'User ID cannot be empty',
        'any.required': 'User ID is required'
    })
});

// Chat update validation schema
const chatUpdateSchema = Joi.object({
    status: Joi.string().valid('paused', 'completed', 'stopped', 'incomplete').required().messages({
        'any.only': 'Status must be one of: paused, completed, stopped, incomplete',
        'any.required': 'Status is required'
    })
});

// Generic validation middleware factory
const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        const data = source === 'query' ? req.query : 
                     source === 'params' ? req.params : req.body;
        
        const { error, value } = schema.validate(data, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const details = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context.value
            }));

            return res.status(400).json({
                error: 'Validation error',
                details: details,
                message: error.details[0].message
            });
        }

        // Replace the original data with validated data
        if (source === 'query') {
            req.query = value;
        } else if (source === 'params') {
            req.params = value;
        } else {
            req.body = value;
        }

        next();
    };
};

// Specific validation middlewares
const validateTemplate = validate(templateSchema);
const validateTemplateQuery = validate(templateQuerySchema, 'query');
const validateTemplateDelete = validate(templateDeleteSchema);
const validateTemplateRestore = validate(templateRestoreSchema);
const validatePromptProcess = validate(promptProcessSchema);
const validateResetDefault = validate(resetDefaultSchema);

// Chat validation middlewares
const validateChatCreate = validate(chatCreateSchema);
const validateChatUserParams = validate(chatUserParamsSchema, 'params');
const validateChatUpdate = validate(chatUpdateSchema);

// Custom validation for list endpoint
const validateListQuery = (req, res, next) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({
            error: 'Missing required query parameter: username'
        });
    }
    
    if (username.length > 255) {
        return res.status(400).json({
            error: 'Username cannot exceed 255 characters'
        });
    }
    
    next();
};

// Custom validation for defaults endpoint
const validateDefaultsQuery = (req, res, next) => {
    const { templateType, format } = req.query;
    
    if (templateType && !VALID_TEMPLATE_TYPES.includes(templateType)) {
        return res.status(400).json({
            error: 'Invalid template type',
            message: `Template type must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`
        });
    }
    
    if (format && !['json', 'raw', 'info'].includes(format)) {
        return res.status(400).json({
            error: 'Invalid format',
            message: 'Format must be one of: json, raw, info'
        });
    }
    
    next();
};

// Sanitization helpers
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;
    
    // Remove dangerous characters and limit length
    return input
        .replace(/[<>]/g, '') // Remove potential HTML tags
        .trim()
        .substring(0, 1000000); // Limit to 1MB
};

const sanitizeUsername = (username) => {
    if (typeof username !== 'string') return username;
    
    // Only allow alphanumeric, underscore, hyphen, and dot
    return username
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .substring(0, 255);
};

// Content validation helpers
const validateContentLength = (content, maxLength = 1000000) => {
    if (!content) return false;
    return content.length <= maxLength;
};

const validateTemplateType = (templateType) => {
    return VALID_TEMPLATE_TYPES.includes(templateType);
};

// Request sanitization middleware
const sanitizeRequest = (req, res, next) => {
    // Sanitize body
    if (req.body) {
        if (req.body.username) {
            req.body.username = sanitizeUsername(req.body.username);
        }
        if (req.body.content) {
            req.body.content = sanitizeInput(req.body.content);
        }
        if (req.body.userInput) {
            req.body.userInput = sanitizeInput(req.body.userInput);
        }
    }
    
    // Sanitize query parameters
    if (req.query) {
        if (req.query.username) {
            req.query.username = sanitizeUsername(req.query.username);
        }
    }
    
    next();
};

module.exports = {
    validate,
    validateTemplate,
    validateTemplateQuery,
    validateTemplateDelete,
    validateTemplateRestore,
    validatePromptProcess,
    validateResetDefault,
    validateListQuery,
    validateDefaultsQuery,
    validateChatCreate,
    validateChatUserParams,
    validateChatUpdate,
    sanitizeRequest,
    sanitizeInput,
    sanitizeUsername,
    validateContentLength,
    validateTemplateType,
    VALID_TEMPLATE_TYPES
};