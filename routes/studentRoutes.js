const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// Student Dashboard: Only accessible by users with the "student" role
router.get('/dashboard', protect, authorizeRoles('student'), (req, res) => {
  res.json({ message: "Welcome to the student dashboard!" });
});

// Additional student-specific endpoints can be added here, for example:
// View lessons, interactive content, progress tracking, etc.
router.get('/lessons', protect, authorizeRoles('student'), (req, res) => {
  // Your logic to fetch lessons for students
  res.json({ message: "Here are your lessons." });
});

module.exports = router;
