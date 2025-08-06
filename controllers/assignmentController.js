const Assignment = require('../models/AssignmentModel');
const Enrollment = require('../models/EnrollmentModel'); // ✅ Needed for fetching students
const User = require('../models/UserModel'); // Optional for student names
const { createNotification } = require('./notificationController'); // ✅ لإشعار ثابت
const mongoose = require('mongoose');
exports.createAssignment = async (req, res) => {
  try {
    const { title, description, courseId, dueDate } = req.body;

    if (!title || !courseId) {
      return res.status(400).json({ message: 'Title and course are required' });
    }

    const newAssignment = new Assignment({
      title,
      description,
      course: courseId,
      dueDate,
      teacher: req.user._id,
    });

    await newAssignment.save();

    // ✅ Emit real-time Socket.IO notification to enrolled students
    const io = req.app.get('io'); // 👈 get socket.io instance
    if (io) {
      const enrollments = await Enrollment.find({ course: courseId }).populate('student', '_id username');
for (const enrollment of enrollments) {
  const studentId = enrollment.student?._id?.toString();
  if (studentId) {
    io.to(studentId).emit('notification', {
      title: '📘 New Assignment Posted',
      message: `An assignment "${newAssignment.title}" has been added to your course.`,
      type: 'assignment',
      courseId,
      assignmentId: newAssignment._id
    });
    await createNotification({
      userId: studentId,
      title: '📘 New Assignment Posted',
      message: `An assignment "${newAssignment.title}" has been added to your course.`,
      link: `/student/courses/${courseId}/assignments/${newAssignment._id}`,
      type: 'info'
    });
  }
}
    }

    res.status(201).json(newAssignment);
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(500).json({ message: 'Server error creating assignment' });
  }
};

exports.getAssignmentsForCourse = async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const assignments = await Assignment.find({ course: courseId }).sort({ dueDate: 1 });
    res.status(200).json(assignments);
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({ message: 'Failed to fetch assignments' });
  }
};
exports.updateAssignment = async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;
    const assignmentId = req.params.id;

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    assignment.title = title || assignment.title;
    assignment.description = description || assignment.description;
    assignment.dueDate = dueDate || assignment.dueDate;

    await assignment.save();
    res.status(200).json(assignment);
  } catch (err) {
    console.error('Error updating assignment:', err);
    res.status(500).json({ message: 'Server error updating assignment' });
  }
};
exports.deleteAssignment = async (req, res) => {
    try {
      const assignmentId = req.params.id;
  
      const deleted = await Assignment.findByIdAndDelete(assignmentId);
      if (!deleted) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
  
      res.status(200).json({ message: 'Assignment deleted successfully' });
    } catch (err) {
      console.error('Error deleting assignment:', err);
      res.status(500).json({ message: 'Server error deleting assignment' });
    }
  };
  exports.getAssignmentsForStudentCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const studentId = req.user._id;

    // تحقق أن الطالب مسجل في هذا الكورس
    const enrollment = await Enrollment.findOne({ course: courseId, student: studentId });
    if (!enrollment) {
      return res.status(403).json({ message: 'You are not enrolled in this course' });
    }

    // جلب الواجبات الخاصة بالكورس
    const assignments = await Assignment.find({ course: courseId }).sort({ dueDate: 1 });
    res.status(200).json(assignments);
  } catch (err) {
    console.error('Error fetching student assignments:', err);
    res.status(500).json({ message: 'Failed to fetch assignments for student' });
  }
};