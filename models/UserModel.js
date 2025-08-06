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
    username: {
        type: String,
        required: [true, 'Username is required.'],
        unique: true, 
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required.'],
        unique: true, // Ensure emails are unique across all users
        trim: true,
        lowercase: true, // Store emails consistently
        validate: {
            validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), // Basic email format check
            message: props => `${props.value} is not a valid email address!`
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required.'],
        minlength: [6, 'Password must be at least 6 characters long.'] // Add min length validation
    },
    role: {
        type: String,
        required: true,
        enum: ['student', 'teacher', 'admin'],
        default: 'student' // Default new users to student role
    },
    resetCode: { type: String }, // For password reset via code
    resetCodeExpires: { type: Date },

    // --- Teacher Specific ---
    courses: { // Courses *managed* by the teacher
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
        default: undefined, // Default to undefined, set to [] in pre-save if role is teacher
    },

    favoriteCourses: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
        default: [] // Default to an empty array for students
    }


}, { timestamps: true }); // Automatically add createdAt and updatedAt

// --- Hooks ---

// Hash password & Manage role-specific fields before saving
UserSchema.pre('save', async function(next) {
    // --- Password Hashing ---
    if (this.isModified('password')) {
        try {
            // Add extra check for minimum length before hashing if not done by schema validation
            if (this.password.length < 6) {
                 throw new Error('Password must be at least 6 characters long.');
            }
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
        } catch (err) {
            return next(err); // Pass hashing error
        }
    }

    // --- Role-Specific Field Management ---

    if (this.role === 'teacher') {
        this.favoriteCourses = undefined;
        this.courses = this.courses || []; // Ensure courses is an array for teachers if needed
    } else if (this.role === 'student') {
        
        this.courses = undefined;
        this.favoriteCourses = this.favoriteCourses || [];

    } else { // Admin or other roles
       
        this.courses = undefined;
        this.favoriteCourses = undefined;
    }

    next(); // Proceed to save
});


// --- Methods ---
UserSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        console.error("Error comparing password:", error);
        return false; // Return false on comparison error
    }
};

module.exports = mongoose.model('User', UserSchema);