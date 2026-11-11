const notificationService = require('./notification.service');

async function getNotifications(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const notifications = await notificationService.getNotificationsForUser(req.user, limit);
    return res.json({
      success: true,
      notifications
    });
  } catch (err) {
    console.error('[NotificationController] getNotifications error:', err);
    return res.status(500).json({ error: 'Failed to retrieve notifications' });
  }
}

async function getUnreadCount(req, res) {
  try {
    const result = await notificationService.getUnreadCount(req.user);
    return res.json({
      success: true,
      unreadCount: result.unreadCount
    });
  } catch (err) {
    console.error('[NotificationController] getUnreadCount error:', err);
    return res.status(500).json({ error: 'Failed to retrieve unread notification count' });
  }
}

async function markAsRead(req, res) {
  try {
    const notificationId = req.params.id;
    const result = await notificationService.markAsRead(notificationId, req.user);
    if (!result.success) {
      return res.status(404).json({ error: 'Notification not found or unauthorized' });
    }
    return res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (err) {
    console.error('[NotificationController] markAsRead error:', err);
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
}

async function markAllAsRead(req, res) {
  try {
    const result = await notificationService.markAllAsRead(req.user);
    return res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (err) {
    console.error('[NotificationController] markAllAsRead error:', err);
    return res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
};
