// backend/models/CourseModel.js
const mongoose = require('mongoose');

const CourseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to the User model (teacher)
    required: true
  }, 
  subject: { type: String },
  grade: { type: String },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  // Additional fields (if needed):
  syllabus: {type : String}, // course content
  resources : {type : String},
  students: [{ // Array of enrolled students
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
},{ timestamps: true });

module.exports = mongoose.model('Course', CourseSchema);