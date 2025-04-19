// ../backend/models/ActivityLogModel.js
const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorUsername: { type: String, required: true }, // Store username for easy display
    actionType: { type: String, required: true, enum: [
        'TEACHER_ADDED', 'TEACHER_UPDATED', 'TEACHER_REMOVED', 'TEACHER_REMOVED_WITH_COURSES', 'TEACHER_REMOVED_KEEP_COURSES', // Teacher actions
        'COURSE_ADDED', 'COURSE_UPDATED', 'COURSE_APPROVED', 'COURSE_REJECTED', // Course actions
        'COURSE_ASSIGNED_TEACHER'
        ,'COURSE_REMOVED', // Added course removal action type
        // NEW Student Actions
        'STUDENT_ADDED', 'STUDENT_UPDATED', 'STUDENT_REMOVED',
        // NEW Enrollment Actions
        'STUDENT_ENROLLED', 'STUDENT_UNENROLLED',
        'LESSON_UPLOADED', // Add Lesson Actions
        // 'LESSON_UPDATED', // Add later if needed
        // 'LESSON_DELETED', // Add later if needed
        //Admin Actions
        'ADMIN_SETTINGS_UPDATED' 
    ]},
    targetType: { type: String, enum: ['User', 'Course','Lesson', 'System'] }, // What kind of object was affected?
    targetId: { type: mongoose.Schema.Types.ObjectId }, // ID of the user/course (optional for system actions)
    targetName: { type: String }, // Name/Title of the user/course for display
    details: { type: mongoose.Schema.Types.Mixed }, // Optional extra details
}, { timestamps: true }); // Use createdAt as the timestamp

ActivityLogSchema.index({ createdAt: -1 }); // Index for fast sorting

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);