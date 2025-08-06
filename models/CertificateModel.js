// backend/models/CertificateModel.js
const mongoose = require('mongoose');

const CertificateSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    courseName: { type: String, required: true }, // Denormalized for easy display
    studentName: { type: String, required: true }, // Denormalized
    completionDate: { type: Date, default: Date.now },
    certificateId: { type: String, unique: true, required: true }, // A unique ID for the certificate itself
    // downloadUrl: String, // If you later store them in S3
}, { timestamps: true });

// Ensure a student gets only one certificate per course
CertificateSchema.index({ student: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('Certificate', CertificateSchema);