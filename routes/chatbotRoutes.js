// backend/routes/chatbotRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // All logged-in users can chat
const chatbotController = require('../controllers/chatbotController');

// POST /api/chat - Handle a new chat message
// router.post('/', protect, chatbotController.handleChatMessage);
// POST /api/chatbot/chat - Student sends a message
router.post('/chat', protect, chatbotController.chatWithBot);
module.exports = router;