const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

// Public endpoints
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected endpoints (Reset password directly in UI when logged in)
router.post('/change-password', authenticateToken, authController.changePassword);

module.exports = router;

