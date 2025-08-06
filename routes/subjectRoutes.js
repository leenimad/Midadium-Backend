// backend/routes/subjectRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const subjectController = require('../controllers/subjectController');

// --- Admin Only Routes for Subject Management ---
router.post('/', protect, authorizeRoles('admin'), subjectController.createSubject);
router.put('/:subjectId', protect, authorizeRoles('admin,teacher'), subjectController.updateSubject);
router.delete('/:subjectId', protect, authorizeRoles('admin'), subjectController.deleteSubject);

// --- Public/Authenticated Routes for Reading Subjects ---
// Allow any authenticated user (admin, teacher, student) to get subjects
router.get('/', protect, subjectController.getAllSubjects);
router.get('/:subjectId', protect, subjectController.getSubjectById);


module.exports = router;