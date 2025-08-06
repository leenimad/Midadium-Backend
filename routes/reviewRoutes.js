// backend/routes/reviewRoutes.js
const express = require('express');
const reviewController = require('../controllers/reviewController');
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// Option 1: Standalone Review Routes (e.g., /api/reviews/...) - Less common for course reviews
// const router = express.Router();
// router.get('/:reviewId', ...) // Get single review?
// router.put('/:reviewId', protect, authorizeRoles('student', 'admin'), reviewController.updateReview);
// router.delete('/:reviewId', protect, authorizeRoles('student', 'admin'), reviewController.deleteReview);

// Option 2: Nested Routes under Courses (More RESTful: /api/courses/:courseId/reviews/...)
const router = express.Router({ mergeParams: true }); // *** IMPORTANT: mergeParams allows access to :courseId from parent router ***

// GET /api/courses/:courseId/reviews - Get all reviews for a course (Public)
router.get('/', reviewController.getCourseReviews);

// POST /api/courses/:courseId/reviews - Create a review for a course (Student Only)
router.post('/', protect, authorizeRoles('student'), reviewController.createReview);

// PUT /api/courses/:courseId/reviews/:reviewId - Update a specific review (Author or Admin)
// Note: courseId is available from mergeParams but might not be strictly needed by updateReview controller if only reviewId is used.
router.put('/:reviewId', protect, authorizeRoles('student', 'admin'), reviewController.updateReview);

// DELETE /api/courses/:courseId/reviews/:reviewId - Delete a specific review (Author or Admin)
router.delete('/:reviewId', protect, authorizeRoles('student', 'admin'), reviewController.deleteReview);


module.exports = router;