// backend/models/GeneratedContentModel.js
const mongoose = require('mongoose');

const GeneratedContentSchema = new mongoose.Schema({
    lesson: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson', // Link to the Lesson model
        required: true,
        index: true // Index for faster lookups by lesson
    },
    formatType: {
        type: String,
        required: true,
        enum: ['summary', 'flashcards', 'interactive_games', 'worksheets'], // Allowed formats
        index: true // Index for faster lookups by type
    },
    content: {
        type: mongoose.Schema.Types.Mixed, // Can store String (summary) or Object/Array (flashcards, etc.)
        required: true
    },
    modelVersion: { // Optional: Track which AI model generated this
        type: String
    },
    promptUsedHash: { // Optional: Store a hash of the prompt for potential cache invalidation later
       type: String,
       index: true
    },
    // Add promptUsed text field if needed for debugging (can be large)
    // promptUsed: { type: String }

}, { timestamps: true }); // Adds createdAt and updatedAt

// Compound index for the most common query
GeneratedContentSchema.index({ lesson: 1, formatType: 1 }, { unique: true }); // Ensure only one entry per lesson/format

module.exports = mongoose.model('GeneratedContent', GeneratedContentSchema); 