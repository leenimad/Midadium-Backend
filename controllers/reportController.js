// backend/controllers/reportController.js
const ProblemReport = require('../models/ProblemReportModel');
const User = require('../models/UserModel');
const Course = require('../models/courseModel'); // To validate courseId if provided
const Lesson = require('../models/LessonModel'); // To validate lessonId if provided
const mongoose = require('mongoose');
const { createNotificationAndEmit } = require('./notificationController');
/**
 * @desc    Submit a new problem report
 * @route   POST /api/reports/problem
 * @access  Private (Student, Teacher, Admin - anyone logged in can report)
 */
exports.submitProblemReport = async (req, res) => {
    try {
        const { courseId, lessonId, problemType, description, urlContext } = req.body;
        const studentId = req.user.id; // From 'protect' middleware

        // --- Validation ---
        if (!problemType || !description) {
            return res.status(400).json({ message: 'Problem type and description are required.' });
        }
        if (description.length > 1000) {
            return res.status(400).json({ message: 'Description is too long (max 1000 characters).' });
        }

        // Optional: Validate courseId and lessonId if provided
        if (courseId && !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid Course ID format.' });
        }
        if (lessonId && !mongoose.Types.ObjectId.isValid(lessonId)) {
            return res.status(400).json({ message: 'Invalid Lesson ID format.' });
        }
        if (courseId) {
            const courseExists = await Course.findById(courseId).select('_id');
            if (!courseExists) return res.status(404).json({ message: 'Associated course not found.' });
        }
        if (lessonId) {
            const lessonExists = await Lesson.findById(lessonId).select('_id');
            if (!lessonExists) return res.status(404).json({ message: 'Associated lesson not found.' });
        }
        // --- End Validation ---

        const newReport = new ProblemReport({
            student: studentId,
            course: courseId || null, // Store null if not provided
            lesson: lessonId || null,
            problemType,
            description,
            urlContext: urlContext || req.originalUrl || req.headers.referer, // Try to get context
        });

        await newReport.save();

        // Notify all admins about the new problem report
const admins = await User.find({ role: 'admin' }).select('_id');
for (const admin of admins) {
  const notification = await createNotificationAndEmit({
    userId: admin._id,
    title: 'New Problem Report',
    message:' A user has submitted a new problem report.',
    link: '/admin/reports/problems/${newReport._id}',
    type: 'warning'
  });

  // Real-time notification via Socket.IO (if available)
  if (req.io) {
    req.io.to(admin._id.toString()).emit('newNotification', notification);
  }
}

        res.status(201).json({ message: 'Problem report submitted successfully. Thank you for your feedback!' });

    } catch (error) {
        console.error("Error submitting problem report:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Failed to submit problem report.' });
    }
};
// --- ADMIN-FACING Controllers ---

/**
 * @desc    Get all problem reports (Admin)
 * @route   GET /api/admin/reports/problems (or dedicated /api/admin/reports)
 * @access  Private (Admin Only)
 */
exports.getAllProblemReports = async (req, res) => {
    try {
        const { status, problemType, courseId, studentId, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const query = {};

        if (status) query.status = status;
        if (problemType) query.problemType = problemType;
        if (courseId && mongoose.Types.ObjectId.isValid(courseId)) query.course = courseId;
        if (studentId && mongoose.Types.ObjectId.isValid(studentId)) query.student = studentId;

        const options = {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 },
            populate: [ // Populate related data for admin view
                { path: 'student', select: 'username email' }, // Student who reported
                { path: 'course', select: 'name' },            // Associated course name
                { path: 'lesson', select: 'title' }            // Associated lesson title
            ],
            lean: true
        };

        // Using mongoose-paginate-v2 if installed, otherwise basic find
        // const reports = await ProblemReport.find(query).sort(options.sort).skip(skip).limit(options.limit).populate(options.populate).lean();
        // const totalReports = await ProblemReport.countDocuments(query);

        // If using mongoose-paginate-v2 (npm install mongoose-paginate-v2)
        // and add ProblemReportSchema.plugin(mongoosePaginate); to your ProblemReportModel.js
        // const result = await ProblemReport.paginate(query, options);
        // return res.status(200).json({
        //     reports: result.docs,
        //     totalPages: result.totalPages,
        //     currentPage: result.page,
        //     totalReports: result.totalDocs
        // });

        // Basic pagination if not using a plugin
        const skip = (options.page - 1) * options.limit;
        const reports = await ProblemReport.find(query)
            .sort(options.sort)
            .skip(skip)
            .limit(options.limit)
            .populate(options.populate)
            .lean();
        const totalReports = await ProblemReport.countDocuments(query);

        res.status(200).json({
            reports,
            totalPages: Math.ceil(totalReports / options.limit),
            currentPage: options.page,
            totalReports
        });

    } catch (error) {
        console.error("Error fetching all problem reports:", error);
        res.status(500).json({ message: 'Failed to fetch problem reports.' });
    }
};

/**
 * @desc    Get a single problem report by ID (Admin)
 * @route   GET /api/admin/reports/problems/:reportId
 * @access  Private (Admin Only)
 */
exports.getProblemReportById = async (req, res) => {
    try {
        const { reportId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(reportId)) {
            return res.status(400).json({ message: 'Invalid Report ID format.' });
        }

        const report = await ProblemReport.findById(reportId)
            .populate('student', 'username email')
            .populate('course', 'name')
            .populate('lesson', 'title')
            .lean();

        if (!report) {
            return res.status(404).json({ message: 'Problem report not found.' });
        }
        res.status(200).json(report);
    } catch (error) {
        console.error(`Error fetching problem report ${req.params.reportId}:`, error);
        res.status(500).json({ message: 'Failed to fetch problem report.' });
    }
};

/**
 * @desc    Update a problem report's status and add admin notes (Admin)
 * @route   PUT /api/admin/reports/problems/:reportId
 * @access  Private (Admin Only)
 */
exports.updateProblemReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        const { status, adminNotes } = req.body;
        const adminUserId = req.user.id; // Admin who is making the update

        if (!mongoose.Types.ObjectId.isValid(reportId)) {
            return res.status(400).json({ message: 'Invalid Report ID format.' });
        }

        const report = await ProblemReport.findById(reportId);
        if (!report) {
            return res.status(404).json({ message: 'Problem report not found.' });
        }

        // Validate status if provided
        const allowedStatuses = ['new', 'investigating', 'resolved', 'wont_fix'];
        if (status && !allowedStatuses.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Allowed statuses are: ${allowedStatuses.join(', ')}.` });
        }

        if (status) report.status = status;
        if (adminNotes !== undefined) { // Allow empty string for notes

  const notePrefix = report.adminNotes ? `${report.adminNotes}\n--- Updated ---\n` : '';
            report.adminNotes = `${notePrefix}${new Date().toLocaleString()}: ${adminNotes.trim()}`;
        }
       await report.save();

       // Notify the reporter if the status is resolved
if (status === 'resolved') {
  const notification = await createNotificationAndEmit({ 
    req: req,
    userId: report.student,
    title: 'Problem Report Resolved',
    message: `Your problem report : ${report.problemType} has been marked as resolved.`,
    link: `/student/reports/${report._id}`,
    type: 'success'
  });        

  // Real-time notification via Socket.IO
  if (req.io) {
    req.io.to(report.student.toString()).emit('newNotification', notification);
  }
}
       const populatedReport = await ProblemReport.findById(report._id) // Use report._id from the saved doc
       .populate('student', 'username email') // Select specific fields
       .populate('course', 'name')           // Select specific fields
       .populate('lesson', 'title')          // Select specific fields
       .lean(); // Use lean as we are just sending data back

   if (!populatedReport) {
       // Should not happen if report.save() was successful, but good safety check
       return res.status(404).json({ message: 'Updated report could not be re-fetched.' });
   }

   // Optional: Log admin activity
   // await logAdminActivity(req, 'PROBLEM_REPORT_UPDATED', 'ProblemReport', reportId, `Status: ${status}`, { newStatus: populatedReport.status });

   res.status(200).json({ message: 'Problem report updated successfully.', report: populatedReport });

} catch (error) {
   console.error(`Error updating problem report ${req.params.reportId}:`, error);
   if (error.name === 'ValidationError') {
       return res.status(400).json({ message: Object.values(error.errors).map(err => err.message).join(', ') });
   }
   res.status(500).json({ message: 'Failed to update problem report.' });
}
};


/**
 * @desc    Delete a problem report (Admin)
 * @route   DELETE /api/admin/reports/problems/:reportId
 * @access  Private (Admin Only)
 */
exports.deleteProblemReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(reportId)) {
            return res.status(400).json({ message: 'Invalid Report ID format.' });
        }

        const report = await ProblemReport.findById(reportId);
        if (!report) {
            return res.status(404).json({ message: 'Problem report not found.' });
        }

        await report.deleteOne(); // Or ProblemReport.findByIdAndDelete(reportId);

        // TODO: Log admin activity for deleting a report

        res.status(200).json({ message: 'Problem report deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting problem report ${req.params.reportId}:`, error);
        res.status(500).json({ message: 'Failed to delete problem report.' });
    }
};