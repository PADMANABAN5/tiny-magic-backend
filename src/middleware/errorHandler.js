const config = require('../config/config');

const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Default error
    let error = {
        message: err.message || 'Internal Server Error',
        status: err.status || 500
    };

    // MySQL errors
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        error = {
            message: 'Database access denied',
            status: 500
        };
    } else if (err.code === 'ER_NO_SUCH_TABLE') {
        error = {
            message: 'Database table not found',
            status: 500
        };
    } else if (err.code === 'ER_DUP_ENTRY') {
        error = {
            message: 'Duplicate entry',
            status: 409
        };
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        error = {
            message: 'Validation error',
            status: 400,
            details: err.details
        };
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error = {
            message: 'Invalid token',
            status: 401
        };
    }

    const response = {
        error: error.message,
        status: error.status
    };

    // Include error details in development
    if (config.nodeEnv === 'development') {
        response.stack = err.stack;
        response.details = error.details;
    }

    res.status(error.status).json(response);
};

module.exports = errorHandler;