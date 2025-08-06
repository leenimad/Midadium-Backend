// backend/models/CourseModel.js
const mongoose = require('mongoose');

const CourseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }, 
  subject: {
    type: mongoose.Schema.Types.ObjectId, // Reference Subject by ID
    ref: 'Subject',                      // Link to the Subject model
    required: [true, 'Subject is required for the course.'],
    index: true
  }, 
 //grade: { type: String },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  price: { // *** ADDED: Price for the course ***
    type: Number,
    required: [true, 'Course price is required.'],
    min: [0, 'Price cannot be negative.'],
    default: 0 // Default to free, admin/teacher should set
  },

  syllabus: {type : String}, // course content
  resources : {type : String},

  ratingAverage: {
    type: Number,
    default: 0,
    min: [0, 'Rating must be at least 0'],
    max: [5, 'Rating cannot be more than 5'],
    // Optional: Set based on calculated value, using default is safer
    // set: (val) => Math.round(val * 10) / 10 // Round to one decimal place
  },
  reviewCount: {
    type: Number,
    default: 0,
    min: [0, 'Review count cannot be negative']
  },
  
},{ timestamps: true });
CourseSchema.index({ ratingAverage: -1 });
module.exports = mongoose.model('Course', CourseSchema);