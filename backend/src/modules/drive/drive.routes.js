
const express = require('express');
const router = express.Router();
const driveController = require('./drive.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');

router.get('/status', driveController.getStatus);
router.get('/files', driveController.listFiles);
router.get('/documents', driveController.listFiles);

router.post('/sync', authenticateToken, driveController.syncFiles);
router.post('/sync-folders', authenticateToken, driveController.syncFolders);

router.get('/files/:id/view', driveController.viewFile);
router.get('/files/:id/download', driveController.downloadFile);

module.exports = router;

