// backend/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // Any logged-in user can report
const reportController = require('../controllers/reportController');

// POST /api/reports/problem - Submit a new problem report
router.post('/problem', protect, reportController.submitProblemReport);

// --- Admin routes for reports (could be in adminRoutes.js) ---
// router.get('/problem', protect, authorizeRoles('admin'), reportController.getAllProblemReports);
// router.put('/problem/:reportId/status', protect, authorizeRoles('admin'), reportController.updateProblemReportStatus);

module.exports = router;