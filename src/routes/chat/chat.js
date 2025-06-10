// src/routes/chat/chat.js
const express = require('express');
const chatController = require('../../controllers/chatController');

// Import validation with error handling
let validateChatCreate, validateChatUserParams;
try {
    const validation = require('../../middleware/validation');
    validateChatCreate = validation.validateChatCreate || ((req, res, next) => next());
    validateChatUserParams = validation.validateChatUserParams || ((req, res, next) => next());
    console.log('✅ Chat validation loaded successfully');
} catch (error) {
    console.warn('❌ Chat validation not found, using no-op validators:', error.message);
    validateChatCreate = (req, res, next) => next();
    validateChatUserParams = (req, res, next) => next();
}

const router = express.Router();

// POST /api/chat - Create/Save chat conversation
// Body: { user_id, conversation, status? }
router.post('/', validateChatCreate, chatController.createChat);

// GET /api/chat/latest/:user_id - Get latest chat for user
router.get('/latest/:user_id', validateChatUserParams, chatController.getLatestChat);

// GET /api/chat/counts/:user_id - Get chat counts by status
router.get('/counts/:user_id', validateChatUserParams, chatController.getChatCounts);

// GET /api/chat/user/:user_id - Get all chats for user (with pagination)
// Query params: limit?, offset?, status?
router.get('/user/:user_id', validateChatUserParams, chatController.getUserChats);

module.exports = router;