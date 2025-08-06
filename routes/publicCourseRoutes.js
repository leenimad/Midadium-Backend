// backend/routes/publicCourseRoutes.js
const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
// Maybe add 'protect' if users must be logged in even to VIEW details, otherwise omit
const { protect } = require('../middleware/authMiddleware');
// const reviewRouter = require("./reviewRoutes"); // Adjust path if needed
// router.use("/:courseId/reviews", reviewRouter);
// GET /api/public/courses/:courseId - Public details for a course
// Using 'protect' here ensures user is logged in, but doesn't check enrollment
// Remove 'protect' if truly public access is needed
router.get('/:courseId', protect, courseController.getPublicCourseDetails);


module.exports = router;