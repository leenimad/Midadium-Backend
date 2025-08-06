const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { getMyNotifications, markAsRead } = require('../controllers/notificationController');

const router = express.Router();

router.get('/', protect, getMyNotifications);
router.patch('/:id/read', protect, markAsRead);

module.exports = router;
