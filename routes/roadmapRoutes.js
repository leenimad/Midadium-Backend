// backend/routes/roadmapRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // User must be logged in
const roadmapController = require('../controllers/roadmapController'); // Adjust path if needed

// POST /api/roadmaps/generate - Generate a learning roadmap
router.post('/generate', protect, roadmapController.generateLearningRoadmap);
// Save a generated roadmap
router.post('/save',protect, roadmapController.saveLearningRoadmap); // Or roadmapController.saveLearningRoadmap

// Get all saved roadmaps for the student
router.get('/Myroadmaps',protect, roadmapController.getSavedRoadmaps);

// Get a single saved roadmap
router.get('/:roadmapId',protect, roadmapController.getSingleSavedRoadmap);

// Delete a saved roadmap
router.delete('/:roadmapId',protect, roadmapController.deleteSavedRoadmap);

router.post('/purchase-package',  protect,/* ensureStudent, */ roadmapController.purchaseRoadmapPackage);
module.exports = router;