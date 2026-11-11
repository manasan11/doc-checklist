const notificationService = require('./notification.service');

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { limit, unreadOnly } = req.query;
    const notifications = await notificationService.getUserNotifications(userId, {
      limit: limit ? parseInt(limit, 10) : 50,
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1'
    });
    return res.json({
      success: true,
      count: notifications.length,
      data: notifications
    });
  } catch (err) {
    console.error('[NotificationController] getNotifications error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to retrieve notifications' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const notificationId = parseInt(req.params.id, 10);
    const updated = await notificationService.markAsRead(notificationId, userId);
    return res.json({ success: updated });
  } catch (err) {
    console.error('[NotificationController] markAsRead error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const updated = await notificationService.markAllAsRead(userId);
    return res.json({ success: updated });
  } catch (err) {
    console.error('[NotificationController] markAllAsRead error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to mark notifications as read' });
  }
};
