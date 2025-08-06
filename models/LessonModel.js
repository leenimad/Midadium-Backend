// backend/models/LessonModel.js

const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    objectives: {
      type: String,
      required: true,
    },
    keywords: {
      type: [String],
      default: [],
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    videoUrl: {
      type: String,
    },
    videoOriginalName: {
      type: String,
    },
    status: {
      type: String,
      enum: ['processing', 'ready', 'error'],
      default: 'ready',
    },
    transcript: {
      type: String,
    },
    audioPath: {
      type: String,
    },
    errorMessage: {
      type: String,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Lesson || mongoose.model('Lesson', lessonSchema);
