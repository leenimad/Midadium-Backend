// backend/models/SavedRoadmapModel.js
const mongoose = require('mongoose');

const RoadmapStepSchema = new mongoose.Schema({ // Re-define step structure for embedding
    phaseTitle: { type: String, required: true },
    recommendedCourseIds: [{ type: String, required: true }], // Store as strings (MongoDB ObjectIds)
    // Optional: Store populated course names/subjects at time of save if needed for quick display
    recommendedCoursesSnapshot: [{ courseId: String, name: String, subjectName: String }],
    justification: { type: String, required: true },
    estimatedDuration: { type: String, required: true }
}, { _id: false }); // No separate _id for sub-documents unless needed

const SavedRoadmapSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    learningGoal: { // The original goal student entered
        type: String,
        required: true,
        trim: true
    },
    currentKnowledgeLevel: { // Optional, as provided by student
        type: String,
        trim: true
    },
    roadmap: [RoadmapStepSchema], // Embed the array of roadmap steps
    // Optional: Add a custom name for the roadmap if you allow students to name them
    // customName: { type: String, trim: true }

    // Optional: Track if it's a "primary" or "active" roadmap
    // isActive: { type: Boolean, default: false }
}, { timestamps: true }); // Adds createdAt and updatedAt

module.exports = mongoose.model('SavedRoadmap', SavedRoadmapSchema);