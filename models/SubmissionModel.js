const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true,
  },
  content: {
    type: String, // أو يمكنك استخدام file URL لاحقًا إذا سترفع ملفات
    required: false,
  },
  file: {
    type: String, // رابط PDF أو صورة أو ملف آخر مرفوع
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },

  // ✅ NEW: Teacher review fields
  review: {
    type: String, // Feedback or comments from the teacher
  },
  reviewDate: {
    type: Date, // When the review was given
  },
  rating: {
    type: Number, // Optional: numeric rating
    min: 1,
    max: 5,
  }
}, { timestamps: true });

module.exports = mongoose.model('Submission', submissionSchema);
