const express = require('express');
const router = express.Router();
const notificationController = require('./notification.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', notificationController.getNotifications);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
