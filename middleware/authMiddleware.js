//  ../backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/UserModel')
const protect = async (req, res, next) => {
  let token = req.header('Authorization');
  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }
  try {
    token = token.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('id username email role');
    //req.user = decoded;
    if (!req.user) {
      // Handle case where user ID in token doesn't exist anymore (deleted user)
      // Use 401 Unauthorized as the token points to a non-existent user
      return res.status(401).json({ message: 'Not authorized, user not found for token' });
   }
    next();
  } catch (error) {
    console.error('Token verification or user fetch failed:', error.message);
    // Use 401 Unauthorized for token failures
   res.status(401).json({ message: 'Not authorized, token failed or invalid' });
  }
  if (!token) {
    // Use 401 Unauthorized when no token is provided
   res.status(401).json({ message: 'Not authorized, no token' });
 }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    }
    next();
  };
};

module.exports = { protect, authorizeRoles };
