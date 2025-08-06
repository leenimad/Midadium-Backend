// backend/utils/chatroomUtils.js
const admin = require('firebase-admin'); // Access initialized instance

const updateChatroomOnEnrollment = async (courseId, studentId, teacherId, courseName, action = 'add') => {
    if (!courseId || !studentId || !teacherId) {
        console.error("[ChatroomUtil] Missing IDs for chatroom update:", { courseId, studentId, teacherId });
        return;
    }
    const firestore = admin.firestore();
    const chatroomRef = firestore.collection('chatrooms').doc(courseId.toString());

    console.log(`[ChatroomUtil] Updating members for course ${courseId} - Student: ${studentId}, Action: ${action}`);

    try {
        if (action === 'add') {
            // Add student and ensure teacher is present
            await chatroomRef.set({ // Use set with merge to create if not exists or update
                courseId: courseId.toString(),
                courseName: courseName || 'Unknown Course',
                teacherId: teacherId.toString(),
                members: admin.firestore.FieldValue.arrayUnion(studentId.toString(), teacherId.toString()),
                // members: admin.firestore.FieldValue.arrayRemove(studentId.toString()),                lastMessage: "Chatroom created.", // Initial message
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp() // Set only on create if needed
            }, { merge: true }); // Merge true creates or updates existing fields
            console.log(`[ChatroomUtil] Student ${studentId} & Teacher ${teacherId} ensured in chatroom for course ${courseId}`);
        } else if (action === 'remove') {
            // Remove student (teacher always remains a member conceptually)
            await chatroomRef.update({
                members: admin.firestore.FieldValue.arrayRemove(studentId.toString())
            });
            console.log(`[ChatroomUtil] Student ${studentId} removed from chatroom for course ${courseId}`);
        }
    } catch (error) {
        console.error(`[ChatroomUtil] Error updating chatroom members in Firestore for course ${courseId}:`, error);
    }
};

const createChatroomForCourse = async (courseId, teacherId, courseName) => {
     if (!courseId || !teacherId || !courseName) {
        console.error("[ChatroomUtil] Missing data for creating chatroom.");
        return;
     }
     const firestore = admin.firestore();
     const chatroomRef = firestore.collection('chatrooms').doc(courseId.toString());

     console.log(`[ChatroomUtil] Creating chatroom for new course ${courseId} by teacher ${teacherId}`);
     try {
        await chatroomRef.set({
            courseId: courseId.toString(),
            courseName: courseName,
            teacherId: teacherId.toString(),
            members: [teacherId.toString()], // Initially only the teacher
            lastMessage: "Course chatroom created!",
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp() // Explicit create time
        });
        console.log(`[ChatroomUtil] Chatroom created for course ${courseId}`);
     } catch (error) {
        console.error(`[ChatroomUtil] Error creating Firestore chatroom for course ${courseId}:`, error);
     }
};


module.exports = { updateChatroomOnEnrollment, createChatroomForCourse };