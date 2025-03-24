const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authMiddleware');

router.get('/dashboard', protect, authorizeRoles('admin'), (req, res) => {
  res.json({ message: "Welcome to the admin dashboard!" });
});

module.exports = router;
