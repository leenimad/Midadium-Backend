const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

const {
  getMyStudents,
  getMyCourses,
  getMyLessons,
  getWeeklyLessonStats,
  addCourse,
  getTeacherProfile,
  updateTeacherProfile,
  changeTeacherPassword,
  getStudentsForCourse,
  reviewSubmission,
  analyzeCourseReviews,
  getCourseStudentsWithPerformance,
issueCertificateToStudent,
autoRateSubmission
} = require('../controllers/teacherController');

const {
  uploadLesson,
  deleteLesson,
  updateLesson
} = require('../controllers/lessonController');

const { uploadLesson: uploadLessonMiddleware } = require('../middleware/uploadMiddleware');

const {
  getAssignmentsForCourse,
  updateAssignment,
  deleteAssignment
} = require('../controllers/assignmentController');

const {
  getSubmissionsForAssignment
} = require('../controllers/submissionController');

// ✅ Teacher Dashboard welcome
router.get('/dashboard', protect, authorizeRoles('teacher'), (req, res) => {
  res.json({ message: "Welcome to the teacher dashboard!" });
});

// ✅ Lessons CRUD
router.post('/lessons', protect, authorizeRoles('teacher'), uploadLessonMiddleware, uploadLesson);
router.get('/lessons', protect, authorizeRoles('teacher'), getMyLessons);
router.put('/lessons/:id', protect, authorizeRoles('teacher'), updateLesson);
router.delete('/lessons/:id', protect, authorizeRoles('teacher'), deleteLesson);

// ✅ Courses & Students
router.get('/courses', protect, authorizeRoles('teacher'), getMyCourses);
router.post('/courses', protect, authorizeRoles('teacher'), addCourse);
router.get('/students', protect, authorizeRoles('teacher'), getMyStudents);
router.get('/courses/:id/students', protect, authorizeRoles('teacher'), getStudentsForCourse);

// ✅ Assignments
router.get('/courses/:courseId/assignments', protect, authorizeRoles('teacher'), getAssignmentsForCourse);
router.put('/assignments/:id', protect, authorizeRoles('teacher'), updateAssignment);
router.delete('/assignments/:id', protect, authorizeRoles('teacher'), deleteAssignment);

// ✅ Submissions & Reviews
router.get('/assignments/:assignmentId/submissions', protect, authorizeRoles('teacher'), getSubmissionsForAssignment);
router.put('/submissions/:id/review', protect, authorizeRoles('teacher'), reviewSubmission);

// ✅ Reports & Profile
router.get('/reports/weekly-lessons', protect, authorizeRoles('teacher'), getWeeklyLessonStats);
router.get('/profile', protect, authorizeRoles('teacher'), getTeacherProfile);
router.put('/profile', protect, authorizeRoles('teacher'), updateTeacherProfile);
router.put('/change-password', protect, authorizeRoles('teacher'), changeTeacherPassword);


// POST /api/teacher/courses/:courseId/analyze-reviews
router.post(
    '/courses/:courseId/analyze-reviews',
    protect,
    authorizeRoles('teacher', 'admin'), // Only teacher of course or admin
    analyzeCourseReviews
);
// --- Certificate Management Routes ---
// GET students and their performance for a specific course (for certificate issuance view)
router.get('/courses/:courseId/students-performance',protect,
    authorizeRoles('teacher'), getCourseStudentsWithPerformance);

// POST to issue a certificate to a student for a course
router.post('/courses/:courseId/students/:studentId/issue-certificate',protect,
    authorizeRoles('teacher'), issueCertificateToStudent);

    router.post('/submissions/:submissionId/auto-rate', protect, authorizeRoles('teacher'), autoRateSubmission);
module.exports = router;
