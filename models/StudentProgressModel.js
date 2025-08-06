// backend/models/StudentProgressModel.js
const mongoose = require('mongoose');
const WorksheetAnswerEvaluationSchema = new mongoose.Schema({
    questionText: String, // Store the original question text for context
    studentAnswer: String,
    aiFeedback: String,
    aiScore: Number, // e.g., 1-5
    isCorrectConceptually: Boolean // AI's assessment
});
const StudentProgressSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true },

    // --- Tracking Metrics ---
    status: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed'],
        default: 'not_started'
    },
    lastAccessedAt: { type: Date },
    // Video Progress (optional, harder to track reliably without player events)
    // videoProgressSeconds: { type: Number, default: 0 },
    // videoCompleted: { type: Boolean, default: false },

    // --- AI Interaction Tracking (Examples) ---
    formatsGenerated: [{ // Track which formats were generated for this lesson
        type: String,
        enum: ['summary', 'flashcards', 'interactive_games', 'worksheets']
    }],
    flashcardProgress: { // Example for flashcards
        totalCards: { type: Number },
        knownCards: [{ type: String }], // Store term/ID of known cards
        learningCards: [{ type: String }], // Store term/ID of cards being learned
        lastReviewed: { type: Date }
    },
    quizAttempts: [{ // Example for quizzes
        quizId: { type: String }, // Could be generated or a fixed ID within the lesson
        score: { type: Number }, // Percentage or raw score
        answers: { type: mongoose.Schema.Types.Mixed }, // Store submitted answers
        attemptedAt: { type: Date, default: Date.now }
    }],
    // --- MODIFIED/NEW for Worksheet ---
    worksheetSubmitted: { type: Boolean, default: false },
    worksheetOriginalAnswers: { type: mongoose.Schema.Types.Mixed }, // Student's raw answers
    worksheetSubmittedAt: { type: Date },
    worksheetEvaluation: { // Store the overall evaluation or array of evaluations
        evaluatedAt: { type: Date },
        overallFeedback: { type: String }, // Optional overall feedback from AI
        answersEvaluation: [WorksheetAnswerEvaluationSchema] // Array of evaluations per question
    }

}, { timestamps: true }); // createdAt, updatedAt

// Compound index for efficient querying by student, course, and lesson
StudentProgressSchema.index({ student: 1, course: 1, lesson: 1 }, { unique: true });
// Index for querying all progress for a student
StudentProgressSchema.index({ student: 1, updatedAt: -1 });

module.exports = mongoose.model('StudentProgress', StudentProgressSchema);