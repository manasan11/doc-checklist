const express = require('express');
const router = express.Router();
const notificationController = require('./notification.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

router.use(authenticateToken);

router.get('/', notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/mark-all-read', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
