// src/routes/chat/chat.js - Complete Chat Routes
const express = require('express');
const router = express.Router();
const chatController = require('../../controllers/chatController');

// MAIN WORKFLOW ENDPOINTS

// Check session status (first call when user logs in)
router.get('/session-status/:user_id', chatController.getSessionStatus);

// Create/Save new chat conversation
router.post('/', chatController.createChat);

// Update existing conversation (for resuming and continuing)
router.put('/conversation/:chat_id', chatController.updateConversation);

// UTILITY ENDPOINTS

// Get chat counts by status
router.get('/counts/:user_id', chatController.getChatCounts);

// Get chat history with filtering and pagination
router.get('/history/:user_id', chatController.getChatHistory);

// Get specific chat by ID
router.get('/:chat_id', chatController.getChatById);

// Delete chat
router.delete('/:chat_id', chatController.deleteChat);

module.exports = router;