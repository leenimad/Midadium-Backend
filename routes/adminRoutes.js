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
  updateAdminSettings
 // getActivityLog
} = require('../controllers/adminController');
const { getActivityLog } = require('../controllers/adminController');
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
router.put('/teachers/:id/assign-course', protect, authorizeRoles('admin'), assignCourseToTeacher);
router.delete('/teachers/:id/delete-with-courses', protect, authorizeRoles('admin'), removeTeacherAndCourses);
// Manage Courses
router.get('/courses', protect, authorizeRoles('admin'), getAllCourses);
router.get('/courses/:id', protect, authorizeRoles('admin'), getCourseById);
router.put('/courses/:id/approve', protect, authorizeRoles('admin'), approveCourse);
router.put('/courses/:id/reject', protect, authorizeRoles('admin'), rejectCourse);
router.put('/courses/:id', protect, authorizeRoles('admin'), updateCourse);
router.post('/courses', protect, authorizeRoles('admin'), addCourse);
router.delete('/courses/:id', protect, authorizeRoles('admin'), removeCourse);
// students
router.get('/students', protect, authorizeRoles('admin'), getAllStudents);
router.get('/students/:id', protect, authorizeRoles('admin'), getStudentById);
router.post('/students', protect, authorizeRoles('admin'), addStudent);
router.put('/students/:id', protect, authorizeRoles('admin'), updateStudent);
router.delete('/students/:id', protect, authorizeRoles('admin'), removeStudent);
// --- Student Enrollment Routes ---
router.post('/students/:studentId/enroll/:courseId', protect, authorizeRoles('admin'), enrollStudentInCourse); // or PUT
router.delete('/students/:studentId/unenroll/:courseId', protect, authorizeRoles('admin'), unenrollStudentFromCourse);

// Reports
router.get('/reports', protect, authorizeRoles('admin'), getReports);

// Settings
router.get('/settings', protect, authorizeRoles('admin'), getAdminSettings);
router.put('/settings', protect, authorizeRoles('admin'), updateAdminSettings);

module.exports = router;