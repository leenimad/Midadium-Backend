// backend/routes/studentRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); // Only need protect, role is implicitly student
const studentController = require('../controllers/studentController');
const subjectController = require ('../controllers/subjectController')
const courseController= require('../controllers/courseController')
const { uploadSubmission } = require('../middleware/uploadMiddleware');
const { submitAssignment } = require('../controllers/submissionController');
const { updateSubmission, deleteSubmission,getMySubmissionForAssignment } = require('../controllers/submissionController');
const { upload } = require('../middleware/uploadMiddleware')
const { getAssignmentsForStudentCourse } = require('../controllers/assignmentController');

// Middleware to ensure the user IS a student for all routes in this file
// Note: 'protect' already fetches the user, so req.user should be available
const ensureStudent = (req, res, next) => {
    if (req.user && req.user.role === 'student') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: User is not a student.' });
    }
};

// Apply protect and ensureStudent to all student routes
router.use(protect, ensureStudent);

// --- Student Specific Routes ---

// GET /api/student/profile - Get logged-in student's basic info
router.get('/profile', studentController.getStudentProfile);
// GET /api/student/assignments - Get assignments for the student
router.put( '/profile',  studentController.updateStudentProfile);
// router.get('/', protect, subjectController.getAllSubjects);
// router.get('/:subjectId', protect, subjectController.getSubjectById);
// GET /api/student/courses - Get courses the student is enrolled in  
router.get('/courses', studentController.getEnrolledCourses); 
router.get('/categories', studentController.getCourseCategory);
router.get('/categories/subject/:subjectId', studentController.getCourseCategory);

router.post('/courses/:courseId/request-enrollment', studentController.requestEnrollment); // Request enrollment
// GET /api/student/courses/:courseId - Get details of one enrolled course and its lessons
router.get('/courses/:courseId', studentController.getCourseDetailsWithLessons);
router.get('/courses/:courseId/lessons', studentController.getCourseDetailsWithLessons)
// GET /api/student/lessons/:lessonId - Get details of a specific lesson (checks enrollment)
router.get('/lessons/:lessonId', studentController.getStudentLessonDetails);

// POST /api/student/lessons/:lessonId/generate-format - Generate AI content (checks enrollment)
router.post('/lessons/:lessonId/generate-format', studentController.generateStudentLessonFormat);
 
router.get(
    '/progress',
    protect,
    authorizeRoles('student'), 
    studentController.getStudentProgress // Placeholder controller
);
// POST /api/student/progress/lesson/:lessonId/complete - Mark lesson viewed/completed
router.post('/progress/lesson/:lessonId/status', studentController.updateLessonProgressStatus);

// POST /api/student/progress/lesson/:lessonId/flashcards - Update flashcard progress
router.post('/progress/lesson/:lessonId/flashcards', studentController.updateFlashcardProgress);

// POST /api/student/progress/lesson/:lessonId/quiz/:quizIdentifier - Submit quiz attempt
router.post('/progress/lesson/:lessonId/quiz/:quizIdentifier', studentController.submitQuizAttempt);

// POST /api/student/progress/lesson/:lessonId/worksheet - Submit worksheet answers
router.post('/progress/lesson/:lessonId/worksheet', studentController.submitWorksheet);
// POST /api/student/progress/lesson/:lessonId/worksheet/evaluate - Submit worksheet answers AND get AI evaluation
router.post(
    '/progress/lesson/:lessonId/worksheet/evaluate', // New distinct route
    studentController.submitAndEvaluateWorksheet
);
 // --- Favorite Course Routes ---
router.get('/favorites', studentController.getFavoriteCourses);
router.post('/favorites/:courseId', studentController.addCourseToFavorites);
router.delete('/favorites/:courseId', studentController.removeCourseFromFavorites);
// POST /api/student/courses/ai-search (or GET /api/courses/ai-search?q=...)
router.post('/courses/ai-search', protect, courseController.aiEnhancedCourseSearch);



///// subbmession routes :
router.get('/assignments/:assignmentId/my-submission', getMySubmissionForAssignment);
// POST Submission
router.post('/assignments/:assignmentId/submit', uploadSubmission, submitAssignment);

// PUT (Update) Submission
// router.put('/submissions/:id', upload.single('file'), updateSubmission);
router.put(
    '/submissions/:id',
    uploadSubmission, // <<<< CRUCIAL: Is this really 'uploadSubmission'?
                      // If you have another multer instance named 'upload' in uploadMiddleware,
                      // ensure this is not accidentally `upload.single('file')`
updateSubmission // Make sure controller name matches
);
// DELETE Submission 
router.delete('/submissions/:id', deleteSubmission);
router.get('/courses/:courseId/assignments', getAssignmentsForStudentCourse);

const certificateController = require('../controllers/certificateController'); // Import
 router.get('/courses/:courseId/certificate', certificateController.getStudentCertificateForCourse);
 router.get('/certificates', certificateController.getMyCertificates);

module.exports = router;