const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// Teacher Dashboard: Only accessible by users with the "teacher" role
router.get('/dashboard', protect, authorizeRoles('teacher'), (req, res) => {
  res.json({ message: "Welcome to the teacher dashboard!" });
});

// Additional teacher-specific endpoints can be added here, for example:
// Upload lesson, view teacher profile, etc.
router.post('/upload-lesson', protect, authorizeRoles('teacher'), (req, res) => {
  // Your logic to handle lesson upload
  res.json({ message: "Lesson uploaded successfully!" });
});

module.exports = router;
