const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// ✅ تأكد من استيراد كل الدوال المطلوبة
const {
  createAssignment,
  getAssignmentsForCourse,
  updateAssignment,
  deleteAssignment
} = require('../controllers/assignmentController');

// ✅ Define routes
router.post('/', protect, authorizeRoles('teacher'), createAssignment);
router.get('/:courseId', protect, authorizeRoles('teacher'), getAssignmentsForCourse);
router.put('/:id', protect, authorizeRoles('teacher'), updateAssignment);

router.delete('/:id', protect, authorizeRoles('teacher'), deleteAssignment);

module.exports = router;
