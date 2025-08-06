const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

// ✅ Rename the upload middleware to something else (e.g., `uploadFiles`)
const { uploadLesson: uploadFiles } = require('../middleware/uploadMiddleware');

// ✅ Import uploadLesson controller as-is
const {
  uploadLesson,
  updateLesson,
  deleteLesson
} = require('../controllers/lessonController');
const lessonCtrl= require('../controllers/lessonController')
// ✅ Route for uploading lesson (middleware first, then controller)
router.post('/lessons', protect, authorizeRoles('teacher'), uploadFiles, uploadLesson);

// ✅ Other routes
router.put('/lessons/:id', protect, authorizeRoles('teacher'), updateLesson);
router.delete('/lessons/:id', protect, authorizeRoles('teacher'), deleteLesson);

// --- ROUTES for ALL AUTHENTICATED USERS (Students, Teachers, Admins) ---
// These routes might be better placed in studentRoutes.js or a general course/lesson viewing route file
// if authorization within the controller becomes complex. But for now, keeping them here.

// GET /api/lessons/course/:courseId - Get all lessons for a specific course
router.get(
    '/course/:courseId',
    protect, // Any logged-in user can list lessons for a course (auth check inside controller)
    lessonCtrl.getLessonsByCourse
);

// GET /api/lessons/:lessonId - Get details for a single lesson
router.get(
    '/:lessonId',
    protect, // Any logged-in user can view details (auth check inside controller)
    lessonCtrl.getLessonDetails
);

// POST /api/lessons/:lessonId/generate-format - Generate AI content for a lesson
router.post(
    '/:lessonId/generate-format',
    protect, // Any authorized user (student, teacher, admin - checked in controller)
    lessonCtrl.generateLessonFormat
);

router.post(
    '/:lessonId/translate-content',
    protect, // User must be logged in (teacher, admin, or enrolled student - checked in controller)
    lessonCtrl.translateGeneratedContent
);
module.exports = router;


/*// backend/routes/lessonRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');
const { uploadLesson } = require('../middleware/uploadMiddleware'); // Your multer middleware

// Import ALL necessary functions from lessonController
const lessonCtrl = require('../controllers/lessonController');

// --- TEACHER/ADMIN ROUTES for Managing Lessons ---

// POST /api/lessons - Create a new lesson (handles file uploads)
// The uploadMiddleware will populate req.files.video and req.files.pdf
router.post(
    '/upload', // Changed from '/lessons' to just '/' because base path is /api/lessons
    protect,
    authorizeRoles('teacher', 'admin'), // Teachers and Admins can create
    uploadLesson, // Your multer middleware for 'video' and 'pdf' fields
    lessonCtrl.uploadLesson // Use the comprehensive uploadLesson controller
);

// PUT /api/lessons/:lessonId - Update an existing lesson
router.put(
    '/:lessonId', // Changed from :id to :lessonId for clarity
    protect,
    authorizeRoles('teacher', 'admin'), // Assuming teachers can update their own, admins can update any
    // Note: If update can also change files, you'd add uploadLesson middleware here too
    lessonCtrl.updateLesson
);

// DELETE /api/lessons/:lessonId - Delete a lesson
router.delete(
    '/:lessonId', // Changed from :id to :lessonId
    protect,
    authorizeRoles('teacher'), // Assuming teachers can delete their own, admins any
    lessonCtrl.deleteLesson
);


// --- ROUTES for ALL AUTHENTICATED USERS (Students, Teachers, Admins) ---
// These routes might be better placed in studentRoutes.js or a general course/lesson viewing route file
// if authorization within the controller becomes complex. But for now, keeping them here.

// GET /api/lessons/course/:courseId - Get all lessons for a specific course
router.get(
    '/course/:courseId',
    protect, // Any logged-in user can list lessons for a course (auth check inside controller)
    lessonCtrl.getLessonsByCourse
);

// GET /api/lessons/:lessonId - Get details for a single lesson
router.get(
    '/:lessonId',
    protect, // Any logged-in user can view details (auth check inside controller)
    lessonCtrl.getLessonDetails
);

// POST /api/lessons/:lessonId/generate-format - Generate AI content for a lesson
router.post(
    '/:lessonId/generate-format',
    protect, // Any authorized user (student, teacher, admin - checked in controller)
    lessonCtrl.generateLessonFormat
);

router.post(
    '/:lessonId/translate-content',
    protect, // User must be logged in (teacher, admin, or enrolled student - checked in controller)
    lessonCtrl.translateGeneratedContent
);


module.exports = router;*/
