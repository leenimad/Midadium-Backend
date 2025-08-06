// backend/controllers/certificateController.js (NEW FILE)
const Certificate = require('../models/CertificateModel');
const Enrollment = require('../models/EnrollmentModel'); // For auth check
const mongoose = require('mongoose');

exports.getStudentCertificateForCourse = async (req, res) => {
    try {
        const { courseId } = req.params;
        const studentId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: "Invalid Course ID" });
        }

        // Ensure student is enrolled (or was, if you allow access after unenrollment)
        const enrollment = await Enrollment.findOne({ student: studentId, course: courseId });
        if (!enrollment) {
            return res.status(403).json({ message: "You are not enrolled in this course to view its certificate." });
        }

        const certificate = await Certificate.findOne({ student: studentId, course: courseId }).lean();
        if (!certificate) {
            return res.status(404).json({ message: "Certificate not found or not yet generated for this course." });
        }
        res.status(200).json(certificate);
    } catch (error) {
        console.error("Error fetching student certificate:", error);
        res.status(500).json({ message: "Failed to fetch certificate." });
    }
};
/**
 * @desc    Get all certificates earned by the logged-in student
 * @route   GET /api/student/certificates
 * @access  Private (Student Only)
 */
exports.getMyCertificates = async (req, res) => {
    try {
        const studentId = req.user.id;

        const certificates = await Certificate.find({ student: studentId })
            .select('courseName completionDate certificateId course') // Select fields needed for list
            .sort({ completionDate: -1 }) // Show most recent first
            .lean();

        res.status(200).json(certificates);
    } catch (error) {
        console.error(`Error fetching certificates for student ${req.user.id}:`, error);
        res.status(500).json({ message: 'Failed to fetch your certificates.' });
    }
};
