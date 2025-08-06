// backend/routes/publicTeacherRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // Require login?
const adminController = require('../controllers/adminController'); // Controller with getTeacherById

// GET /api/public/teachers/:id - Get public details for a specific teacher
router.get(
    '/:id', // Use :id to match the param name expected by getTeacherById
    protect, // Keep protect if login is required to view teacher profiles
    adminController.getTeacherById // Point to the correct controller function
);

// Optional: Add a route to get all public teachers later if needed
// router.get('/', protect, someController.getAllPublicTeachers);

module.exports = router;