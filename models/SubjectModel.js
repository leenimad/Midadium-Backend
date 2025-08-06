// backend/models/SubjectModel.js
const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Subject name is required'],
        unique: true, // Ensure subject names are unique
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Subject description is required.'],
        trim: true
    },
        
    // an image URL for the subject category
    imageUrl: {
        type: String
    },
    // Optional: Track which admin created it
     createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Optional: Add pre-save hooks or methods if needed

module.exports = mongoose.model('Subject', SubjectSchema);