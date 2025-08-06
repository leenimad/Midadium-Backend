// backend/models/ProblemReportModel.js
const mongoose = require('mongoose');

const ProblemReportSchema = new mongoose.Schema({
    student: { // The student who reported the problem
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    course: { // The course related to the problem (optional, but good)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        index: true
    },
    lesson: { // The specific lesson, if applicable
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson',
        index: true
    },
    problemType: { // e.g., 'video_issue', 'content_error', 'ai_feedback_incorrect', 'technical_glitch', 'other'
        type: String,
        required: true,
        enum: ['video_issue', 'content_error', 'ai_feedback_incorrect', 'technical_glitch', 'suggestion', 'other']
    },
    description: { // Detailed description from the student
        type: String,
        required: [true, 'A description of the problem is required.'],
        trim: true,
        maxlength: [1000, 'Description cannot exceed 1000 characters.']
    },
    urlContext: { // Optional: The URL or screen name where the problem occurred
        type: String
    },
    status: { // For admin tracking
        type: String,
        enum: ['new', 'investigating', 'resolved', 'wont_fix'],
        default: 'new',
        index: true
    },
    adminNotes: { // For admin to add notes
        type: String
    }
}, { timestamps: true });

// Index for admin querying
ProblemReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ProblemReport', ProblemReportSchema);