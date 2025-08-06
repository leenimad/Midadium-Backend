// backend/models/EnrollmentModel.js
const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
        index: true
    },
    enrolledAt: {
        type: Date,
        default: Date.now
    },
    // Placeholder for future progress tracking
    // progress: {
    //    completedLessons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' }],
    //    overallPercentage: { type: Number, default: 0 },
    //    lastAccessedLesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    // }
}, { timestamps: true });

// Ensure a student can only be actively enrolled once per course
EnrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', EnrollmentSchema);