const Notification = require('../models/NotificationModel');

exports.getMyNotifications = async (req, res) => {
  try {
      console.log("[getMyNotifications] Fetching notifications for user:", req.user.id);
    const notifications = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).lean();
    res.status(200).json(notifications);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: 'Failed to load notifications' });
  }
};

 exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
     await Notification.findByIdAndUpdate(id, { isRead: true });
     res.status(200).json({ message: 'Marked as read' });
   } catch (err) {
     res.status(500).json({ message: 'Failed to update notification' });
  }
 };
/*exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id; // Ensure only the owner can mark as read

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndUpdate(
        { _id: id, user: userId }, // Ensure user owns the notification
        { isRead: true },
        { new: true } // Return the updated document
    );

    if (!notification) {
        return res.status(404).json({ message: "Notification not found or not authorized." });
    }
    res.status(200).json({ message: 'Marked as read', notification });
  } catch (err) {
    console.error("Error marking notification as read:", err);
    res.status(500).json({ message: 'Failed to update notification' });
  }
};*/

exports.createNotification = async ({ userId, title, message, link, type }) => {

  try {
    const notification = new Notification({
      user: userId,
      title,
      message,
      link,
      type
    });
    await notification.save();
    return notification;
  } catch (err) {
    console.error("Error creating notification:", err);
  }
};
exports.createNotificationAndEmit= async ({ req, userId, title, message, link, type }) => {
  if (!userId || !title) {
    console.error("[CreateNotificationAndEmit] Error: userId and title are required.");
    return null;
  }

  try {
    const notification = new Notification({
      user: userId,
      title,
      message,
      link,
      type
    });
    const savedNotification = await notification.save();
    console.log(`[CreateNotificationAndEmit] Notification saved to DB: ${savedNotification._id} for user ${userId}`);

    // --- Emit real-time notification if user is connected ---
    // Get io and connectedUsers from the app instance if req is available
    // This is crucial for emitting to the correct socket
    const io = req?.app?.get('socketio');
    const connectedUsers = req?.app?.get('connectedUsers');

    if (io && connectedUsers && userId && connectedUsers[userId.toString()]) {
      const userSocketId = connectedUsers[userId.toString()];
      console.log(`[CreateNotificationAndEmit] Attempting to emit 'new_notification' to user ${userId} on socket ${userSocketId}`);
      io.to(userSocketId).emit('new_notification', {
        // Send the full notification object or a subset
        _id: savedNotification._id.toString(),
        user: savedNotification.user.toString(), // Send user ID
        title: savedNotification.title,
        message: savedNotification.message,
        link: savedNotification.link,
        isRead: savedNotification.isRead,
        type: savedNotification.type,
        createdAt: savedNotification.createdAt.toISOString(),
        updatedAt: savedNotification.updatedAt.toISOString(),
      });
      console.log(`[CreateNotificationAndEmit] 'new_notification' emitted to socket ${userSocketId}`);
    } else {
      if (!io) console.warn("[CreateNotificationAndEmit] Socket.IO instance ('io') not found in app context.");
      if (!connectedUsers) console.warn("[CreateNotificationAndEmit] 'connectedUsers' map not found in app context.");
      if (userId && connectedUsers && !connectedUsers[userId.toString()]) {
         console.log(`[CreateNotificationAndEmit] User ${userId} not currently connected via socket or not found in map.`);
      }
      console.log(`[CreateNotificationAndEmit] Notification for user ${userId} saved to DB only (no real-time emit).`);
    }
    return savedNotification;

  } catch (err) {
    console.error("Error creating and emitting notification:", err);
    return null;
  }
};
