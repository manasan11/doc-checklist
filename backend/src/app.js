const express = require('express');
const cors = require('cors');

const authRoutes = require('./modules/auth/auth.routes');
const studentRoutes = require('./modules/students/student.routes');
const documentRoutes = require('./modules/documents/document.routes');
const driveRoutes = require('./modules/drive/drive.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const documentController = require('./modules/documents/document.controller');
const { authenticateToken } = require('./middlewares/auth.middleware');
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());

// Modular Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/notifications', notificationRoutes);

// Direct Student Document routes
app.get('/api/students/:studentId/documents', authenticateToken, documentController.getStudentFollowupDocuments);
app.get('/api/students/:studentId/followup-documents', authenticateToken, documentController.getStudentFollowupDocuments);

// Root health & API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Document Checklist API',
    version: '2.0.0',
    architecture: 'Hybrid Modular Architecture with src/',
    status: 'online',
    endpoints: {
      auth: [
        'POST /api/auth/login',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'POST /api/auth/change-password'
      ],
      documents: ['GET /api/documents', 'POST /api/documents/:id/upload', 'PATCH /api/documents/:id/review', 'DELETE /api/documents/:id'],
      students: ['GET /api/students', 'PUT /api/students/:id', 'GET /api/students/:studentId/documents'],
      drive: ['GET /api/drive/status', 'GET /api/drive/files', 'POST /api/drive/sync', 'GET /api/drive/files/:id/view']
    }
  });
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;

