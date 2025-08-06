const crypto = require("crypto");
const User = require('../models/UserModel');
//const protect= require('../middleWare/authMiddleware');

const jwt = require('jsonwebtoken');
const sendEmail = require("../utils/email");

const signup = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Check if a user with the same email already exists
    let user = await User.findOne({ email }); 
    if (user) {
      return res.status(400).json({ message: "User already exists" });
    }
     // Optionally, restrict self-assignment of roles
    // For example, only allow student and teacher here:
    const allowedRoles = ['student', 'teacher','admin'];
    const userRole = allowedRoles.includes(role) ? role : 'student';

    // Create a new user and save to DB
    user = new User({ username, email, password, role: userRole });
    await user.save();

    // Generate a JWT token
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// const login = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     // Find user by email
//     const user = await User.findOne({ email });
//     if (!user) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     // Validate the provided password
//     const isMatch = await user.comparePassword(password);
//     if (!isMatch) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }
 
//     // Generate a JWT token
//     const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
//     res.status(200).json({
//       token,
//       user: { id: user._id, username: user.username, email: user.email, role: user.role }
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Server error" });
//   }
// };
const login = async (req, res) => {
  try {
    // --- Allow login using either email or username ---
    const { loginIdentifier, password } = req.body; // Rename 'email' field from body to 'loginIdentifier'

    // Validate input
    if (!loginIdentifier || !password) {
        return res.status(400).json({ message: "Please provide email/username and password" });
    }

    // Determine if the identifier looks like an email or username
    // A simple check for '@' is usually sufficient
    const isEmail = loginIdentifier.includes('@');

    // --- Find user by EITHER email or username ---
    let user;
    if (isEmail) {
        // Find by email (convert to lowercase for case-insensitive matching)
        console.log(`Attempting login with email: ${loginIdentifier}`);
        user = await User.findOne({ email: loginIdentifier.toLowerCase() });
    } else {
        // Find by username (consider if username should be case-sensitive or not)
        // Using a case-insensitive regex search for username:
        console.log(`Attempting login with username: ${loginIdentifier}`);
        //user = await User.findOne({ username: { $regex: `^${loginIdentifier}$`, $options: 'i' } });
        user = await User.findOne({ username: loginIdentifier });
        // Or, if usernames ARE case-sensitive:
        // user = await User.findOne({ username: loginIdentifier });
    }

    // Check if user exists
    if (!user) {
      console.log(`Login failed: No user found for identifier: ${loginIdentifier}`);
      return res.status(400).json({ message: "Invalid credentials" }); // Keep generic message
    }

    // Validate the provided password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log(`Login failed: Incorrect password for user: ${user.email}`);
      return res.status(400).json({ message: "Invalid credentials" }); // Keep generic message
    }

    // Prevent non-active or specific roles from logging in if needed
    // Example: if (user.status !== 'active') { return res.status(401)... }

    console.log(`Login successful for user: ${user.email} (Role: ${user.role})`);
 
    // --- Generate JWT Token (Include necessary user info) ---
    const payload = {
        id: user._id,
        role: user.role,
        username: user.username // Include username in token if useful for frontend/logging
    };
    const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '7d' } // Or your desired expiration
    );

    // --- Respond with Token and User Info ---
    res.status(200).json({
      token,
      user: { // Send back basic user info needed by frontend
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
      }
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error during login" });
  }
};

// Forgot Password: Generate a reset code and send it via email
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    // Find the user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetCodeExpires = Date.now() + 10 * 60 * 1000; // Code valid for 10 minutes

    await user.save({ validateBeforeSave: false });

    // Construct email message
    const message = `Your password reset code is: ${resetCode}. It is valid for 10 minutes.`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Password Reset Code",
        message,
      });
      res.status(200).json({ message: "Reset code sent to email" });
    } catch (error) {
      // Clear the code if email fails
      user.resetCode = undefined;
      user.resetCodeExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Email could not be sent" });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Reset Password: Verify code and update password
const resetPassword = async (req, res) => {
  // Expecting: email, resetCode, new password
  const { email, resetCode, password } = req.body;
  try {
    // Find user by email, code and check expiration
    const user = await User.findOne({
      email,
      resetCode,
      resetCodeExpires: { $gt: Date.now() },
    });

    console.log("Reset Password Request:");
    console.log("Current time:", new Date(Date.now()).toISOString());
    if (!user) {
      return res.status(400).json({ message: "Invalid code or code expired" });
    }
 
    // Set new password and clear reset fields
    user.password = password;
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; // From protect middleware

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Please provide current and new passwords" });
    }

     if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long" });
    }

    // Find user by ID extracted from token
    const user = await User.findById(userId);
    if (!user) {
      // Should not happen if token is valid, but good practice
      return res.status(404).json({ message: "User not found" });
    }

    // Validate the current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect current password" });
    }

     // Check if new password is the same as the old one
    if (currentPassword === newPassword) {
        return res.status(400).json({ message: "New password cannot be the same as the old password" });
    }


    // Set the new password (the pre-save hook in UserModel will hash it)
    user.password = newPassword;
    await user.save();

    res.status(200).json({ message: "Password changed successfully" });

  } catch (error) {
    console.error("Change Password Error:", error);
    // Handle potential validation errors from Mongoose during save if needed
     if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ message: messages.join(', ') });
      }
    res.status(500).json({ message: "Server error while changing password" });
  }
};
const logout = async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from token

    // --- Main action: Log the event ---
    console.log(`User logged out: ${userId} at ${new Date().toISOString()}`);
    // In a real application, use a proper logging library (e.g., Winston, Pino)
    // and log more details if needed (IP address, user agent, etc.)

    // --- No token invalidation needed in this simple approach ---

    res.status(200).json({ message: "Logout recorded successfully" });

  } catch (error) {
    console.error("Logout Endpoint Error:", error);
    res.status(500).json({ message: "Server error during logout process" });
  }
};
module.exports = { signup, login,logout, forgotPassword, resetPassword,changePassword };