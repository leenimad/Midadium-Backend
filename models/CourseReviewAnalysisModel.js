// backend/models/CourseReviewAnalysisModel.js
const mongoose = require('mongoose');

const TipSchema = new mongoose.Schema({
    category: { type: String, enum: ['strength', 'weakness', 'suggestion', 'clarification_needed', 'content_gap','strength_to_leverage', // *** ADDED ***
            'positive_feedback',    // Example additional
            'constructive_criticism'// Example additional
            ] }, // Example categories
    description: { type: String, required: true },
    // Optional: specific review quotes that led to this tip
    // supportingReviewSnippets: [{ type: String }]
});

const CourseReviewAnalysisSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, unique: true, index: true },
    lastAnalyzedAt: { type: Date, default: Date.now },
    overallSentiment: { type: String, enum: ['positive', 'neutral', 'mixed', 'negative',
  'overwhelmingly_positive',     
            'mostly_positive',            
            'mostly_negative',            
            'mostly_positive_with_concerns' 

    ] }, // AI assessed
    averageRatingAtAnalysis: { type: Number }, // Store the avg rating when this analysis was run
    reviewCountAtAnalysis: { type: Number }, // Store review count
    keyStrengths: [String], // Summary points from AI
    areasForImprovement: [String], // Summary points from AI
    actionableTips: [TipSchema],   // More detailed tips
    rawAIResponse: { type: String } 
}, { timestamps: true });

module.exports = mongoose.model('CourseReviewAnalysis', CourseReviewAnalysisSchema);