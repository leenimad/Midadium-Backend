const express = require('express');
const router = express.Router();
const { signup, login, forgotPassword, resetPassword } = require('../controllers/authController');

// Route to register a new user
router.post('/signup', signup);

// Route to login an existing user
router.post('/login', login);
// New routes for password reset functionality:
// New routes for password reset functionality:
router.post("/forgot-password", forgotPassword);
router.put("/reset-password", resetPassword);  // Now expects JSON body with email, resetCode, and new password
module.exports = router;
