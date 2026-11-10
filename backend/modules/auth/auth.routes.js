const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

// Public routes
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.get('/verify-reset-token', authController.verifyToken);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.post('/change-password', authenticateToken, authController.changePassword);
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
