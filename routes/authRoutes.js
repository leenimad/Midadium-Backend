// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { protect, authorizeRoles } = require('../middleware/authMiddleware'); 
const { signup, login, logout,forgotPassword, resetPassword, changePassword } = require('../controllers/authController');

// Route to register a new user
router.post('/signup', signup);

// Route to login an existing user
router.post('/login', login);
router.post('/logout', protect, logout);

router.post("/forgot-password", forgotPassword);
router.put("/reset-password", resetPassword);  // Now expects JSON body with email, resetCode, and new password
router.put('/change-password', protect, changePassword); // Using PUT seems appropriate

router.post('/firebase-custom-token', protect, async (req, res) => {
    try {
       
        const userId = req.user.id; // This is your MongoDB User ID
        const userRole = req.user.role; // This is your user's role (student, teacher, admin)

        if (!userId) {
            console.error("[FirebaseToken] User ID missing from JWT payload after 'protect' middleware.");
            return res.status(400).json({ message: "User identification failed." });
        }
        if (!userRole) {
            console.error("[FirebaseToken] User Role missing from JWT payload after 'protect' middleware.");
            // You could default or throw error, let's throw for now.
            return res.status(400).json({ message: "User role identification failed." });
        }

        const additionalClaims = {
            role: userRole,
          
        };

        console.log(`[FirebaseToken] Minting Firebase custom token for MongoDB User ID: ${userId} with claims:`, additionalClaims);

      
        const firebaseCustomToken = await admin.auth().createCustomToken(userId, additionalClaims);

        res.status(200).json({ firebaseToken: firebaseCustomToken });

    } catch (error) {
        console.error('Error creating Firebase custom token:', error);
        res.status(500).json({ message: 'Failed to generate Firebase session token.' });
    }
});


module.exports = router;
 