// backend/controllers/studentController.js
const User = require('../models/UserModel');
const Course = require('../models/courseModel');
const Lesson = require('../models/LessonModel');
//const EnrollmentRequest = require('../models/EnrollmentRequestModel');
const Enrollment = require('../models/EnrollmentModel');
const StudentProgress = require('../models/StudentProgressModel');
const GeneratedContent = require('../models/GeneratedContentModel'); // To get 
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// Assuming generateLessonFormat logic is refactored or accessible
// e.g., const { generateFormatForLesson } = require('./aiService'); // Ideal approach
// Or import from lessonController temporarily
const { generateLessonFormat: generateFormatInternal } = require('./lessonController'); // Less ideal, couples controllers
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { updateChatroomOnEnrollment } = require('../utils/chatroomUtils');  
const Certificate = require('../models/CertificateModel');
const { createNotification } = require('./notificationController'); // Assuming you have this
const { v4: uuidv4 } = require('uuid'); // For generating unique certificate IDs
let genAI;
if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log("[AI Init] Google Generative AI client initialized successfully.");
    } catch (e) {
        console.error("[AI Init] CRITICAL: Failed to initialize Google Generative AI client:", e);
        genAI = null; // Ensure genAI is null if initialization fails
    }
} else {
    console.warn("[AI Init] WARNING: GEMINI_API_KEY environment variable not set. Google AI features will be unavailable.");
    genAI = null;
}

// --- Helper Function for Logging Student Activity (Optional) ---
const logStudentActivity = async (req, actionType, targetType, targetId, targetName, details) => {
    try {
      if (!req.user || !req.user.id || !req.user.username) {
         console.warn("Cannot log student activity: actor info missing.");
         return;
      } 
      // Use ActivityLog model if you want to log student actions (like enrollment requests)
      // await ActivityLog.create({ /* ... */ });
      console.log(`Student Activity: User ${req.user.username} performed ${actionType} on ${targetType || 'System'} ${targetName ? `(${targetName})` : ''}`);
    } catch (e) { console.error("Failed to log student activity:", e); }
  };
  
// --- Get Logged-in Student's Profile/Dashboard Info ---
exports.getStudentProfile = async (req, res) => {
    try {
        const studentId = req.user.id;
        // *** LOGGING AT THE START OF CONTROLLER ***
        console.log("[getStudentProfile] Controller reached.");
        console.log("[getStudentProfile] req.user object received:", req.user); // Log the whole req.user
        console.log("[getStudentProfile] User ID from req.user:", req.user?.id); // Log the ID specifically
        console.log("[getStudentProfile] User Role from req.user:", req.user?.role); // Log the Role specifically

        // Ensure req.user and req.user.id exist before trying User.findById 
        if (!req.user || !req.user.id) {
             console.error("[getStudentProfile] CRITICAL: req.user or req.user.id is missing!");
             return res.status(500).json({ message: 'Authentication context missing.' }); // Internal error
        }

        const [student, activeEnrollmentCount] = await Promise.all([
            User.findById(studentId).select('username email createdAt role favoriteCourses') .populate('favoriteCourses', '_id') .lean(), // Removed grade
            Enrollment.countDocuments({ student: studentId })
        ]);

        if (!student || student.role !== 'student') {
            return res.status(404).json({ message: 'Student profile not found.' });}

        // Fetch enrollments separately (keep existing logic)
        // Fetch basic info for a few recently enrolled/accessed courses (Example)
        // This requires querying the Enrollment model, not User model directly
        const recentEnrollments = await Enrollment.find({ student: studentId })
            .sort({ updatedAt: -1 }) // Sort by most recently accessed/updated enrollment (if tracked) or enrolledAt
            .limit(5) // Limit to 5 recent
            .populate({
                path: 'course', // Populate the 'course' field within the Enrollment doc
                select: 'name subject teacher price', // Select specific course fields
                populate: [ // Nested populate
                    { path: 'subject', select: 'name' },
                    { path: 'teacher', select: 'username' }
                ]
            })
            .lean();

        res.status(200).json({
            profile: student, // Send core profile data
            activeEnrollmentCount: activeEnrollmentCount,
            // Send simplified course info from recent enrollments
            recentCourses: recentEnrollments.map(e => e.course).filter(c => c != null) // Filter out nulls if course was deleted
        });

    } catch (error) {
        console.error("[getStudentProfile] Error:", error);
        res.status(500).json({ message: 'Failed to fetch student profile.' });
    }
};
exports.updateStudentProfile = async (req, res) => {
    try {
        const studentId = req.user.id; // Get ID from authenticated user
        const { username, email } = req.body;

        // --- Basic Validation ---
        if (!username && !email) {
            return res.status(400).json({ message: 'No fields provided for update (username or email required).' });
        }

        // --- Prepare Update Data ---
        const updateData = {};
        if (username !== undefined) {
            if (typeof username !== 'string' || username.trim().length === 0) {
                return res.status(400).json({ message: 'Invalid username format.' });
            }
            updateData.username = username.trim();
        }
        if (email !== undefined) {
             if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { // Basic email regex
                 return res.status(400).json({ message: 'Invalid email format.' });
             }
             updateData.email = email.trim().toLowerCase(); // Store email lowercase

            // Check email uniqueness if changed
            const existingUser = await User.findOne({ email: updateData.email, _id: { $ne: studentId } });
            if (existingUser) {
                return res.status(400).json({ message: "Email already in use by another account." });
            }
        }

        // Prevent accidental role change via this endpoint
        if (req.body.role || req.body.grade || req.body.enrollments || req.body.password) {
           console.warn(`Attempt to update restricted fields blocked for student ${studentId}`);
           // Optionally return an error, or just ignore these fields
           // return res.status(400).json({ message: 'Cannot update role, grade, enrollments, or password via this endpoint.' });
        }

        // --- Perform Update ---
        const updatedStudent = await User.findByIdAndUpdate(
            studentId,
            { $set: updateData }, // Use $set for clarity
            { new: true, runValidators: true } // Return updated doc, run schema validators
        ).select('username email createdAt role'); // Select fields for response

        if (!updatedStudent) {
            // This shouldn't happen if the user was authenticated, but safety checken
            return res.status(404).json({ message: 'Student profile not found after update attempt.' });
        }

        // Log activity (Optional)
        ///await logActivity(req, 'STUDENT_PROFILE_UPDATED', 'User', studentId, updatedStudent.username, updateData);

        // Prepare response, excluding sensitive fields
        const { password, resetCode, resetCodeExpires, __v, ...studentResponse } = updatedStudent.toObject(); // Use toObject() before destructuring virtuals if any

        res.status(200).json({ message: 'Profile updated successfully', user: studentResponse });

    } catch (error) {
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        console.error("Error updating student profile:", error);
        res.status(500).json({ message: 'Failed to update profile.' });
    }
};
exports.getPublicCourseDetails = async (req, res) => {
    try {
        const { courseId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID format.' });
        }

        // Find the course, ensuring it's approved, and populate necessary fields
        const course = await Course.findOne({ _id: courseId, status: 'approved' })
            .select('name description teacher subject price syllabus createdAt') // Select fields safe for public view
            .populate('teacher', 'username') // Populate teacher's username ONLY
            .populate('subject', 'name')     // Populate subject name ONLY
            .lean(); // Use lean for read-only

        if (!course) {
            return res.status(404).json({ message: 'Approved course not found.' });
        }

        // TODO: Fetch actual chapter/lesson count and estimated duration later
        // For now, we send placeholders or omit them
        const placeholderData = {
            chapters: 12, // Placeholder
            classes: 9,   // Placeholder (might be lessons count)
            durationHours: 45, // Placeholder
        };

        res.status(200).json({
            ...course,
            stats: placeholderData // Add placeholder stats
        });

    } catch (error) {
        console.error(`Error fetching public course details for ${req.params.courseId}:`, error);
        res.status(500).json({ message: 'Failed to fetch course details.' });
    }
};


// --- Get Courses Student is Enrolled In ---
// --- Modify getEnrolledCourses (Remove grade if present in selection) ---
exports.getEnrolledCourses = async (req, res) => {
    try {
        const studentId = req.user.id; // Get the logged-in student's ID

        // *** Query the Enrollment collection directly ***
        const enrollments = await Enrollment.find({ student: studentId }) // Find enrollments for this student
            .populate({
                path: 'course', // Populate the 'course' field within the Enrollment doc
                match: { status: 'approved' }, // Ensure the linked course is approved
                select: 'name subject teacher price description createdAt', // Select desired course fields
                populate: [ // Nested populate within the course
                    { path: 'teacher', select: 'username' }, // Get teacher's username
                    { path: 'subject', select: 'name' }      // Get subject's name
                ]
            })
            .lean(); // Use lean for plain objects

        // Filter out enrollments where the course might be null (due to 'match' or if deleted)
        // and map to return only the course details array
        const enrolledCourses = enrollments
            .filter(enrollment => enrollment.course !== null) // Filter out cases where course didn't match or was null
            .map(enrollment => enrollment.course); // Extract the populated course object

        res.status(200).json(enrolledCourses); // Send the array of course objects

    } catch (error) {
        console.error("Error fetching enrolled courses:", error);
        res.status(500).json({ message: 'Failed to fetch enrolled courses.' });
    }
};

// --- Get Details of ONE Enrolled Course + Its Lessons ---
// exports.getCourseDetailsWithLessons = async (req, res) => {
//     try {
//         const { courseId } = req.params;
//         const studentId = req.user.id;

//         if (!mongoose.Types.ObjectId.isValid(courseId)) {
//             return res.status(400).json({ message: 'Invalid Course ID format.' });
//         }

//         // 1. Verify Enrollment (Authorization)
//         const student = await User.findById(studentId).select('enrollments').lean();
//         if (!student || !student.enrollments?.map(id => id.toString()).includes(courseId)) {
//              return res.status(403).json({ message: 'e.' });
//         }

//         // 2. Fetch Course Details
//         const course = await Course.findOne({ _id: courseId, status: 'approved' }) // Ensure course is approved
//                                   .populate('teacher', 'username')
//                                   .populate('subject', 'name') 
//                                   .lean();

//         if (!course) {
//             // Should not happen if enrollment check passed, but good safety check
//             return res.status(404).json({ message: 'Approved course not found.' });
//         }

//         // 3. Fetch Lessons for the Course
//         const lessons = await Lesson.find({ course: courseId })
//                                     .select('title status createdAt') // Only necessary list info
//                                     .sort({ createdAt: 1 }) // Or a lesson order field
//                                     .lean();

//         // 4. Combine and Respond
//         res.status(200).json({
//             courseDetails: course,
//             lessons: lessons
//         });

//     } catch (error) {
//         console.error(`Error fetching course details/lessons for student:`, error);
//         res.status(500).json({ message: 'Failed to fetch course details and lessons.' });
//     }
// };
exports.getCourseDetailsWithLessons = async (req, res) => {
    try {
        const { courseId } = req.params;
        const studentId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID format.' });
        }

        // 1. Verify Enrollment by querying the Enrollment collection
        console.log(`[GetCourseDetails] Checking enrollment for Student: ${studentId}, Course: ${courseId}`);
        const enrollmentRecord = await Enrollment.findOne({ student: studentId, course: courseId });
        if (!enrollmentRecord) {
             console.log(`[GetCourseDetails] Enrollment not found.`);
             return res.status(403).json({ message: 'You are not enrolled in this course.' });
        }
        console.log(`[GetCourseDetails] Enrollment found.`);

        // 2. Fetch Course Details (only if enrollment exists)
        const  [course, lessonsForCourse, studentProgressRecordsForThisCourse] = await Promise.all([
            Course.findOne({ _id: courseId, status: 'approved' })
                                  .populate('teacher', 'username email') // Teacher's public name
                                  .populate('subject', 'name')     // Subject's name
                                  .lean(),
                                  Lesson.find({ course: courseId })
                                  .select('title objectives status videoOriginalName createdAt') // Select fields student needs for lesson list
                                  .sort({ createdAt: 1 }) // Or by a specific lesson order field
                                  .lean(),
                            StudentProgress.find({ student: studentId, course: courseId }) // Fetch all progress for this student & course
                                  .select('lesson status') // Select only lesson ID and its status
                                  .lean()
                        ]);
                

        if (!course) {
            // This case implies data inconsistency (enrolled in a non-approved/deleted course)
            console.error(`[GetCourseDetails] Course ${courseId} not found or not approved, but enrollment exists for student ${studentId}.`);
            return res.status(404).json({ message: 'Enrolled course is currently unavailable.' });
        }
        console.log(`[GetCourseDetails] Course details fetched: ${course.name}`);

const lessonsWithProgress = lessonsForCourse.map(lesson => {
    // Find the progress record for the current lesson
    const progressForThisLesson = studentProgressRecordsForThisCourse.find(
        p => p.lesson.toString() === lesson._id.toString()
    );
    return {
        ...lesson, // Spread existing lesson properties
        // Embed the student's status for this lesson
        studentProgressStatus: progressForThisLesson ? progressForThisLesson.status : 'not_started',
        // Optionally, embed the whole progress object if needed by frontend Lesson.fromJson
        // studentLessonProgressDetails: progressForThisLesson // This would require frontend to parse it
    };
});


console.log(`[GetCourseDetailsWithLessons] Lessons being sent for course ${courseId}:`,
    lessonsWithProgress.map(l => ({ title: l.title, studentProgressStatus: l.studentProgressStatus }))
); // Log what's being sent

res.status(200).json({
    courseDetails: course,
    lessons: lessonsWithProgress // Send lessons WITH the student's progress status
});

} catch (error) {
console.error(`Error fetching course details/lessons for student (Course ID: ${req.params.courseId}):`, error);
res.status(500).json({ message: 'Failed to fetch course details and lessons.' });
}
};
// --- Get Details of ONE Lesson (if enrolled) ---
exports.getStudentLessonDetails = async (req, res) => {
    try {
        const { lessonId } = req.params;
        const studentId = req.user.id;
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }

        // Fetch Lesson & Course ID
        // Include fields needed for viewing, plus 'course' for auth check
            // 1. Fetch Lesson and its Course ID concurrently
            const lesson = await Lesson.findById(lessonId)
            .select('title objectives videoUrl transcript status course teacher keywords videoOriginalName') // Select fields needed
            .populate('teacher', 'username') // For teacher name context
            .lean();

if (!lesson) { return res.status(404).json({ message: 'Lesson not found.' }); }
if (!lesson.course) { return res.status(500).json({ message: 'Lesson data integrity issue (no course).' }); }

// 2. Verify Enrollment
const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
if (!enrollment) { return res.status(403).json({ message: 'You are not enrolled in the course for this lesson.' }); }

// *** 3. Fetch Student Progress for THIS specific lesson ***
const lessonProgress = await StudentProgress.findOne({
student: studentId,
course: lesson.course, // Use course ID from the fetched lesson
lesson: lessonId
}).lean();
// --- End Fetch Student Progress ---

// 4. Prepare lesson response
const lessonResponse = { ...lesson };
if (lesson.status !== 'ready') {
delete lessonResponse.transcript;
}
delete lessonResponse.audioPath;
// delete lessonResponse.course; // Keep course ID if frontend Lesson model expects it

// *** 5. Add progress to the response ***
res.status(200).json({
...lessonResponse, // Spread lesson details
studentLessonProgress: lessonProgress // Add the progress document (can be null)
});

    } catch (error) {
        console.error(`Error fetching lesson details for student:`, error);
        res.status(500).json({ message: 'Failed to fetch lesson details.' });
    }
};


// --- Generate AI Format (Student) ---
// This reuses the core logic but ensures the student is enrolled first
exports.generateStudentLessonFormat = async (req, res) => {
    try {
        const { lessonId } = req.params;
        const studentId = req.user.id;
         if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }

         // Fetch Lesson & Course ID
         const lesson = await Lesson.findById(lessonId).select('course status').lean();
         if (!lesson) { return res.status(404).json({ message: 'Lesson not found.' }); }
         if (!lesson.course) { return res.status(500).json({ message: 'Lesson data integrity issue.' }); }
         if (lesson.status !== 'ready') { return res.status(400).json({ message: `Lesson not ready for generation (Status: ${lesson.status}).` }); }

         // Verify ACTIVE Enrollment
         const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
         if (!enrollment) { return res.status(403).json({ message: 'You must be enrolled in the course to generate content.' }); }

         // Call the internal generation logic (handles transcript fetch, AI call, caching)
         // Assuming generateFormatInternal uses req.params.lessonId and req.body.formatType
         await generateFormatInternal(req, res);

     } catch (error) {
         console.error(`Error in student generate format wrapper:`, error);
         if (!res.headersSent) { res.status(500).json({ message: 'Failed to initiate content generation.' }); }
     }
};


//  Get Available Courses Filtered by Subject ***
// exports.getAvailableCoursesBySubject = async (req, res) => {
//     try {
//         const { subjectId } = req.params; // Get subjectId from URL parameter
//         const studentId = req.user.id;

//         if (!mongoose.Types.ObjectId.isValid(subjectId)) {
//             return res.status(400).json({ message: 'Invalid Subject ID format.' });
//         }

//         // Verify subject exists (optional but good practice)
//         const subjectExists = await Subject.findById(subjectId).lean();
//         if (!subjectExists) {
//             return res.status(404).json({ message: 'Subject not found.' });
//         }

//         // Find courses student is already enrolled in OR has a pending/approved request for
//         const [existingEnrollments, existingRequests] = await Promise.all([
//              Enrollment.find({ student: studentId }).select('course').lean(),
//              EnrollmentRequest.find({ student: studentId, status: { $in: ['pending', 'approved'] } }).select('course').lean()
//         ]);

//         const excludedCourseIds = [
//             ...existingEnrollments.map(e => e.course),
//             ...existingRequests.map(r => r.course)
//         ];

//         // Fetch approved courses FOR THIS SUBJECT, excluding already enrolled/requested ones
//         const courses = await Course.find({
//                 subject: subjectId,             // Filter by the specific subject
//                 status: 'approved',
//                 _id: { $nin: excludedCourseIds } // Exclude courses student has access to/requested
//              })
//             .select('name subject teacher description price') // Select relevant fields
//             .populate('teacher', 'username')
//             // No need to populate subject again as we filtered by it
//             .sort({ createdAt: -1 })
//             .lean();

//         res.status(200).json(courses);
//     } catch (error) {
//         console.error(`Error fetching available courses for subject ${req.params.subjectId}:`, error);
//         res.status(500).json({ message: 'Failed to fetch available courses for this subject.' });
//     }
// };
exports.getCourseCategory = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { subjectId } = req.params;

        let courseQuery = { status: 'approved' };

        if (subjectId) {
            if (!mongoose.Types.ObjectId.isValid(subjectId)) { return res.status(400).json({ message: 'Invalid Subject ID format.' }); }
            courseQuery.subject = subjectId;
        }

        // Find excluded courses
        const [existingEnrollments, existingRequests] = await Promise.all([
             Enrollment.find({ student: studentId }).select('course').lean()
            // EnrollmentRequest.find({ student: studentId, status: { $in: ['pending', 'approved'] } }).select('course').lean()
        ]);
        const excludedCourseIds = [
            ...existingEnrollments.map(e => e.course)
        ];
        courseQuery._id = { $nin: excludedCourseIds };

        // Fetch available courses
        const courses = await Course.find(courseQuery)
            .select('name subject teacher description price createdAt') // Fields for catalog card
            .populate('teacher', 'username')
            .populate('subject', 'name')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json(courses);
    } catch (error) { 
         console.error(`Error fetching course catalog (Subject: ${req.params.subjectId}):`, error);
        res.status(500).json({ message: 'Failed to fetch available courses.' });
    }
};
/////////////////////////////// Enrollments 
exports.requestEnrollment = async (req, res) => {
    try {
        const { courseId } = req.params;
        const studentId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(courseId)) { return res.status(400).json({ message: 'Invalid Course ID.' }); }

        // --- Fetch Course, check status, price ---
        const course = await Course.findById(courseId).select('status price name teacher').lean();
        if (!course) { return res.status(404).json({ message: 'Course not found.' }); }
        if (course.status !== 'approved') { return res.status(400).json({ message: 'This course is not currently available for enrollment.' }); }
        
        if (!course.teacher || !mongoose.Types.ObjectId.isValid(course.teacher.toString())) {
            console.error(`Course ${courseId} is missing a valid teacher ID. Cannot proceed with enrollment that requires chatroom update via teacherId.`);
            // Decide: either prevent enrollment or allow enrollment but log that chatroom won't be updated.
            // For now, let's throw an error if teacher is absolutely needed.
            return res.status(500).json({ message: 'Course configuration error (missing teacher). Please contact support.' });
        }
               // --- Check if already ACTIVELY enrolled ---
        const existingEnrollment = await Enrollment.findOne({ student: studentId, course: courseId });
        if (existingEnrollment) { return res.status(400).json({ message: 'You are already enrolled in this course.' }); }
         // --- FREE COURSE: Enroll Directly ---
        const coursePrice = course.price ?? 0;
        if (coursePrice <= 0) {
            // --- FREE COURSE: Enroll Directly ---
            console.log(`Course ${courseId} is free. Enrolling student ${studentId} directly.`);
        const enrollment =     await Enrollment.findOneAndUpdate(
                { student: studentId, course: courseId },
                { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
                { upsert: true, new: true, runValidators: true }
            );
             // *** UPDATE CHATROOM MEMBERS ***
      if (enrollment && course.teacher) { // Check if enrollment was successful and teacher exists
                try {
                    await updateChatroomOnEnrollment(
                        courseId.toString(),
                        studentId.toString(),
                        course.teacher.toString(), // Pass teacher ID
                        course.name,
                        'add'
                    );
                 
                } catch (chatError) {
                    console.error(`[Enrollment] Failed to update chatroom for free course ${courseId}, student ${studentId}:`, chatError);
                    // Don't fail the whole enrollment for chat update error, but log it.
                }
            }
            // *** END UPDATE CHATROOM ***
            res.status(201).json({ // Use 201 for resource creation (Enrollment)
                message: 'Successfully enrolled in free course!',
                enrollmentRequestId: null, // No request needed
                clientSecret: null,        // No payment needed
                requiresPayment: false
            });

        }else {
            // --- PAID COURSE: Create Payment Intent ---
             if (!process.env.STRIPE_SECRET_KEY) { throw new Error('Stripe configuration missing.'); } // Moved check here

            try {
                const amountInCents = Math.round(coursePrice * 100);
                if (amountInCents <= 0) { throw new Error("Invalid amount for payment intent."); }

                console.log(`Creating Payment Intent for ${amountInCents} cents, Course: ${courseId}, Student: ${studentId}`);
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd', // CHANGE AS NEEDED
                    // *** CRUCIAL: Store IDs needed by webhook in metadata ***
                    metadata: {
                        studentId: studentId.toString(),
                        courseId: courseId.toString(),
                        courseName: course.name || 'Unknown Course', // Include name for easier identification
                        // Add any other relevant info if needed by webhook
                        teacherId: course.teacher.toString(), // *** ENSURE THIS IS VALID AND PRESENT ***
                        purchaseType: 'single_course'    
                    },
                    automatic_payment_methods: { enabled: true },
                });


                // Respond with client secret for frontend Stripe SDK
                res.status(200).json({ // Use 200 OK as we are returning info needed for next step
                    message: 'Payment required. Please complete payment to enroll.',
                    enrollmentRequestId: null, // No request ID needed for frontend payment flow
                    clientSecret: paymentIntent.client_secret,
                    requiresPayment: true
                });

            } catch (stripeError) {
                console.error("Stripe Payment Intent creation failed:", stripeError);
                return res.status(500).json({ message: `Failed to initialize payment: ${stripeError.message}` });
            }
        }

    } catch (error) {
        console.error("Error requesting enrollment:", error);
        // Distinguish between known errors and internal errors
        const statusCode = error.message.includes('found') || error.message.includes('available') ? 404 : 500;
        res.status(statusCode).json({ message: error.message || 'Failed to request enrollment.' });
    }
};
////////////////////////////////////////////
// Add this to your student controller
exports.requestPackageEnrollment = async (req, res) => {
    try {
        const { courseIds } = req.body;
        const studentId = req.user.id;

        if (!Array.isArray(courseIds) || courseIds.length === 0) {
            return res.status(400).json({ message: 'Course IDs array is required.' });
        }

        // Validate all course IDs
        const validCourseIds = courseIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        if (validCourseIds.length !== courseIds.length) {
            return res.status(400).json({ message: 'Invalid Course IDs provided.' });
        }

        // Fetch all courses and calculate total
        const courses = await Course.find({ 
            _id: { $in: validCourseIds }, 
            status: 'approved' 
        }).select('price name teacher').lean();

        if (courses.length === 0) {
            return res.status(404).json({ message: 'No valid courses found.' });
        }

        // Check for existing enrollments
        const existingEnrollments = await Enrollment.find({ 
            student: studentId, 
            course: { $in: validCourseIds } 
        }).select('course').lean();

        const enrolledCourseIds = existingEnrollments.map(e => e.course.toString());
        const coursesToEnroll = courses.filter(c => !enrolledCourseIds.includes(c._id.toString()));

        if (coursesToEnroll.length === 0) {
            return res.status(400).json({ message: 'You are already enrolled in all selected courses.' });
        }

        // Calculate total price
        const totalPrice = coursesToEnroll.reduce((sum, course) => sum + (course.price ?? 0), 0);

        if (totalPrice <= 0) {
            // Free package - enroll directly
            const enrollments = await Promise.all(
                coursesToEnroll.map(course => 
                    Enrollment.findOneAndUpdate(
                        { student: studentId, course: course._id },
                        { $setOnInsert: { student: studentId, course: course._id, enrolledAt: new Date() } },
                        { upsert: true, new: true, runValidators: true }
                    )
                )
            );

            // Update chatrooms for all courses
            await Promise.all(
                coursesToEnroll.map(course => 
                    updateChatroomOnEnrollment(
                        course._id.toString(),
                        studentId.toString(),
                        course.teacher.toString(),
                        course.name,
                        'add'
                    ).catch(err => console.error(`Chatroom update failed for ${course._id}:`, err))
                )
            );

            return res.status(201).json({
                message: `Successfully enrolled in ${coursesToEnroll.length} free courses!`,
                requiresPayment: false,
                clientSecret: null
            });
        } else {
            // Paid package - create payment intent
            const amountInCents = Math.round(totalPrice * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: 'usd',
                metadata: {
                    studentId: studentId.toString(),
                    packageCourseIds: JSON.stringify(coursesToEnroll.map(c => c._id.toString())),
                    isPackage: 'true',
                    courseCount: coursesToEnroll.length.toString()
                },
                automatic_payment_methods: { enabled: true },
            });

            return res.status(200).json({
                message: `Payment required for ${coursesToEnroll.length} courses package.`,
                requiresPayment: true,
                clientSecret: paymentIntent.client_secret
            });
        }

    } catch (error) {
        console.error("Error requesting package enrollment:", error);
        res.status(500).json({ message: error.message || 'Failed to request package enrollment.' });
    }
};












/////////// ** Student progress** ////////////
exports.getStudentProgress = async (req, res) => {
    try {
        const studentId = req.user.id;
        console.log(`[getStudentProgress] Fetching real progress for student ${studentId}`);

        // 1. Fetch ACTIVE enrollments to know which courses to consider
        const activeEnrollments = await Enrollment.find({ student: studentId })
                                                 .select('course')
                                                 .populate('course', 'name subject') // Populate course name/subject
                                                 .lean();
        if (!activeEnrollments || activeEnrollments.length === 0) {
            return res.status(200).json({ overallCompletion: 0, courses: [], recentActivity: [] }); // No enrollments = no progress
        }
        const enrolledCourseIds = activeEnrollments.map(e => e.course._id);
        const enrolledCoursesMap = new Map(activeEnrollments.map(e => [e.course._id.toString(), e.course])); // Map ID to course details

        // 2. Fetch all progress records for the student for enrolled courses
        const allProgress = await StudentProgress.find({ student: studentId, course: { $in: enrolledCourseIds } })
            .populate('lesson', 'title') // Populate lesson title
            .sort({ lastAccessedAt: -1 }) // Sort by most recent interaction
            .lean();

        // 3. Fetch total lesson counts for enrolled courses
        const lessonCounts = await Lesson.aggregate([
            { $match: { course: { $in: enrolledCourseIds } } },
            { $group: { _id: '$course', totalLessons: { $sum: 1 } } }
        ]);
        const totalLessonsPerCourse = new Map(lessonCounts.map(item => [item._id.toString(), item.totalLessons]));

        // 4. Aggregate/Calculate Summary Stats
        let totalCompletedLessonsAcrossAll = 0;
        let overallTotalLessons = 0;
        const courseProgressMap = new Map();

        totalLessonsPerCourse.forEach((count, courseIdStr) => { overallTotalLessons += count; }); // Sum total lessons

        allProgress.forEach(progress => {
            if (!progress.course || !progress.lesson) return;
            const courseIdStr = progress.course.toString(); // Progress doc only has course ID
            const courseInfo = enrolledCoursesMap.get(courseIdStr); // Get course details from map

            if (!courseProgressMap.has(courseIdStr)) {
                courseProgressMap.set(courseIdStr, {
                    courseId: courseIdStr,
                    courseName: courseInfo?.name ?? 'Unknown Course', // Use fetched name
                    subjectName: courseInfo?.subject ? (courseInfo.subject.name ?? 'N/A') : 'N/A', // Handle populated subject
                    completedLessons: 0,
                    totalLessons: totalLessonsPerCourse.get(courseIdStr) || 0,
                    lastAccessed: progress.lastAccessedAt
                });
            }
            const courseStat = courseProgressMap.get(courseIdStr);
            if (progress.status === 'completed') {
                courseStat.completedLessons++;
                // Increment overall count only once per lesson completion
                // This requires more complex logic if status can toggle; simpler to count here
            }
             // Update lastAccessed if this progress record is newer
            if (progress.lastAccessedAt && (!courseStat.lastAccessed || progress.lastAccessedAt > courseStat.lastAccessed)) {
                courseStat.lastAccessed = progress.lastAccessedAt;
            }
        });

         // Calculate overall completion based ONLY on completed records found
         allProgress.forEach(p => { if(p.status === 'completed') totalCompletedLessonsAcrossAll++; });
         const overallCompletion = overallTotalLessons > 0 ? (totalCompletedLessonsAcrossAll / overallTotalLessons) : 0;


        const courseProgressArray = Array.from(courseProgressMap.values()).map(stat => ({
            ...stat,
            completion: stat.totalLessons > 0 ? (stat.completedLessons / stat.totalLessons) : 0
        })).sort((a,b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)); // Sort by last accessed


        // Format recent activity (take latest N progress records)
         const recentActivity = allProgress.slice(0, 5).map(p => ({
            type: p.status === 'completed' ? 'lesson_completed' : 'lesson_accessed',
            name: p.lesson?.title ?? 'Unknown Lesson',
            timestamp: p.lastAccessedAt ?? p.updatedAt, // Prefer lastAccessedAt
            // Add score or other relevant info if available from progress model
         }));

        res.status(200).json({ overallCompletion, courses: courseProgressArray, recentActivity });

    } catch (error) {
        console.error("Error fetching student progress:", error);
        res.status(500).json({ message: 'Failed to fetch student progress.' });
    }
};


// --- NEW: Progress Update Controllers ---

/**
 * @desc    Mark a lesson as started or completed by the student
 * @route   POST /api/student/progress/lesson/:lessonId/status
 * @body    { status: 'in_progress' | 'completed' }
 * @access  Private (Student Only)
 */
exports.updateLessonProgressStatus = async (req, res) => {
    try {
        const { lessonId } = req.params;
        const { status } = req.body; // 'in_progress' or 'completed'
        const studentId = req.user.id;
        //const studentUsername = req.user.username;
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }
        if (!status || !['in_progress', 'completed'].includes(status)) { return res.status(400).json({ message: 'Invalid status provided.' }); }

        // Fetch lesson to get course ID
        const lesson = await Lesson.findById(lessonId).select('course title').lean();
        if (!lesson || !lesson.course) { return res.status(404).json({ message: 'Lesson or associated course not found.' }); }

        // Verify enrollment
        const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
        if (!enrollment) { return res.status(403).json({ message: 'Not enrolled in this lesson\'s course.' }); }

        // Find or create the progress document and update status/timestamp
        const now = new Date();
        const progressUpdate = await StudentProgress.findOneAndUpdate(
            { student: studentId, course: lesson.course, lesson: lessonId },
            { $set: { status: status, lastAccessedAt: now },
             $setOnInsert: { student: studentId, course: lesson.course, lesson: lessonId, 
                // status: status, lastAccessedAt:
                createdAt:  now } },
            { new: true, upsert: true, runValidators: true ,setDefaultsOnInsert: true}
        ); 

//  // --- Check for Course Completion AFTER updating lesson status ---
//         let certificateGenerated = null;
//         if (status === 'completed') {
//             const courseId = lesson.course;
//             const totalLessonsInCourse = await Lesson.countDocuments({ course: courseId });
//             const completedLessonsForCourse = await StudentProgress.countDocuments({
//                 student: studentId,
//                 course: courseId,
//                 status: 'completed'
//             });

//             console.log(`[CertCheck] Student ${studentId}, Course ${courseId}: ${completedLessonsForCourse}/${totalLessonsInCourse} lessons completed.`);

//             if (totalLessonsInCourse > 0 && completedLessonsForCourse === totalLessonsInCourse) {
//                 console.log(`[CertCheck] Course ${courseId} COMPLETED by student ${studentId}!`);
//                 // Check if certificate already exists for this student and course
//                 let existingCertificate = await Certificate.findOne({ student: studentId, course: courseId });

//                 if (!existingCertificate) {
//                     const courseDetails = await Course.findById(courseId).select('name').lean();
//                     // Student name is already in studentUsername from req.user

//                     const newCertificate = new Certificate({
//                         student: studentId,
//                         course: courseId,
//                         courseName: courseDetails?.name || 'Unnamed Course',
//                         studentName: studentUsername,
//                         completionDate: now,
//                         certificateId: `MID-${courseId.toString().slice(-4)}-${studentId.toString().slice(-4)}-${uuidv4().slice(0, 8)}` // Example unique ID
//                     });
//                     await newCertificate.save();
//                     certificateGenerated = newCertificate; // Pass it back in response
//                     console.log(`[CertCheck] Certificate generated: ${newCertificate.certificateId}`);

//                     // Optional: Send notification
//                     await createNotification({
//                         userId: studentId,
//                         title: '🎉 Course Completed!',
//                         message: `Congratulations! You've completed the course: "${courseDetails?.name || ''}". View your certificate.`,
//                         link: `/student/courses/${courseId}/certificate/${newCertificate._id}`, // Link to view certificate
//                         type: 'success'
//                     });
//                 } else {
//                     console.log(`[CertCheck] Certificate already exists for student ${studentId}, course ${courseId}.`);
//                     certificateGenerated = existingCertificate; // Send existing one
//                 }
//             }
//         }
//         // --- End Course Completion Check ---

        res.status(200).json({
            message: `Lesson marked as ${status}.`,
            progress: progressUpdate,
           // certificate: certificateGenerated // Can be null or the certificate object
        });

    } catch (error) {
        console.error(`Error updating lesson status for ${req.params.lessonId}:`, error);
        res.status(500).json({ message: 'Failed to update lesson progress.' });
    }
};
// --- Progress Update Controllers ---

/**
 * @desc    Update student's flashcard progress for a lesson
 * @route   POST /api/student/progress/lesson/:lessonId/flashcards
 * @body    { knownCards: [String], learningCards: [String], totalCards: Number } // Example structure
 * @access  Private (Student Only)
 */
exports.updateFlashcardProgress = async (req, res) => {
    try {
        const { lessonId } = req.params;
        const studentId = req.user.id;
        // --- Data from Frontend ---
        const { knownCards, learningCards, totalCards } = req.body;

        // --- Validation ---
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }
        // Basic validation for incoming data (add more specific checks if needed)
        if (!Array.isArray(knownCards) || !Array.isArray(learningCards) || typeof totalCards !== 'number') {
            return res.status(400).json({ message: 'Invalid flashcard progress data provided.' });
        }

        // --- Authorization & Lesson Check ---
        const lesson = await Lesson.findById(lessonId).select('course').lean();
        if (!lesson?.course) { return res.status(404).json({ message: 'Lesson or associated course not found.' }); }
        const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
        if (!enrollment) { return res.status(403).json({ message: 'Not enrolled in this lesson\'s course.' }); }

        // --- Update Progress Document ---
        const now = new Date();
        const updateData = {
            'flashcardProgress.knownCards': knownCards,
            'flashcardProgress.learningCards': learningCards,
            'flashcardProgress.totalCards': totalCards,
            'flashcardProgress.lastReviewed': now,
            status: 'in_progress', // Mark lesson as in progress if flashcards are used
            lastAccessedAt: now
        };

        const progressUpdate = await StudentProgress.findOneAndUpdate(
            { student: studentId, course: lesson.course, lesson: lessonId },
            { $set: updateData, $setOnInsert: { student: studentId, course: lesson.course, lesson: lessonId } },
            { new: true, upsert: true, runValidators: true }
        );

        // Optional: Log activity
        // await logStudentActivity(req, 'FLASHCARD_PROG_UPDATED', 'Lesson', lessonId, lesson.title);

        res.status(200).json({ message: 'Flashcard progress updated.', progress: progressUpdate });

    } catch (error) {
        console.error(`Error updating flashcard progress for lesson ${req.params.lessonId}:`, error);
        res.status(500).json({ message: 'Failed to update flashcard progress.' });
    }
};

/**
 * @desc    Submit student's answers for a quiz within a lesson
 * @route   POST /api/student/progress/lesson/:lessonId/quiz/:quizIdentifier
 * @body    { answers: Mixed, score: Number } // Example: answers could be { "q1": "A", "q2": "C", ... }
 * @access  Private (Student Only)
 */
exports.submitQuizAttempt = async (req, res) => {
    try {
        const { lessonId, quizIdentifier } = req.params; // quizIdentifier distinguishes quizzes if multiple per lesson
        const studentId = req.user.id;
        // --- Data from Frontend ---
        const { answers, score } = req.body;

        // --- Validation ---
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }
        if (answers === undefined || typeof score !== 'number') {
            return res.status(400).json({ message: 'Missing or invalid quiz attempt data (answers, score).' });
        }
        // Add more validation for score range (0-100?) and answers format if needed

        // --- Authorization & Lesson Check ---
        const lesson = await Lesson.findById(lessonId).select('course title').lean(); // Select title for logging
        if (!lesson?.course) { return res.status(404).json({ message: 'Lesson or associated course not found.' }); }
        const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
        if (!enrollment) { return res.status(403).json({ message: 'Not enrolled in this lesson\'s course.' }); }

        // --- Update Progress Document ---
        // Create the new attempt object
        const now = new Date();
        const newAttempt = {
            quizId: quizIdentifier, // Store which quiz was attempted
            score: score,
            answers: answers,
            attemptedAt: now
        };

        // Find or create the progress document and push the new attempt
        const progressUpdate = await StudentProgress.findOneAndUpdate(
            { student: studentId, course: lesson.course, lesson: lessonId },
            {
                $push: { quizAttempts: newAttempt }, // Add new attempt to the array
                $set: { lastAccessedAt: now, status: 'in_progress' } // Update last accessed and status
            },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true } // Ensure defaults are set on upsert
        );

         // Optional: Log activity
         // await logStudentActivity(req, 'QUIZ_ATTEMPT_SUBMITTED', 'Lesson', lessonId, lesson.title, { quizId: quizIdentifier, score: score });

        res.status(200).json({ message: 'Quiz attempt submitted.', progress: progressUpdate });

    } catch (error) {
        console.error(`Error submitting quiz attempt for lesson ${req.params.lessonId}:`, error);
        res.status(500).json({ message: 'Failed to submit quiz attempt.' });
    }
};

/**
 * @desc    Submit student's answers for a worksheet within a lesson
 * @route   POST /api/student/progress/lesson/:lessonId/worksheet
 * @body    { answers: Mixed } // Example: answers could be { "q1_answer": "...", "q2_answer": "..." }
 * @access  Private (Student Only)
 */
exports.submitWorksheet = async (req, res) => {
     try {
        const { lessonId } = req.params;
        const studentId = req.user.id;
        // --- Data from Frontend ---
        const { answers } = req.body;

        // --- Validation ---
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID.' }); }
        if (answers === undefined) {
            return res.status(400).json({ message: 'Missing worksheet answers.' });
        }
        // Add more validation for answers format if needed

        // --- Authorization & Lesson Check ---
        const lesson = await Lesson.findById(lessonId).select('course title').lean();
        if (!lesson?.course) { return res.status(404).json({ message: 'Lesson or associated course not found.' }); }
        const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
        if (!enrollment) { return res.status(403).json({ message: 'Not enrolled in this lesson\'s course.' }); }

        // --- Update Progress Document ---
        const now = new Date();
        const updateData = {
            worksheetSubmitted: true,
            worksheetAnswers: answers,
            submittedAt: now, // Use a specific submission timestamp
            status: 'in_progress', // Or maybe 'completed' depending on workflow
            lastAccessedAt: now
        };

        const progressUpdate = await StudentProgress.findOneAndUpdate(
            { student: studentId, course: lesson.course, lesson: lessonId },
            { $set: updateData, $setOnInsert: { student: studentId, course: lesson.course, lesson: lessonId } },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );

         // Optional: Log activity
         // await logStudentActivity(req, 'WORKSHEET_SUBMITTED', 'Lesson', lessonId, lesson.title);

        res.status(200).json({ message: 'Worksheet submitted.', progress: progressUpdate });

    } catch (error) {
        console.error(`Error submitting worksheet for lesson ${req.params.lessonId}:`, error);
        res.status(500).json({ message: 'Failed to submit worksheet.' });
    }
};
/**
 * @desc    Submit worksheet answers AND trigger AI evaluation
 * @route   POST /api/student/progress/lesson/:lessonId/worksheet/evaluate
 * @body    { answers: { "question_text_1": "student_answer_1", ... } }
 * @access  Private (Student Only, Enrolled)
 */

exports.submitAndEvaluateWorksheet = async (req, res) => {
    if (!genAI) {
        return res.status(503).json({ message: 'AI Evaluation Service is not configured or unavailable.' });
    }

    try {
        const { lessonId } = req.params;
        const studentId = req.user.id; // From 'protect' middleware
        const studentProvidedAnswers = req.body.answers; // e.g., { "q_1_answer": "text", "q_2_answer": "text" }

        // --- Validation ---
        if (!mongoose.Types.ObjectId.isValid(lessonId)) { return res.status(400).json({ message: 'Invalid Lesson ID format.' }); }
        if (!studentProvidedAnswers || typeof studentProvidedAnswers !== 'object' || Object.keys(studentProvidedAnswers).length === 0) {
            return res.status(400).json({ message: 'Worksheet answers are missing or in an invalid format.' });
        }

        // --- Authorization & Fetch Necessary Data ---
        console.log(`[WorksheetEval] Evaluating for Lesson: ${lessonId}, Student: ${studentId}`);
        const lesson = await Lesson.findById(lessonId).select('course title transcript objectives').lean();
        if (!lesson?.course) { return res.status(404).json({ message: 'Lesson or its associated course not found.' }); }
        if (!lesson.transcript) { return res.status(400).json({ message: 'Lesson transcript is unavailable, cannot evaluate answers.' });}

        const enrollment = await Enrollment.findOne({ student: studentId, course: lesson.course }).lean();
        if (!enrollment) { return res.status(403).json({ message: 'You are not enrolled in this lesson\'s course.' }); }

        // Fetch the original worksheet questions generated by AI
        const originalWorksheetData = await GeneratedContent.findOne({ lesson: lessonId, formatType: 'worksheets' }).lean();
        if (!originalWorksheetData || !Array.isArray(originalWorksheetData.content) || originalWorksheetData.content.length === 0) {
            return res.status(404).json({ message: 'Original worksheet questions not found for this lesson. Cannot evaluate.' });
        }
        const originalQuestions = originalWorksheetData.content; // Array of { question: "", guideline: "" }
        console.log(`[WorksheetEval] Found ${originalQuestions.length} original questions.`);

        // --- AI Evaluation for each answer ---
        const evaluations = [];
        let allAIEvaluationsSucceeded = true; // Flag to track if all AI calls were successful

        for (let i = 0; i < originalQuestions.length; i++) {
            const originalQuestionData = originalQuestions[i];
            const questionText = originalQuestionData.question;
            // Key for student's answer, e.g., "q_1_answer", "q_2_answer"
            // This MUST match how the frontend structures the 'answers' object in the request body
            const studentAnswerKey = `q_${i + 1}_answer`;
            const studentAnswerText = studentProvidedAnswers[studentAnswerKey] || "No answer provided.";

            // Construct prompt for Gemini
            const evaluationPrompt = `
                You are an expert tutor evaluating a student's answer to a worksheet question based on a lesson.
                Lesson Topic: "${lesson.title}"
                Lesson Objectives: "${lesson.objectives}"
                Original Question: "${questionText}"
                Student's Submitted Answer: "${studentAnswerText}"

                Based on the provided lesson transcript below, please perform the following:
                1.  Determine if the student's answer is conceptually correct and relevant to the question and the lesson's objectives.
                2.  Provide concise, constructive feedback (1-3 sentences) for the student. If correct, affirm their understanding. If incorrect or partially correct, gently guide them towards a better answer by referencing concepts from the transcript or objectives.
                3.  Assign a score from 1 (Poor/Irrelevant) to 5 (Excellent/Comprehensive) for this specific answer.

                Return your evaluation ONLY as a valid JSON object with the following exact keys:
                - "isCorrectConceptually": boolean (true if the core concept is understood, false otherwise)
                - "feedback": string (your constructive feedback)
                - "score": number (integer from 1 to 5)

                Example of desired JSON output:
                {"isCorrectConceptually": true, "feedback": "Your explanation of photosynthesis correctly identifies the key reactants and products. Well done!", "score": 5}

                Lesson Transcript for context:
                """
                ${lesson.transcript}
                """
            `;

            console.log(`[WorksheetEval - AI] Evaluating Q${i+1} for Lesson ${lessonId}: "${questionText}"`);
            try {
                const model = genAI.getGenerativeModel({
                    model: "gemini-1.5-flash-latest", // Or "gemini-1.5-flash-latest"
                     safetySettings: [
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                      ],
                      generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }, // Adjust as needed
                });
                const result = await model.generateContent(evaluationPrompt);
                const response = result.response;

                // More robust response checking from Gemini SDK
                if (!response || !response.candidates || response.candidates.length === 0 || !response.text) {
                     const blockReason = response?.promptFeedback?.blockReason;
                     const finishReason = response?.candidates?.[0]?.finishReason;
                     console.error(`[WorksheetEval - AI] No valid response from AI for Q${i+1}. Block: ${blockReason}, Finish: ${finishReason}`);
                     throw new Error(`AI did not provide a valid response. BlockReason: ${blockReason}, FinishReason: ${finishReason}`);
                }

                const aiResponseText = response.text();
                // console.log(`[WorksheetEval - AI] Raw AI response for Q${i+1}:`, aiResponseText); // DEBUG
                const cleanJsonString = aiResponseText.replace(/^```json\s*([\s\S]*?)\s*```$/gm, '$1').trim();
                const aiEval = JSON.parse(cleanJsonString);

                if (typeof aiEval.isCorrectConceptually !== 'boolean' || typeof aiEval.feedback !== 'string' || typeof aiEval.score !== 'number') {
                    throw new Error('AI evaluation response has an invalid JSON structure.');
                }

                evaluations.push({
                    questionText: questionText, // Store original question for clarity
                    studentAnswer: studentAnswerText,
                    aiFeedback: aiEval.feedback,
                    aiScore: Math.min(5, Math.max(1, Math.round(aiEval.score))), // Clamp score 1-5
                    isCorrectConceptually: aiEval.isCorrectConceptually
                });
                console.log(`[WorksheetEval - AI] Successfully evaluated Q${i+1}. Score: ${aiEval.score}`);

            } catch (aiError) {
                console.error(`[WorksheetEval - AI] Error evaluating Q${i+1} for lesson ${lessonId}:`, aiError.message);
                allAIEvaluationsSucceeded = false;
                evaluations.push({
                    questionText: questionText,
                    studentAnswer: studentAnswerText,
                    aiFeedback: "Could not automatically evaluate this answer due to an AI processing error. Please try again later or ask your teacher for feedback.",
                    aiScore: 0,
                    isCorrectConceptually: false
                });
                // Optionally, decide if you want to stop all evaluations if one fails
                // For now, it continues and tries to evaluate other answers
            }
        }
        console.log(`[WorksheetEval] Finished AI evaluations. Success count: ${evaluations.filter(e=>e.aiScore > 0).length}/${originalQuestions.length}`);

        // --- Save to StudentProgressModel ---
        const now = new Date();
        const progressUpdateFields = {
            worksheetSubmitted: true,
            worksheetOriginalAnswers: studentProvidedAnswers, // Save student's raw input
            worksheetSubmittedAt: now,
            'worksheetEvaluation.evaluatedAt': now,
            'worksheetEvaluation.answersEvaluation': evaluations, // Array of evaluations
            // Determine overall status based on evaluations or keep as 'in_progress' until reviewed by teacher
            status: allAIEvaluationsSucceeded ? 'in_progress' : 'error_in_evaluation', // Example new status
            lastAccessedAt: now
        };
         // Add overallFeedback if you plan to generate one
         // progressUpdateFields['worksheetEvaluation.overallFeedback'] = "Some overall feedback...";

        const updatedProgress = await StudentProgress.findOneAndUpdate(
            { student: studentId, course: lesson.course, lesson: lessonId },
            { $set: progressUpdateFields },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        console.log(`[WorksheetEval] Student progress updated for Lesson ${lessonId}.`);

        // --- Respond to Frontend ---
        let responseMessage = 'Worksheet submitted and AI evaluation completed.';
        if (!allAIEvaluationsSucceeded) {
             responseMessage = 'Worksheet submitted. Some answers could not be automatically evaluated by AI.';
        }

        res.status(allAIEvaluationsSucceeded ? 200 : 207) // 207 Multi-Status if partial success
            .json({
                message: responseMessage,
                progress: updatedProgress, // Send back the updated progress document
                evaluations: evaluations   // Send back the detailed evaluations
            });

    } catch (error) {
        console.error(`[WorksheetEval] General Error for lesson ${req.params.lessonId}:`, error);
        res.status(500).json({ message: `Server error during worksheet submission/evaluation: ${error.message}` });
    }
};
/**
 * @desc    Add a course to student's favorites
 * @route   POST /api/student/favorites/:courseId
 * @access  Private (Student Only)
 */
exports.addCourseToFavorites = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID.' });
        }

        // 1. Check if student is enrolled in the course (optional, but good practice)
        const enrollment = await Enrollment.findOne({ student: studentId, course: courseId });
        if (!enrollment) {
            return res.status(403).json({ message: 'You must be enrolled in this course to add it to favorites.' });
        }

        // 2. Add course to favorites if not already there
        // Use $addToSet to prevent duplicates
        const updatedStudent = await User.findByIdAndUpdate(
            studentId,
            { $addToSet: { favoriteCourses: courseId } },
            { new: true, select: 'favoriteCourses username' } // Return updated favorites and username for confirmation
        ).populate('favoriteCourses', 'name subject'); // Optionally populate for immediate feedback

        if (!updatedStudent) {
            return res.status(404).json({ message: 'Student not found.' });
        }

        res.status(200).json({
            message: 'Course added to favorites.',
            favorites: updatedStudent.favoriteCourses
        });

    } catch (error) {
        console.error("Error adding course to favorites:", error);
        res.status(500).json({ message: 'Failed to add course to favorites.' });
    }
};

/**
 * @desc    Remove a course from student's favorites
 * @route   DELETE /api/student/favorites/:courseId
 * @access  Private (Student Only)
 */
exports.removeCourseFromFavorites = async (req, res) => {
    try {
        const studentId = req.user.id;
        const { courseId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID.' });
        }

        // Use $pull to remove the courseId from the array
        const updatedStudent = await User.findByIdAndUpdate(
            studentId,
            { $pull: { favoriteCourses: courseId } },
            { new: true, select: 'favoriteCourses username' }
        ).populate('favoriteCourses', 'name subject');

        if (!updatedStudent) {
            return res.status(404).json({ message: 'Student not found.' });
        }

        res.status(200).json({
            message: 'Course removed from favorites.',
            favorites: updatedStudent.favoriteCourses
        });

    } catch (error) {
        console.error("Error removing course from favorites:", error);
        res.status(500).json({ message: 'Failed to remove course from favorites.' });
    }
};
/**
 * @desc    Get student's favorite courses
 * @route   GET /api/student/favorites
 * @access  Private (Student Only - ensured by router-level middleware)
 */
exports.getFavoriteCourses = async (req, res) => {
    try {
        const studentId = req.user.id; // Get ID from 'protect' middleware

        if (!studentId) { // Should ideally be caught by 'protect' if req.user isn't set
            return res.status(401).json({ message: 'User not authenticated.' });
        }

        console.log(`[GetFavorites] Fetching favorite courses for student: ${studentId}`);

        // Find the student and populate their favoriteCourses
        // Only select necessary fields from the populated courses
        const studentWithFavorites = await User.findById(studentId)
            .select('favoriteCourses') // We only need this field from the User document itself
            .populate({
                path: 'favoriteCourses', // The field in the User model to populate
                match: { status: 'approved' }, // IMPORTANT: Only show courses that are currently approved
                select: 'name description subject teacher price status createdAt ratingAverage reviewCount lessonCount durationEstimate', // Select fields you want to display for each favorite course
                populate: [ // Nested populate for details within each course
                    {
                        path: 'teacher', // Field 'teacher' within each 'Course' document
                        select: 'username email _id' // Public teacher info
                    },
                    {
                        path: 'subject', // Field 'subject' within each 'Course' document
                        select: 'name _id'   // Subject name
                    }
                ]
            })
            .lean(); // Use .lean() for plain JavaScript objects, good for read-only operations

        if (!studentWithFavorites) {
            console.log(`[GetFavorites] Student not found: ${studentId}`);
            return res.status(404).json({ message: 'Student not found.' });
        }

 
        const validFavoriteCourses = studentWithFavorites.favoriteCourses?.filter(course => course !== null) || [];

        console.log(`[GetFavorites] Found ${validFavoriteCourses.length} valid favorite courses for student: ${studentId}`);
        res.status(200).json(validFavoriteCourses); // Send the array of populated favorite courses

    } catch (error) {
        console.error("[GetFavorites] Error fetching favorite courses:", error);
        res.status(500).json({ message: 'Failed to fetch favorite courses.' });
    }
};