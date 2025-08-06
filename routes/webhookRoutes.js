// backend/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Use express.raw for Stripe webhook signature verification
// Apply this middleware ONLY to this specific route
router.post(
    '/stripe',
    express.raw({ type: 'application/json' }), // Crucial for signature verification
    webhookController.handleStripeWebhook
);

module.exports = router;