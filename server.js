const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const tls = require('tls');
const http = require('http'); // Node's built-in HTTP module
const { Server } = require("socket.io"); // Import Server from socket.io
const connectDB = require('./config/db');
const admin = require('firebase-admin');


dotenv.config();
// --- Socket.IO Setup ---


// --- Initialize Firebase Admin ---
try {
    // Construct absolute path to the service account key
    const serviceAccountPath = path.resolve(__dirname, 'config', 'firebase-service-account-key.json');
    const serviceAccount = require(serviceAccountPath); // Use the resolved path

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("CRITICAL: Failed to initialize Firebase Admin SDK. Check service account path and file.", error);
    // You might want to prevent the server from starting if this fails and chat is critical
    // process.exit(1);
}
// Connect to MongoDB Atlas
connectDB();


const app = express();
// --- Create HTTP Server and Initialize Socket.IO ---
const server = http.createServer(app); // Create HTTP server from Express app
const io = new Server(server, { // Initialize Socket.IO with the HTTP server
    cors: {
        origin: "*", // Allow all origins for testing. For production, restrict this.
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
    }
});
console.log("Socket.IO server initialized.");
// --- End Socket.IO Setup ---

app.use('/api/webhooks', require('./routes/webhookRoutes'));  
app.use(cors({
    origin: '*',  // Allow all origins (for testing)
    methods: ['GET', 'POST', 'PUT', 'DELETE','PATCH'], 
    allowedHeaders: ['Content-Type', 'Authorization']
  })); // Enable CORS
// Middleware to parse JSON bodies
app.use(express.json());

try {
  tls.DEFAULT_MIN_VERSION = 'TLSv1.3';
  console.log(`Forcing minimum TLS version to: ${tls.DEFAULT_MIN_VERSION}`);
} catch (tlsErr) {
  console.error("Error setting TLS min version:", tlsErr);
}  
// Mount authentication routes at /api/auth
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/lessons', require('./routes/lessonRoutes'))
// Mount teacher routes
app.use('/api/teacher', require('./routes/teacherRoutes'));
// Mount student routes
app.use('/api/student', require('./routes/studentRoutes'));
app.use('/api/assignments', require('./routes/assignmentRoutes'));
const reviewRouter = require('./routes/reviewRoutes');
app.use('/api/courses/:courseId/reviews', reviewRouter); // Mount nested route
app.use('/api/subjects', require('./routes/subjectRoutes')); // Handles general subject fetching/management
app.use('/api/public/courses', require('./routes/publicCourseRoutes'));
app.use('/api/public/teachers', require('./routes/publicTeacherRoutes'))
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), require('./routes/webhookRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/chatbot', require('./routes/chatbotRoutes'));
app.use('/api/recommendations', require('./routes/recommendationRoutes'));
app.use('/api/roadmaps', require('./routes/roadmapRoutes'));
// *** MOUNT NOTIFICATION ROUTES ***
app.use('/api/notifications', require('./routes/notificationRoutes'));

// --- Socket.IO Connection Handling ---
// Store connected users (userId -> socketId map)
// In a real app, use Redis or a proper store for multiple server instances
const connectedUsers = {};

io.on('connection', (socket) => {
    console.log(`Socket.IO: User connected - ${socket.id}`);
       socket.on('authenticate', (userIdFromClient) => {
    console.log(`[SocketIO Backend] Received 'authenticate' event for UserID: ${userIdFromClient} from Socket ID: ${socket.id}`);
    if (userIdFromClient && typeof userIdFromClient === 'string' && userIdFromClient.trim() !== '') {
        // Ensure the key is a string. If userIdFromClient is already a string, .toString() is harmless.
        connectedUsers[userIdFromClient.toString()] = socket.id;
        console.log(`[SocketIO Backend] User ${userIdFromClient} mapped to socket ${socket.id}.`);
        console.log(`[SocketIO Backend] Current connectedUsers:`, JSON.stringify(connectedUsers));
        socket.emit('authentication_success', { message: `Authenticated for user ${userIdFromClient}` }); 
} else {
            console.warn(`[Socket Auth] Received 'authenticate' event with invalid or missing userId.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Socket.IO: User disconnected - ${socket.id}`);
        // Remove user from connectedUsers map
        for (const userId in connectedUsers) {
            if (connectedUsers[userId] === socket.id) {
                delete connectedUsers[userId];
                console.log(`Socket.IO: User ${userId} removed from connected list.`);
                break;
            }
        }
    });
});

// --- Make `io` and `connectedUsers` accessible to controllers ---
// This is a common way to make it available, or use a dedicated service/module
app.set('socketio', io);
app.set('connectedUsers', connectedUsers);
// --- End Socket.IO Connection Handling ---


// --- Server Listen (Use the HTTP server, not app.listen) ---
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all interfaces
const PORT = process.env.PORT || 5000;

server.listen(PORT, HOST, () => { // Use server.listen
    console.log(`🚀 Server (with Socket.IO) running on port ${PORT} and accessible on your local network.`);
});

// for teama port number uncomment this and comment the above : 

//const HOST = '0.0.0.0';
//const PORT = process.env.PORT || 3000;

//server.listen(PORT, HOST, () => {
  //console.log(`🚀 Server running on http://${HOST}:${PORT}`);
//});
