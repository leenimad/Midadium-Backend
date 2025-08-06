// backend/routes/recommendationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // All recommendation routes need user context
const recommendationController = require('../controllers/recommendationController');

// For New Users / General
router.get('/popular', protect, recommendationController.getPopularCourses);
router.get('/newest', protect, recommendationController.getNewestCourses);

// For Old/Existing Users (Personalized)
router.get('/for-you', protect, recommendationController.getPersonalizedRecommendations);

module.exports = router; 