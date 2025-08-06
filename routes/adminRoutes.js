// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const {
  //overview
  getOverviewData,
  //Teacher
  getAllTeachers,
  getTeacherById,
  addTeacher,
  updateTeacher,
  removeTeacher,
  removeTeacherAndCourses,
  removeTeacherKeepCourses, 
  assignCourseToTeacher,
  //Student
  getAllStudents,
  getStudentById,
  addStudent,
  updateStudent,
  removeStudent,
  enrollStudentInCourse,
  unenrollStudentFromCourse,
 // Coureses
  getAllCourses,
  getCourseById,
  approveCourse,
  rejectCourse,
  updateCourse,
  addCourse,
  removeCourse,
  //Reports
  getReports,
  getAdminSettings,
  updateAdminSettings,
getCourseEnrollments,
getEnrollmentsForStudent

 // getActivityLog
//  getEnrollmentRequests,
//  approveEnrollmentRequest,
//  rejectEnrollmentRequest 
 
} = require('../controllers/adminController');
const { getActivityLog } = require('../controllers/adminController');
const subjectController = require('../controllers/subjectController');
const studentController= require('../controllers/studentController');
const reportController = require('../controllers/reportController');
// Overview
router.get('/overview', protect, authorizeRoles('admin'), getOverviewData);
// Activity Log Route
router.get('/activity', protect, authorizeRoles('admin'), getActivityLog);
// Manage Teachers
router.get('/teachers', protect, authorizeRoles('admin'), getAllTeachers);
router.get('/teachers/:id', protect, authorizeRoles('admin'), getTeacherById);
router.post('/teachers', protect, authorizeRoles('admin'), addTeacher);
router.put('/teachers/:id', protect, authorizeRoles('admin'), updateTeacher);
router.delete('/teachers/:id', protect, authorizeRoles('admin'), removeTeacher);
router.delete('/teachers/:id/orphan-courses', protect, authorizeRoles('admin'), removeTeacherKeepCourses);
router.put('/teachers/:id/assign-course', protect, authorizeRoles('admin'), assignCourseToTeacher);// This might need rework based on new enrollment flow
router.delete('/teachers/:id/delete-with-courses', protect, authorizeRoles('admin'), removeTeacherAndCourses);

// --- Subject Management (Admin Only) ---
router.post('/subjects', subjectController.createSubject);
router.get('/subjects', subjectController.getAllSubjects); // List subjects (might be needed by teacher/student too - adjust middleware if so)
router.get('/subjects/:subjectId', subjectController.getSubjectById); // Get specific subject
router.put('/subjects/:subjectId', subjectController.updateSubject);
router.delete('/subjects/:subjectId', subjectController.deleteSubject);
router.get('/subjects/:subjectId', subjectController.getSubjectById);


// Manage Courses
router.get('/courses', protect, authorizeRoles('admin'), getAllCourses);
router.get('/courses/:id', protect, authorizeRoles('admin'), getCourseById);
router.put('/courses/:id/approve', protect, authorizeRoles('admin'), approveCourse);
router.put('/courses/:id/reject', protect, authorizeRoles('admin'), rejectCourse);
router.put('/courses/:id', protect, authorizeRoles('admin'), updateCourse);
router.post('/courses', protect, authorizeRoles('admin'), addCourse);
router.delete('/courses/:id', protect, authorizeRoles('admin'), removeCourse);
router.get('/courses/:courseId/enrollments',getCourseEnrollments);
// students
router.get('/students', protect, authorizeRoles('admin'), getAllStudents);
router.get('/students/:id', protect, authorizeRoles('admin'), getStudentById);
router.post('/students', protect, authorizeRoles('admin'), addStudent);
router.put('/students/:id', protect, authorizeRoles('admin'), updateStudent);
router.delete('/students/:id', protect, authorizeRoles('admin'), removeStudent);
router.get('/students/:studentId/enrollments', getEnrollmentsForStudent);

// --- Admin Enrollment of Students (Directly bypassing request/payment) ---
router.post('/students/:studentId/enroll/:courseId', enrollStudentInCourse);
router.delete('/students/:studentId/unenroll/:courseId',unenrollStudentFromCourse);
// Reports
router.get('/reports', protect, authorizeRoles('admin'), getReports);

// Settings
router.get('/settings', protect, authorizeRoles('admin'), getAdminSettings);
router.put('/settings', protect, authorizeRoles('admin'), updateAdminSettings);
// --- Admin Routes for Problem Reports ---
// All routes below are protected and require 'admin' role

// GET /api/admin/reports/problems - Get all problem reports
router.get(
  '/reports/problems',
  protect,
  authorizeRoles('admin'),
  reportController.getAllProblemReports
);

// GET /api/admin/reports/problems/:reportId - Get a single problem report
router.get(
  '/reports/problems/:reportId',
  protect,
  authorizeRoles('admin'),
  reportController.getProblemReportById
);

// PUT /api/admin/reports/problems/:reportId - Update status/notes of a problem report
router.put(
  '/reports/problems/:reportId',
  protect,
  authorizeRoles('admin'),
  reportController.updateProblemReport
);

// DELETE /api/admin/reports/problems/:reportId - Delete a problem report
router.delete(
  '/reports/problems/:reportId',
  protect,
  authorizeRoles('admin'),
  reportController.deleteProblemReport
);

module.exports = router;