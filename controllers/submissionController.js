//backend/controllers/submessionController
// models
const Submission = require('../models/SubmissionModel');
const Assignment = require('../models/AssignmentModel');
const mongoose = require('mongoose');
// Create submission
// Create submission
exports.submitAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const studentId = req.user._id;
    const content = req.body.content;
    const file = req.file ? `/uploads/submissions/${req.file.filename}` : null;

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    const newSubmission = new Submission({ 
      student: studentId,
      assignment: assignmentId,
      content,
      file
    });

    await newSubmission.save();

    // ✅ إشعار إلى المعلم بعد الحفظ
    const io = req.app.get('io'); // احصل على instance من Socket.IO
    if (io) {
      const teacherId = assignment.teacher?.toString();
      if (teacherId) {
        io.to(teacherId).emit('notification', {
          title: '📥 New Submission Received',
          message: `A student submitted work for "${assignment.title}".`,
          type: 'submission',
          assignmentId: assignment._id,
        });

        // ✅ حفظ في NotificationModel
        const { createNotification } = require('./notificationController'); // تأكد من الاستيراد داخل الدالة لتجنب مشاكل require
        await createNotification({
          userId: teacherId,
          title: '📥 New Submission Received',
          message: `A student submitted work for "${assignment.title}".`,
          link: `/teacher/assignments/${assignment._id}/submissions`,
          type: 'info',
        });
      }
    }

    res.status(201).json({ message: 'Submission successful', submission: newSubmission });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({ message: 'Server error during submission' });
  }
};

// Update submission
exports.updateSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id;

    const submission = await Submission.findById(id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.student.toString() !== studentId.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this submission' });
    }

    if (req.body.content) submission.content = req.body.content;
    if (req.file) submission.file = `/uploads/submissions/${req.file.filename}`;

    await submission.save();
    res.status(200).json({ message: 'Submission updated', submission });
  } catch (err) {
    console.error('Update submission error:', err);
    res.status(500).json({ message: 'Server error updating submission' });
  }
};

// Delete submission
exports.deleteSubmission = async (req, res) => {
  try {
    const submissionId = req.params.id;
    const studentId = req.user._id;

    const submission = await Submission.findById(submissionId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (submission.student.toString() !== studentId.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this submission' });
    }

    await Submission.findByIdAndDelete(submissionId);
    res.status(200).json({ message: 'Submission deleted successfully' });
  } catch (err) {
    console.error('Delete submission error:', err);
    res.status(500).json({ message: 'Server error deleting submission' });
  }
};
exports.getSubmissionsForAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const teacherId = req.user._id;

    // تحقق أن الواجب تابع لهذا المعلم
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

    if (assignment.teacher.toString() !== teacherId.toString()) {
      return res.status(403).json({ message: 'Not authorized to view submissions for this assignment' });
    }

    const submissions = await Submission.find({ assignment: assignmentId }).populate('student', 'username email');
    res.status(200).json({ submissions });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({ message: 'Failed to fetch submissions' });
  }
};
// to get a student submessions for an assignment
exports.getMySubmissionForAssignment = async (req, res) => {
  try {
      const { assignmentId } = req.params;
      const studentId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
          return res.status(400).json({ message: 'Invalid Assignment ID.' });
      }

      const submission = await Submission.findOne({
          assignment: assignmentId,
          student: studentId
      }).lean(); // Find by assignment and student

      if (!submission) {
          // It's okay if no submission is found, not necessarily an error
          return res.status(404).json({ message: 'No submission found for this assignment by you.' });
      }

      res.status(200).json(submission); // Return the submission object
  } catch (error) {
      console.error(`Error fetching student submission for assignment ${req.params.assignmentId}:`, error);
      res.status(500).json({ message: 'Failed to fetch your submission.' });
  }
};