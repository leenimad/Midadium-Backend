const express = require('express');
const dotenv = require('dotenv');

const connectDB = require('./config/db');
const cors = require('cors');
dotenv.config();

connectDB();
  
const app = express();
app.use(cors({
    origin: '*',  // Allow all origins (for testing)
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })); // Enable CORS
// Middleware to parse JSON bodies
 
// Mount authentication routes at /api/auth
app.use('/api/auth', require('./routes/authRoutes'));
// Mount admin routes (or other role-specific routes)
app.use('/api/admin', require('./routes/adminRoutes'));
// (Optional) You can add lesson routes similarly when needed:
// app.use('/api/lessons', require('./routes/lessonRoutes'));
//app.use('/api/lessons', require('./routes/lessonRoutes'))
// Mount teacher routes
app.use('/api/teacher', require('./routes/teacherRoutes'));
// Mount student routes
app.use('/api/student', require('./routes/studentRoutes'));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
