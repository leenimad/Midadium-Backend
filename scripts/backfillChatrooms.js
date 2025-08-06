// backend/scripts/backfillChatrooms.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); // More robust path to .env

const mongoose = require('mongoose');
const admin = require('firebase-admin');
const Course = require('../models/courseModel');     // Adjust path if your models are elsewhere
const Enrollment = require('../models/EnrollmentModel'); // Adjust path
const connectDB = require('../config/db');         // Adjust path

// Initialize Firebase Admin (should be idempotent if already initialized in server.js, but safe to do here for standalone script)
try {
    if (admin.apps.length === 0) { // Initialize only if no apps are already initialized
        const serviceAccountPath = require('path').resolve(__dirname, '..', 'config', 'firebase-service-account-key.json');
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK initialized for script.");
    } else {
        console.log("Firebase Admin SDK already initialized.");
    }
} catch (error) {
    console.error("CRITICAL: Failed to initialize Firebase Admin SDK for script.", error);
    process.exit(1);
}
const firestore = admin.firestore();

const backfillChatrooms = async () => {
    let mongoConnected = false;
    try {
        await connectDB();
        mongoConnected = true;
        console.log("MongoDB Connected for backfill script...");

        const existingCourses = await Course.find({}) // Fetch all courses
            .select('_id name teacher') // Select only necessary fields
            .lean(); // Use lean for performance

        console.log(`Found ${existingCourses.length} existing courses in MongoDB to process.`);
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (const course of existingCourses) {
            const courseIdStr = course._id.toString();
            const teacherIdStr = course.teacher?.toString(); // Teacher might be just an ID or populated
            const courseName = course.name || 'Unnamed Course';

            if (!teacherIdStr) {
                console.warn(`  [SKIP] Course ${courseIdStr} ('${courseName}') - Missing teacher ID.`);
                skippedCount++;
                continue;
            }

            const chatroomRef = firestore.collection('chatrooms').doc(courseIdStr);
            const chatroomDoc = await chatroomRef.get();

            if (chatroomDoc.exists) {
                console.log(`  [UPDATE] Chatroom for course ${courseIdStr} ('${courseName}') already exists. Ensuring members and data...`);
                // Ensure teacher is a member and update courseName if it changed
                // Also, fetch and add existing enrolled students if they aren't already members
                const enrollments = await Enrollment.find({ course: course._id }).select('student').lean();
                const studentMemberIds = enrollments.map(e => e.student.toString());
                const allMemberIds = [...new Set([teacherIdStr, ...studentMemberIds])]; // Teacher + students, unique

                await chatroomRef.set({ // Use set with merge to update fields or add missing ones
                    courseName: courseName, // Update name if it changed
                    teacherId: teacherIdStr,
                    members: admin.firestore.FieldValue.arrayUnion(...allMemberIds), // Add any missing members
                    // Only update lastMessage if you want to overwrite it
                    // lastMessage: "Chatroom data verified.",
                    // lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                updatedCount++;
            } else {
                console.log(`  [CREATE] Creating chatroom for course ${courseIdStr} ('${courseName}')...`);
                const initialMembers = [teacherIdStr]; // Start with the teacher

                // Find enrolled students for this course
                const enrollments = await Enrollment.find({ course: course._id }).select('student').lean();
                enrollments.forEach(enrollment => {
                    if (enrollment.student) {
                        initialMembers.push(enrollment.student.toString());
                    }
                });
                const uniqueMembers = [...new Set(initialMembers)]; // Ensure uniqueness

                await chatroomRef.set({
                    courseId: courseIdStr,
                    courseName: courseName,
                    teacherId: teacherIdStr,
                    members: uniqueMembers,
                    lastMessage: "Chatroom created for existing course.",
                    lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp() // Good to have a creation timestamp
                });
                console.log(`  Chatroom created for course ${courseIdStr} with ${uniqueMembers.length} members.`);
                createdCount++;
            }
        }

        console.log("\n--- Chatroom Backfill Summary ---");
        console.log(`Total Courses Processed: ${existingCourses.length}`);
        console.log(`Chatrooms Newly Created: ${createdCount}`);
        console.log(`Existing Chatrooms Checked/Updated: ${updatedCount}`);
        console.log(`Courses Skipped (e.g., no teacher): ${skippedCount}`);
        console.log("---------------------------------");

    } catch (error) {
        console.error("Error during chatroom backfill script:", error);
    } finally {
        if (mongoConnected) {
            await mongoose.disconnect();
            console.log("MongoDB Disconnected.");
        }
        // No explicit disconnect for Firebase Admin SDK in a script like this.
        // process.exit() will terminate it.
    }
};

// Run the script
backfillChatrooms().then(() => {
    console.log("Script execution finished.");
    process.exit(0); // Exit successfully
}).catch(err => {
    console.error("Script execution failed with unhandled error:", err);
    process.exit(1); // Exit with error
});