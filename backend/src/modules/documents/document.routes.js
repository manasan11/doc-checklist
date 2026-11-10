const express = require('express');
const router = express.Router();
const documentController = require('./document.controller');
const { authenticateToken } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

router.get('/all', authenticateToken, documentController.getAllDocumentsOverview);
router.get('/', authenticateToken, documentController.getDocuments);
router.get('/:id', authenticateToken, documentController.getDocumentById);

router.post('/:id/upload', authenticateToken, upload.single('file'), documentController.handleDocumentUpload);
router.post('/upload', authenticateToken, upload.single('file'), documentController.handleDocumentUpload);

router.put('/:id', authenticateToken, documentController.updateMetadata);

router.patch('/:id/review', authenticateToken, documentController.reviewDocument);
router.patch('/:id/verification-status', authenticateToken, documentController.reviewDocument);

router.delete('/:id', authenticateToken, documentController.deleteDocument);

module.exports = router;

