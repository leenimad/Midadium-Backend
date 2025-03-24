const crypto = require("crypto");
const User = require('../models/UserModel');
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

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Validate the provided password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
 
    // Generate a JWT token
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
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

module.exports = { signup, login, forgotPassword, resetPassword };