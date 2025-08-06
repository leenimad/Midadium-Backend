// // backend/controllers/webhookController.js
// //THIS CODE WORKS GREAT FOR COURSE ENROLLMENTS 
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// //const EnrollmentRequest = require('../models/EnrollmentRequestModel');
// const Enrollment = require('../models/EnrollmentModel'); // *** IMPORT Enrollment ***
// const User = require('../models/UserModel');       // Needed for logging/notifications
// const Course = require('../models/courseModel');     // Needed for logging/notifications
// // const ActivityLog = require('../models/ActivityLogModel'); // If logging webhook events
// // Get the webhook signing secret from your environment variables
// const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Get this from Stripe dashboard
// const { updateChatroomOnEnrollment } = require('../utils/chatroomUtils');  

// // Optional logging helper instance for webhooks (doesn't have req object)
// const logWebhookActivity = async (actionType, targetType, targetId, targetName, details) => {
//   try {
//     // Find admin user to attribute log? Or use a system actor?
//     // const admin = await User.findOne({ role: 'admin' }).lean();
//     // await ActivityLog.create({ actorId: admin?._id || null, actorUsername: 'System (Webhook)', actionType, targetType, targetId, targetName, details });
//     console.log(`Webhook Activity: ${actionType} on ${targetType || 'System'} ${targetName ? `(${targetName})` : ''}`);
//   } catch(e) { console.error("Failed to log webhook activity:", e); }
// };

// exports.handleStripeWebhook = async (req, res) => {
//     const sig = req.headers['stripe-signature'];
//     let event;

//     if (!endpointSecret) {
//         console.error("[Webhook] CRITICAL: STRIPE_WEBHOOK_SECRET not set!");
//         return res.status(500).send('Webhook secret not configured.');
//     }

//     try {
//         event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
//         console.log(`[Webhook] Received Stripe event: ${event.type}`);
//     } catch (err) {
//         console.error(`[Webhook] Error verifying signature: ${err.message}`);
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     // Handle the event
//     switch (event.type) {
//         case 'payment_intent.succeeded':
//             const paymentIntentSucceeded = event.data.object;
//             console.log(`[Webhook] PaymentIntent succeeded: ${paymentIntentSucceeded.id}`);
//             // Extract metadata saved during creation
//             const metadata = paymentIntentSucceeded.metadata;
//             const studentId = metadata?.studentId;
//             const courseId = metadata?.courseId;
//             const courseName = metadata?.courseName || '?'; // Get course name if saved
//            const teacherId = metadata?.teacherId;
//             if (!studentId || !courseId) {
//                 console.error(`[Webhook] Missing studentId or courseId in PaymentIntent metadata for PI: ${paymentIntentSucceeded.id}`);
//                 // Critical error - can't link payment to enrollment
//                 // Potentially log this for manual intervention
//                 return res.status(400).json({ error: 'Webhook processing error: Missing metadata.' });
//             }

//             // *** CREATE ENROLLMENT DIRECTLY ***
//             try {
//                  console.log(`[Webhook] Attempting to create enrollment for Student ${studentId}, Course ${courseId}`);
//                  // Use findOneAndUpdate with upsert to prevent duplicates if webhook retries
//                  const enrollment = await Enrollment.findOneAndUpdate(
//                      { student: studentId, course: courseId }, // Find criteria
//                      { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } }, // Data if inserting
//                      { new: true, upsert: true, runValidators: true } // Options
//                  );
//                 const courseForTeacherId = await Course.findById(courseId).select('teacher').lean(); // Need teacher ID

//                 // *** UPDATE CHATROOM MEMBERS ***
//                 if (enrollment && courseForTeacherId && courseForTeacherId.teacher) {
//                    await updateChatroomOnEnrollment(courseId, studentId, courseForTeacherId.teacher, courseName, 'add');
//                 }
//                  console.log(`[Webhook] Enrollment created/confirmed for Student ${studentId}, Course ${courseId}. Enrollment ID: ${enrollment._id}`);

//                  // Optional: Log activity
//                  // await logWebhookActivity('STUDENT_ENROLLMENT_PAID', 'Enrollment', enrollment._id, `Course: ${courseName}`);

//                  // Optional: Send confirmation email to student

//             } catch (dbError) {
//                  console.error(`[Webhook] DB Error creating enrollment for PaymentIntent ${paymentIntentSucceeded.id} (Student: ${studentId}, Course: ${courseId}):`, dbError);
//                  // Return 500 so Stripe might retry (depending on your webhook settings)
//                  return res.status(500).json({ error: 'Database error processing enrollment.' });
//             }
//             break; // End payment_intent.succeeded case

//         case 'payment_intent.payment_failed':
//             const paymentIntentFailed = event.data.object;
//             console.warn(`[Webhook] PaymentIntent failed: ${paymentIntentFailed.id}, Reason: ${paymentIntentFailed.last_payment_error?.message}`);
//             // Log this failure. You might want to notify the student or admin.
//             // No enrollment is created. If you were using EnrollmentRequest, you'd update its status to 'failed'.
//              // Optional: Log activity
//              // await logWebhookActivity('STUDENT_PAYMENT_FAILED', 'PaymentIntent', paymentIntentFailed.id, `Course: ${paymentIntentFailed.metadata?.courseName || '?'}`, { reason: paymentIntentFailed.last_payment_error?.message });
//             break;

//         default:
//             console.log(`[Webhook] Unhandled event type ${event.type}`);
//     }

//     // Return a 200 response to acknowledge receipt of the event
//     res.status(200).json({ received: true });
// };

///////////////////////////////////////////
// does not work 
// // backend/controllers/webhookController.js
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const Enrollment = require('../models/EnrollmentModel');
// const Course = require('../models/courseModel');
// const User = require('../models/UserModel'); // For logging actor if needed
// const { updateChatroomOnEnrollment } = require('../utils/chatroomUtils');
// const mongoose = require('mongoose');

// const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// // Optional logging helper
// const logWebhookActivity = async (actionType, targetInfo, details) => {
//   try {
//     console.log(`[WEBHOOK ACTIVITY] Action: ${actionType}, Target: ${targetInfo}, Details: ${JSON.stringify(details || {})}`);
//   } catch(e) { console.error("Failed to log webhook activity:", e); }
// };


// // --- Helper Function to Process Single Course Enrollment ---
// async function handleSingleCourseEnrollment(paymentIntent) {
//     const metadata = paymentIntent.metadata;
//     const studentId = metadata?.studentId;
//     const courseId = metadata?.courseId;
//     const courseName = metadata?.courseName || 'Unknown Course';
//     const teacherId = metadata?.teacherId; // This should be passed from requestEnrollment

//     if (!studentId || !courseId || !teacherId) {
//         console.error(`[Webhook-SingleCourse] CRITICAL: Missing studentId, courseId, or teacherId in metadata for PI: ${paymentIntent.id}.`);
//         await logWebhookActivity('WEBHOOK_METADATA_ERROR_SINGLE', `PI: ${paymentIntent.id}`, { error: "Missing studentId, courseId, or teacherId" });
//         // We can't throw an HTTP response here, so we just log and return a failure indicator
//         return { success: false, error: 'Missing critical metadata for single course enrollment.' };
//     }
//     if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(teacherId) || !mongoose.Types.ObjectId.isValid(studentId)) {
//         console.error(`[Webhook-SingleCourse] Invalid ID format in metadata for PI: ${paymentIntent.id}`);
//         await logWebhookActivity('WEBHOOK_METADATA_ERROR_SINGLE', `PI: ${paymentIntent.id}`, { error: "Invalid ID format" });
//         return { success: false, error: 'Invalid ID format in metadata.' };
//     }

//     console.log(`[Webhook-SingleCourse] Processing enrollment for Student: ${studentId}, Course: ${courseId}`);
//     try {
//         const enrollment = await Enrollment.findOneAndUpdate(
//             { student: studentId, course: courseId },
//             { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
//             { new: true, upsert: true, runValidators: true }
//         );
//         console.log(`[Webhook-SingleCourse] Enrollment created/confirmed. ID: ${enrollment._id}`);

//         await updateChatroomOnEnrollment(courseId, studentId, teacherId, courseName, 'add');
//         await logWebhookActivity('SINGLE_COURSE_ENROLLED', `PI: ${paymentIntent.id}`, { studentId, courseId, courseName });
//         return { success: true, enrollmentId: enrollment._id };
//     } catch (dbError) {
//         console.error(`[Webhook-SingleCourse] DB Error creating enrollment for PI ${paymentIntent.id} (Student: ${studentId}, Course: ${courseId}):`, dbError);
//         return { success: false, error: `Database error: ${dbError.message}` };
//     }
// }

// // --- Helper Function to Process Roadmap Package Enrollment ---
// async function handleRoadmapPackageEnrollment(paymentIntent) {
//     const metadata = paymentIntent.metadata;
//     const studentId = metadata?.studentId; // Already checked by caller
//     const roadmapCourseIdsString = metadata?.roadmapCourseIds;
//     const learningGoal = metadata?.learningGoal || 'Roadmap Package';

//     if (!roadmapCourseIdsString) {
//         console.error(`[Webhook-Roadmap] Missing roadmapCourseIds in metadata for PI: ${paymentIntent.id}, Student: ${studentId}`);
//         await logWebhookActivity('WEBHOOK_METADATA_ERROR_PACKAGE', `PI: ${paymentIntent.id}`, { studentId, error: "Missing roadmapCourseIds for package" });
//         return { success: false, error: 'Missing roadmap course IDs for package.' };
//     }

//     let courseIdsToEnroll = [];
//     try {
//         courseIdsToEnroll = JSON.parse(roadmapCourseIdsString);
//         if (!Array.isArray(courseIdsToEnroll) || courseIdsToEnroll.some(id => !mongoose.Types.ObjectId.isValid(id))) {
//             throw new Error("roadmapCourseIds is not a valid array of ObjectIds.");
//         }
//     } catch (parseError) {
//         console.error(`[Webhook-Roadmap] Failed to parse roadmapCourseIds: "${roadmapCourseIdsString}" for PI: ${paymentIntent.id}`, parseError);
//         await logWebhookActivity('WEBHOOK_PROCESSING_ERROR_PACKAGE', `PI: ${paymentIntent.id}`, { studentId, error: "Invalid roadmapCourseIds format" });
//         return { success: false, error: 'Invalid roadmapCourseIds format in metadata.' };
//     }

//     console.log(`[Webhook-Roadmap] Processing package enrollment for student ${studentId} in ${courseIdsToEnroll.length} courses for goal: "${learningGoal}"`);
//     let successfulEnrollments = 0;
//     const individualEnrollmentResults = []; // To track each enrollment outcome

//     for (const courseId of courseIdsToEnroll) {
//         try {
//             const course = await Course.findById(courseId).select('name teacher').lean();
//             if (!course) {
//                 console.warn(`[Webhook-Roadmap] Course ${courseId} not found. Skipping for student ${studentId}.`);
//                 individualEnrollmentResults.push({ courseId, status: 'failed', reason: 'Course not found' });
//                 continue;
//             }
//             if (!course.teacher) {
//                 console.warn(`[Webhook-Roadmap] Course ${courseId} missing teacher. Chatroom update will be skipped for this course.`);
//             }

//             await Enrollment.findOneAndUpdate(
//                 { student: studentId, course: courseId },
//                 { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
//                 { new: true, upsert: true, runValidators: true }
//             );

//             if (course.teacher) {
//                 await updateChatroomOnEnrollment(courseId, studentId, course.teacher.toString(), course.name, 'add');
//             }
//             successfulEnrollments++;
//             individualEnrollmentResults.push({ courseId, status: 'success' });
//             console.log(`[Webhook-Roadmap] Student ${studentId} enrolled in course ${courseId}.`);
//         } catch (enrollError) {
//             console.error(`[Webhook-Roadmap] Error enrolling student ${studentId} in course ${courseId} (PI: ${paymentIntent.id}):`, enrollError);
//             individualEnrollmentResults.push({ courseId, status: 'failed', reason: enrollError.message });
//         }
//     }
//     await logWebhookActivity('ROADMAP_PACKAGE_PROCESSED', `PI: ${paymentIntent.id}`, { studentId, learningGoal, successful: successfulEnrollments, totalAttempted: courseIdsToEnroll.length, results: individualEnrollmentResults });
//     console.log(`[Webhook-Roadmap] Package processed for student ${studentId}. Success: ${successfulEnrollments}, Total: ${courseIdsToEnroll.length}`);
//     // Even if some internal enrollments fail, the payment was successful.
//     // We return success to Stripe for the webhook itself. Internal failures should be logged for monitoring.
//     return { success: true, successfulEnrollments, totalCoursesInPackage: courseIdsToEnroll.length };
// }


// // --- Main Webhook Handler ---
// exports.handleStripeWebhook = async (req, res) => {
//     const sig = req.headers['stripe-signature'];
//     let event;

//     if (!endpointSecret) {
//         console.error("[Webhook] CRITICAL: STRIPE_WEBHOOK_SECRET not set!");
//         await logWebhookActivity('WEBHOOK_CONFIG_ERROR', 'System', { error: 'Missing STRIPE_WEBHOOK_SECRET'});
//         return res.status(500).send('Webhook secret not configured.');
//     }

//     try {
//         event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
//         console.log(`[Webhook] Received Stripe event: ${event.id}, Type: ${event.type}`);
//     } catch (err) {
//         console.error(`[Webhook] Error verifying signature for event ID (if available in payload): ${req.body?.id || 'N/A'}: ${err.message}`);
//         await logWebhookActivity('WEBHOOK_SIGNATURE_ERROR', 'IncomingEvent', { errorMessage: err.message });
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     // Process the event
//     const paymentIntent = event.data.object;
//     const metadata = paymentIntent.metadata;
//     const studentId = metadata?.studentId;

//     let processingResult;

//     switch (event.type) {
//         case 'payment_intent.succeeded':
//             if (!studentId) {
//                 console.error(`[Webhook] CRITICAL: Missing studentId in PaymentIntent metadata for PI: ${paymentIntent.id}.`);
//                 await logWebhookActivity('WEBHOOK_METADATA_ERROR', `PI: ${paymentIntent.id}`, { error: "Missing studentId" });
//                 return res.status(400).json({ error: 'Webhook processing error: Missing studentId in metadata.' });
//             }

//             const purchaseType = metadata?.purchaseType || 'single_course';
//             if (purchaseType === 'roadmap_package') {
//                 processingResult = await handleRoadmapPackageEnrollment(paymentIntent);
//             } else { // Default to single_course purchase
//                 processingResult = await handleSingleCourseEnrollment(paymentIntent);
//             }

//             // Check if the helper function indicated a critical failure in its own logic
//             if (processingResult && !processingResult.success) {
//                  // The helper function already logged details.
//                  // We return 400 or 500 based on what the helper decided was appropriate if it could respond.
//                  // Since helpers now return objects instead of res.status, we send it here.
//                  // However, for Stripe, if we could *receive* the event, we should ideally return 200 to prevent retries,
//                  // and handle internal processing errors via logging/monitoring.
//                  // For now, let's assume if a helper returns success:false, it was a metadata/data integrity issue
//                  // that Stripe can't fix by retrying.
//                  console.error(`[Webhook] Processing failed for ${purchaseType}, PI: ${paymentIntent.id}. Error: ${processingResult.error}`);
//                  return res.status(400).json({ error: `Webhook handling error: ${processingResult.error}` });
//             }
//             break;

//         case 'payment_intent.payment_failed':
//             const paymentIntentFailed = event.data.object; // Already defined as paymentIntent
//             console.warn(`[Webhook] PaymentIntent failed: ${paymentIntent.id}, Student: ${studentId}, Reason: ${paymentIntent.last_payment_error?.message}`);
//             await logWebhookActivity('PAYMENT_FAILED', `PI: ${paymentIntent.id}`, { studentId, reason: paymentIntent.last_payment_error?.message });
//             break;

//         case 'payment_intent.created':
//             console.log(`[Webhook] PaymentIntent created: ${paymentIntent.id}. No enrollment action needed.`);
//             break;

//         default:
//             console.log(`[Webhook] Unhandled event type: ${event.type}, ID: ${event.id}`);
//     }

//     // Always return a 200 response to Stripe to acknowledge receipt,
//     // unless there was a signature verification error or a critical unrecoverable issue.
//     // Internal processing failures should be logged for manual review.
//     res.status(200).json({ received: true });
// };
// backend/controllers/webhookController.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
//const EnrollmentRequest = require('../models/EnrollmentRequestModel');
const Enrollment = require('../models/EnrollmentModel'); // *** IMPORT Enrollment ***
const User = require('../models/UserModel');       // Needed for logging/notifications
const Course = require('../models/courseModel');     // Needed for logging/notifications
// const ActivityLog = require('../models/ActivityLogModel'); // If logging webhook events
// Get the webhook signing secret from your environment variables
const mongoose = require('mongoose');
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Get this from Stripe dashboard
const { updateChatroomOnEnrollment } = require('../utils/chatroomUtils');
// Optional logging helper instance for webhooks (doesn't have req object)
const logWebhookActivity = async (actionType, targetType, targetId, targetName, details) => {
try {
// Find admin user to attribute log? Or use a system actor?
// const admin = await User.findOne({ role: 'admin' }).lean();
// await ActivityLog.create({ actorId: admin?._id || null, actorUsername: 'System (Webhook)', actionType, targetType, targetId, targetName, details });
  console.log(`Webhook Activity: ${actionType} on ${targetType || 'System'} ${targetName ? `(${targetName})` : ''}`);
} catch(e) { console.error("Failed to log webhook activity:", e); }
};
exports.handleStripeWebhook = async (req, res) => {
const sig = req.headers['stripe-signature'];
let event;
if (!endpointSecret) {
    console.error("[Webhook] CRITICAL: STRIPE_WEBHOOK_SECRET not set!");
    return res.status(500).send('Webhook secret not configured.');
}

try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log(`[Webhook] Received Stripe event: ${event.type}`);
} catch (err) {
    console.error(`[Webhook] Error verifying signature: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
}

//     // Handle the event
//     switch (event.type) {
//         case 'payment_intent.succeeded':
//             const paymentIntentSucceeded = event.data.object;
//             console.log([Webhook] PaymentIntent succeeded: ${paymentIntentSucceeded.id});
//             // Extract metadata saved during creation
//             const metadata = paymentIntentSucceeded.metadata;
//             const studentId = metadata?.studentId;
//             const courseId = metadata?.courseId;
//             const courseName = metadata?.courseName || '?'; // Get course name if saved
//            const teacherId = metadata?.teacherId;
//             if (!studentId || !courseId) {
//                 console.error([Webhook] Missing studentId or courseId in PaymentIntent metadata for PI: ${paymentIntentSucceeded.id});
//                 // Critical error - can't link payment to enrollment
//                 // Potentially log this for manual intervention
//                 return res.status(400).json({ error: 'Webhook processing error: Missing metadata.' });
//             }
//             // *** CREATE ENROLLMENT DIRECTLY ***
//             try {
//                  console.log([Webhook] Attempting to create enrollment for Student ${studentId}, Course ${courseId});
//                  // Use findOneAndUpdate with upsert to prevent duplicates if webhook retries
//                  const enrollment = await Enrollment.findOneAndUpdate(
//                      { student: studentId, course: courseId }, // Find criteria
//                      { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } }, // Data if inserting
//                      { new: true, upsert: true, runValidators: true } // Options
//                  );
//                 const courseForTeacherId = await Course.findById(courseId).select('teacher').lean(); // Need teacher ID
//                 // *** UPDATE CHATROOM MEMBERS ***
//                 if (enrollment && courseForTeacherId && courseForTeacherId.teacher) {
//                    await updateChatroomOnEnrollment(courseId, studentId, courseForTeacherId.teacher, courseName, 'add');
//                 }
//                  console.log([Webhook] Enrollment created/confirmed for Student ${studentId}, Course ${courseId}. Enrollment ID: ${enrollment._id});
//                  // Optional: Log activity
//                  // await logWebhookActivity('STUDENT_ENROLLMENT_PAID', 'Enrollment', enrollment._id, Course: ${courseName});
//                  // Optional: Send confirmation email to student
//             } catch (dbError) {
//                  console.error([Webhook] DB Error creating enrollment for PaymentIntent ${paymentIntentSucceeded.id} (Student: ${studentId}, Course: ${courseId}):, dbError);
//                  // Return 500 so Stripe might retry (depending on your webhook settings)
//                  return res.status(500).json({ error: 'Database error processing enrollment.' });
//             }
//             break; // End payment_intent.succeeded case
//         case 'payment_intent.payment_failed':
//             const paymentIntentFailed = event.data.object;
//             console.warn([Webhook] PaymentIntent failed: ${paymentIntentFailed.id}, Reason: ${paymentIntentFailed.last_payment_error?.message});
//             // Log this failure. You might want to notify the student or admin.
//             // No enrollment is created. If you were using EnrollmentRequest, you'd update its status to 'failed'.
//              // Optional: Log activity
//              // await logWebhookActivity('STUDENT_PAYMENT_FAILED', 'PaymentIntent', paymentIntentFailed.id, Course: ${paymentIntentFailed.metadata?.courseName || '?'}, { reason: paymentIntentFailed.last_payment_error?.message });
//             break;
//         default:
//             console.log([Webhook] Unhandled event type ${event.type});
//     }
//     // Return a 200 response to acknowledge receipt of the event
//     res.status(200).json({ received: true });
// };

//// if (event.type === 'payment_intent.succeeded') {
//// const paymentIntent = event.data.object; // The PaymentIntent object
//// console.log(`[Webhook] Processing PaymentIntent succeeded: ${paymentIntent.id}`);
//// const metadata = paymentIntent.metadata;
////     const studentId = metadata?.studentId;
// //    const purchaseType = metadata?.purchaseType || 'single_course'; // Default to single_course if not specified

 // Handle the event
    const paymentIntent = event.data.object; // Common object for payment_intent events
    const metadata = paymentIntent.metadata;
    const studentId = metadata?.studentId;

    switch (event.type) {
        case 'payment_intent.succeeded':
            console.log(`[Webhook] Processing PaymentIntent succeeded: ${paymentIntent.id}`);
            const purchaseType = metadata?.purchaseType || 'single_course';

            if (!studentId) {
                console.error(`[Webhook] CRITICAL: Missing studentId in PaymentIntent metadata for PI: ${paymentIntent.id}.`);
                await logWebhookActivity('WEBHOOK_METADATA_ERROR', `PI: ${paymentIntent.id}`, { error: "Missing studentId" });
                return res.status(400).json({ error: 'Webhook error: Missing studentId in metadata.' });
            }

            if (purchaseType === 'roadmap_package') {
                const roadmapCourseIdsString = metadata?.roadmapCourseIds;
                const learningGoal = metadata?.learningGoal || 'Roadmap Package';

        if (!roadmapCourseIdsString) {
            console.error(`[Webhook-Roadmap] Missing roadmapCourseIds in metadata for PI: ${paymentIntent.id}, Student: ${studentId}`);
            await logWebhookActivity('WEBHOOK_METADATA_ERROR', `PI: ${paymentIntent.id}`, { studentId, error: "Missing roadmapCourseIds for package" });
            return res.status(400).json({ error: 'Webhook error: Missing roadmap course IDs for package.' });
        }

        let courseIdsToEnroll = [];
        try {
            courseIdsToEnroll = JSON.parse(roadmapCourseIdsString);
            if (!Array.isArray(courseIdsToEnroll) || courseIdsToEnroll.some(id => !mongoose.Types.ObjectId.isValid(id))) {
                throw new Error("roadmapCourseIds is not a valid array of ObjectIds.");
            }
        } catch (parseError) {
            console.error(`[Webhook-Roadmap] Failed to parse roadmapCourseIds: "${roadmapCourseIdsString}" for PI: ${paymentIntent.id}`, parseError);
            await logWebhookActivity('WEBHOOK_PROCESSING_ERROR', `PI: ${paymentIntent.id}`, { studentId, error: "Invalid roadmapCourseIds format" });
            return res.status(400).json({ error: 'Webhook error: Invalid roadmapCourseIds format.' });
        }

        // console.log(`[Webhook-Roadmap] Processing package enrollment for student ${studentId} in ${courseIdsToEnroll.length} courses for goal: "${learningGoal}"`);
        // let successfulEnrollments = 0;
        // let failedEnrollments = [];

        // for (const courseId of courseIdsToEnroll) {
        //     try {
        //         const course = await Course.findById(courseId).select('name teacher').lean(); // Need teacher for chatroom
         console.log(`[Webhook-Roadmap] Student ${studentId} package for ${courseIdsToEnroll.length} courses: "${learningGoal}"`);
                let successfulEnrollments = 0;
                 let failedEnrollments = [];
                for (const courseId of courseIdsToEnroll) {
                    try {
                        if (!mongoose.Types.ObjectId.isValid(courseId)) {
                            console.warn(`[Webhook-Roadmap] Invalid Course ID in package: ${courseId}. Skipping.`);
                            continue;
                        }
                        const course = await Course.findById(courseId).select('name teacher').lean();
                if (!course) {
                    console.warn(`[Webhook-Roadmap] Course ${courseId} not found during package enrollment for student ${studentId}. Skipping.`);
                    failedEnrollments.push({ courseId, reason: "Course not found" });
                    continue;
                }
                if (!course.teacher) {
                    console.warn(`[Webhook-Roadmap] Course ${courseId} missing teacher ID. Skipping chatroom update for this course.`);
                }

                // Use findOneAndUpdate with upsert for idempotency (in case of webhook retries)
                const enrollment = await Enrollment.findOneAndUpdate(
                    { student: studentId, course: courseId },
                    { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
                    { new: true, upsert: true, runValidators: true }
                );

                if (course.teacher) { // Only update chatroom if teacher exists
                    await updateChatroomOnEnrollment(courseId, studentId, course.teacher.toString(), course.name, 'add');
                }
                successfulEnrollments++;
                console.log(`[Webhook-Roadmap] Student ${studentId} enrolled in course ${courseId}.`);
            } catch (enrollError) {
                console.error(`[Webhook-Roadmap] Error enrolling student ${studentId} in course ${courseId} (PI: ${paymentIntent.id}):`, enrollError);
                failedEnrollments.push({ courseId, reason: enrollError.message });
            }
        }
        await logWebhookActivity('ROADMAP_PACKAGE_ENROLLED', `PI: ${paymentIntent.id}`, { studentId, learningGoal, successful: successfulEnrollments, failed: failedEnrollments.length, courseIds: courseIdsToEnroll });
        console.log(`[Webhook-Roadmap] Package processed for student ${studentId}. Success: ${successfulEnrollments}, Failures: ${failedEnrollments.length}`);

    } else { // Single course purchase
                const courseId = metadata?.courseId;
                const courseName = metadata?.courseName || 'Unknown Course';
                const teacherId = metadata?.teacherId;

                if (!courseId || !teacherId || !mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(teacherId)) { // teacherId is crucial for chatroom
            console.error(`[Webhook-SingleCourse] Missing courseId or teacherId in metadata for PI: ${paymentIntent.id}, Student: ${studentId}`);
            await logWebhookActivity('WEBHOOK_METADATA_ERROR', `PI: ${paymentIntent.id}`, { studentId, error: "Missing courseId or teacherId for single course" });
            return res.status(400).json({ error: 'Webhook error: Missing metadata for single course.' });
        }
        if (!mongoose.Types.ObjectId.isValid(courseId) || !mongoose.Types.ObjectId.isValid(teacherId)) {
            console.error(`[Webhook-SingleCourse] Invalid courseId or teacherId format in metadata for PI: ${paymentIntent.id}`);
            return res.status(400).json({ error: 'Webhook error: Invalid ID format in metadata.' });
        }


        console.log(`[Webhook-SingleCourse] Processing single course enrollment for student ${studentId}, Course: ${courseId}`);
        try {
            const enrollment = await Enrollment.findOneAndUpdate(
                { student: studentId, course: courseId },
                { $setOnInsert: { student: studentId, course: courseId, enrolledAt: new Date() } },
                { new: true, upsert: true, runValidators: true }
            );
            console.log(`[Webhook-SingleCourse] Enrollment created/confirmed for Student ${studentId}, Course ${courseId}. ID: ${enrollment._id}`);

            await updateChatroomOnEnrollment(courseId, studentId, teacherId, courseName, 'add');
            await logWebhookActivity('SINGLE_COURSE_ENROLLED', `PI: ${paymentIntent.id}`, { studentId, courseId, courseName });

        } catch (dbError) {
            console.error(`[Webhook-SingleCourse] DB Error creating enrollment for PI ${paymentIntent.id} (Student: ${studentId}, Course: ${courseId}):`, dbError);
            return res.status(500).json({ error: 'Database error processing single course enrollment.' });
        }
    }
  break;

        case 'payment_intent.payment_failed':
            const paymentIntentFailed = event.data.object; // event.data.object is the PaymentIntent
            console.warn(`[Webhook] PaymentIntent failed: ${paymentIntentFailed.id}, Student: ${paymentIntentFailed.metadata?.studentId}, Reason: ${paymentIntentFailed.last_payment_error?.message}`);
            await logWebhookActivity('PAYMENT_FAILED', `PI: ${paymentIntentFailed.id}`, { studentId: paymentIntentFailed.metadata?.studentId, reason: paymentIntentFailed.last_payment_error?.message });
            break;
    // Notify user or admin if necessary
default:
            console.log(`[Webhook] Unhandled event type: ${event.type}`);
// Return a 200 response to acknowledge receipt of the event to Stripe
    }
    res.status(200).json({ received: true });

};