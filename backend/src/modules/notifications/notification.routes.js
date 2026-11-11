const express = require('express');
const router = express.Router();
const notificationController = require('./notification.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

router.use(authenticateToken);

router.get('/', notificationController.getNotifications);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;

