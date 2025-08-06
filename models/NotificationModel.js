const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // recipient
  title: { type: String, required: true },
  message: { type: String },
  link: { type: String }, // optional: link to relevant screen
  isRead: { type: Boolean, default: false },
  type: { type: String, enum: ['info', 'warning', 'success', 'review'], default: 'info' },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
