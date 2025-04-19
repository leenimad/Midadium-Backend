// // const mongoose = require('mongoose');
// // const bcrypt = require('bcryptjs');
 
// // const UserSchema = new mongoose.Schema({
// //   username: { type: String, required: true },
// //   email:    { type: String, required: true, unique: true },
// //   password: { type: String, required: true },
// //   resetPasswordToken: { type: String },
// //   resetPasswordExpires: { type: Date },
// // });
  
// // // Hash the password before saving the user
// // UserSchema.pre('save', async function (next) {
// //   if (!this.isModified('password')) return next();
// //   const salt = await bcrypt.genSalt(10);
// //   this.password = await bcrypt.hash(this.password, salt);
// //   next();
// // });

// // // Compare provided password with the stored hashed password
// // UserSchema.methods.comparePassword = async function (candidatePassword) {
// //   return await bcrypt.compare(candidatePassword, this.password);
// // };

// // module.exports = mongoose.model('User', UserSchema);
// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');

// const UserSchema = new mongoose.Schema({
//   username: { type: String, required: true },
//   email:    { type: String, required: true, unique: true },
//   password: { type: String, required: true },
//   role: { 
//     type: String, 
//     required: true, 
//     enum: ['student', 'teacher', 'admin'], 
//     default: 'student'  // default role can be student
//   },
//   //fields for password reset using a code:
//   resetCode: { type: String },
//   resetCodeExpires: { type: Date },
// });

// // Hash password before saving (if modified)
// UserSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) return next();
//   const salt = await bcrypt.genSalt(10);
//   this.password = await bcrypt.hash(this.password, salt);
//   next();
// });

// // Compare password method
// UserSchema.methods.comparePassword = async function (candidatePassword) {
//   return await bcrypt.compare(candidatePassword, this.password);
// };

// module.exports = mongoose.model('User', UserSchema);
// backend/models/UserModel.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:  { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);  // Basic email regex
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  password: { type: String, required: true },
  role: {
    type: String,
    required: true,
    enum: ['student', 'teacher', 'admin'],
    default: 'student'
  },
  resetCode: { type: String },
  resetCodeExpires: { type: Date },
  // Add courses for teachers
  courses: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    default: undefined, // Make it explicitly undefined if not a teacher
   // required: function() { return this.role === 'teacher'; } // Optional: required only for teachers
  },
grade: {
  type: String,
  // Consider adding enum if grades are fixed: enum: ['Grade 1', 'Grade 2', ... 'Grade 12', 'Other'],
  default: undefined, // Make it explicitly undefined if not a student
 // required: function() { return this.role === 'student'; } // Optional: required only for students
},
enrollments: { // Courses the student is enrolled in
  type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
  default: undefined, // Make it explicitly undefined if not a student
 // required: function() { return this.role === 'student'; } // Optional: required only for students
}
}, { timestamps: true });  //added timestamps

// Remove empty arrays on save if role doesn't match
UserSchema.pre('save', function(next) {
  if (this.role !== 'teacher' && this.courses !== undefined) {
    this.courses = undefined;
  }
  if (this.role !== 'student' && this.enrollments !== undefined) {
    this.enrollments = undefined;
  }
   if (this.role !== 'student' && this.grade !== undefined) {
    this.grade = undefined;
  }
  next();
});

// Hash password before saving (if modified)
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try{
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    ////////////////////
    // Ensure role-specific fields are handled based on role BEFORE final save
    if (this.role === 'teacher') {
      this.grade = undefined;
      this.enrollments = undefined;
      this.courses = this.courses || []; // Ensure it's an array if teacher
    } else if (this.role === 'student') {
      this.courses = undefined;
      this.enrollments = this.enrollments || []; // Ensure it's an array if student
      // Grade should be set during creation/update for student
    } else { // Admin or other roles
      this.courses = undefined;
      this.enrollments = undefined;
      this.grade = undefined;
    }
    //////////////////
    next();
  } catch (err) {
    next(err); // Pass error to the next middleware or save operation
  }
  });
  
  // Compare password method
  UserSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };  

module.exports = mongoose.model('User', UserSchema); 