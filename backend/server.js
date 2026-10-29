require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const dataStore = require('./dataStore');
const driveService = require('./driveService');
const db = require('./db');
const mailService = require('./mailService');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'doc-checklist-super-secret-key-2026';

// Middleware
app.use(cors());
app.use(express.json());

// In-memory multer storage for passing buffer to Google Drive
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB limit
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const headerUserId = req.headers['x-user-id'];
  const headerUserEmail = req.headers['x-user-email'];

  // 1. Try decoding valid JWT
  if (token && !token.startsWith('local_') && !token.startsWith('token_')) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded) {
        let user = decoded.id ? dataStore.findUserById(decoded.id) : null;
        if (!user && decoded.email) {
          user = dataStore.findUserByEmailOrUsername(decoded.email);
        }
        if (user) {
          req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
          return next();
        }
        // Fallback if user ID changed but email matches
        if (decoded.id && decoded.email) {
          req.user = { id: decoded.id, email: decoded.email, name: decoded.name || 'User', role: decoded.role || 'user' };
          return next();
        }
      }
    } catch (_) {}
  }

  // 2. Resolve user by header ID or Email
  let user = null;
  if (headerUserId) {
    user = dataStore.findUserById(headerUserId);
  }
  if (!user && (headerUserEmail || headerUserId)) {
    const identifier = headerUserEmail || headerUserId;
    user = dataStore.findUserByEmailOrUsername(identifier);
  }

  if (user) {
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return next();
  }

  return res.status(401).json({ error: 'Authentication required. Please log in.' });
}

// Optional Auth (for drive view links or fallback)
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (!err) req.user = decoded;
      next();
    });
  } else {
    next();
  }
}

// ======================== AUTH ROUTES ========================

// 1. Login - only registered database users can log in
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const result = await dataStore.authenticateUser(username, password);
  if (!result || result.error) {
    return res.status(401).json({ error: result?.error || 'Invalid credentials' });
  }

  const user = result;

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  return res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      department: user.department
    }
  });
});

// 2. Forgot Password Request - sends password reset link to user's registered email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address or username is required' });
    }

    // Refresh state from MySQL to ensure deleted users cannot request password resets
    try {
      await dataStore.loadFromMysql();
    } catch (_) {}

    const trimmedInput = email.trim();
    const cleanLower = trimmedInput.toLowerCase();

    // Query MySQL directly to dynamically find whichever user requested the reset
    let user = null;
    try {
      const pool = db.getPool();
      if (pool) {
        // 1. Check student table first (primary table)
        const [stuRows] = await pool.query(
          'SELECT * FROM student WHERE (LOWER(TRIM(Username)) = ? OR LOWER(TRIM(Email)) = ? OR Student_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [cleanLower, cleanLower, cleanLower]
        );
        if (stuRows && stuRows.length > 0) {
          const s = stuRows[0];
          user = {
            id: `u-${s.Student_Id}`,
            email: s.Email,
            username: s.Username || s.Email,
            name: s.Student_Name,
            role: 'user',
            department: s.Proceeding_Course_Name || 'General Operations',
            studentCode: s.Student_Id
          };
        } else {
          // 2. Check users table
          const [rows] = await pool.query(
            'SELECT * FROM users WHERE LOWER(TRIM(username)) = ? OR LOWER(TRIM(email)) = ?',
            [cleanLower, cleanLower]
          );
          if (rows && rows.length > 0) {
            const row = rows[0];
            user = {
              id: row.id,
              email: row.email,
              username: row.username,
              name: row.name,
              role: row.role,
              department: row.department,
              studentCode: row.student_code
            };
          }
        }
      }
    } catch (dbErr) {
      console.warn('[Forgot Password] MySQL query error:', dbErr.message);
    }

    if (!user) {
      user = dataStore.findUserByEmailOrUsername(trimmedInput);
    }

    if (!user) {
      return res.status(404).json({ error: 'No account registered with this email or username in the database' });
    }

    // Generate token strictly for THAT user's registered email
    const resetToken = dataStore.createResetToken(user.email, user);

    // Resolve client origin
    const origin = req.headers.origin || req.headers.referer;
    let clientOrigin = 'http://localhost:4200';
    if (origin) {
      try {
        const parsed = new URL(origin);
        clientOrigin = `${parsed.protocol}//${parsed.host}`;
      } catch (_) {
        clientOrigin = origin.replace(/\/$/, '');
      }
    }

    // Direct password reset URL to open password reset view with token
    const resetLink = `${clientOrigin}/login?view=reset&token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(user.email)}`;

    let mailResult = { liveEmailSent: false };
    try {
      mailResult = await mailService.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetLink,
        token: resetToken
      });
    } catch (mailErr) {
      console.error('[Forgot Password] Mail error:', mailErr.message);
    }

    return res.json({
      message: mailResult.liveEmailSent
        ? `A password reset link has been sent to your registered email (${user.email}). Please check your inbox and click the link to reset your password.`
        : `Password reset link prepared for ${user.email}. Check your email or use the reset link below.`,
      resetLink,
      resetToken,
      email: user.email,
      liveEmailSent: mailResult.liveEmailSent,
      instructions: `Please click the link sent to your registered email address (${user.email}) to set a new password.`
    });
  } catch (err) {
    console.error('[Forgot Password] Server error:', err);
    return res.status(500).json({ error: 'Failed to process forgot password request: ' + err.message });
  }
});

// 2b. Verify Reset Token - called when user opens the reset link
app.get('/api/auth/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ valid: false, error: 'Reset token is required' });
  }

  const tokenInfo = dataStore.getResetToken(token);
  if (!tokenInfo || tokenInfo.expiresAt < Date.now()) {
    return res.status(400).json({ valid: false, error: 'This password reset link has expired or is invalid. Please request a new one.' });
  }

  const user = dataStore.findUserByEmailOrUsername(tokenInfo.email);
  return res.json({
    valid: true,
    email: tokenInfo.email,
    name: user ? user.name : tokenInfo.email
  });
});

// 3. Password Reset - updates user password with token
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const result = await dataStore.verifyAndResetPassword(token, newPassword);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  // Also update MySQL table directly to guarantee persistence in student and users tables
  try {
    const pool = db.getPool();
    if (pool && result.email) {
      const cleanEmail = result.email.toLowerCase().trim();
      await pool.query(
        'UPDATE student SET Password = ? WHERE LOWER(TRIM(Email)) = ? OR LOWER(TRIM(Username)) = ?',
        [newPassword, cleanEmail, cleanEmail]
      );
      try {
        await pool.query(
          'UPDATE users SET password = ? WHERE LOWER(TRIM(email)) = ? OR LOWER(TRIM(username)) = ?',
          [newPassword, cleanEmail, cleanEmail]
        );
      } catch (_) {}
      await dataStore.loadFromMysql();
    }
  } catch (err) {
    console.warn('[MySQL] Notice updating password in student/users table:', err.message);
  }

  return res.json({
    message: 'Password has been successfully updated. You may now log in with your new password.',
    email: result.email
  });
});

// 4. Authenticated Change / Reset Password (after login)
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: 'New password is required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match.' });
  }

  const result = await dataStore.updateUserPassword(req.user.id, newPassword);
  if (!result.success) {
    return res.status(400).json({ error: result.message || 'Failed to update password.' });
  }

  // Also update MySQL table student and users directly to guarantee persistence
  try {
    const pool = db.getPool();
    if (pool) {
      const user = dataStore.findUserById(req.user.id);
      const studentCode = user?.studentCode || (String(req.user.id).includes('STU') ? String(req.user.id).replace(/^u-/, '') : null);
      const cleanEmail = (req.user.email || user?.email || '').toLowerCase().trim();
      const cleanUsername = (user?.username || '').toLowerCase().trim();

      await pool.query(
        'UPDATE student SET Password = ? WHERE (Student_Id IS NOT NULL AND Student_Id = ?) OR (LOWER(TRIM(Email)) = ? AND Email IS NOT NULL AND Email != "") OR (LOWER(TRIM(Username)) = ? AND Username IS NOT NULL AND Username != "")',
        [newPassword, studentCode, cleanEmail, cleanUsername]
      );
      try {
        await pool.query(
          'UPDATE users SET password = ? WHERE id = ? OR (student_code IS NOT NULL AND student_code = ?) OR (LOWER(TRIM(email)) = ? AND email IS NOT NULL AND email != "")',
          [newPassword, req.user.id, studentCode, cleanEmail]
        );
      } catch (_) {}
      await dataStore.loadFromMysql();
    }
  } catch (err) {
    console.warn('[MySQL] Notice updating password in student/users table:', err.message);
  }

  return res.json({
    message: 'Your password has been reset successfully.'
  });
});

// Current User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = dataStore.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    department: user.department
  });
});

// ======================== DOCUMENT CHECKLIST ROUTES ========================

// 1. Get Document Checklist (with optional auto-sync from Google Drive)
app.get('/api/documents', authenticateToken, async (req, res) => {
  const targetUserId = (req.user.role === 'admin' && req.query.userId) 
    ? req.query.userId 
    : req.user.id;

  // Refresh latest state from MySQL so changes made in MySQL Workbench appear immediately in the app
  try {
    await dataStore.loadFromMysql();
  } catch (_) {}

  // Optional on-demand Drive sync: /api/documents?sync=true
  if (req.query.sync === 'true' || req.query.syncDrive === 'true') {
    try {
      const driveList = await driveService.listFiles();
      if (driveList && driveList.files) {
        dataStore.syncGoogleDriveFiles(targetUserId, driveList.files);
      }
    } catch (syncErr) {
      console.warn('[Sync Notice]:', syncErr.message);
    }
  }

  const documents = dataStore.getUserDocuments(targetUserId);
  return res.json({
    userId: targetUserId,
    totalDocuments: documents.length,
    uploadedCount: documents.filter(d => d.uploadStatus === 'Uploaded').length,
    approvedCount: documents.filter(d => d.approvalStatus === 'Approved').length,
    pendingCount: documents.filter(d => d.uploadStatus === 'Uploaded' && d.approvalStatus === 'Pending').length,
    rejectedCount: documents.filter(d => d.approvalStatus === 'Rejected').length,
    documents
  });
});

// 2. Get All Documents across users (Admin overview)
app.get('/api/documents/all', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const usersWithDocs = dataStore.getAllUsersWithDocuments();
  return res.json({
    totalUsers: usersWithDocs.length,
    users: usersWithDocs
  });
});

// 3. Get Single Document with full version history
app.get('/api/documents/:id', authenticateToken, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = (req.user.role === 'admin' && req.query.userId) 
    ? req.query.userId 
    : req.user.id;

  const doc = dataStore.getDocumentById(targetUserId, docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  return res.json(doc);
});

// ==================== AUTOMATED STUDENT DRIVE FOLDER SYSTEM ====================

/**
 * Ensures a student has a verified, dedicated Google Drive folder (not shared with any other user).
 * If missing, invalid, or duplicated, creates the folder on Google Drive and updates MySQL & DataStore.
 */
async function ensureUserDriveFolder(user) {
  if (!user || user.role === 'admin') {
    return { folderId: null, folderName: null };
  }

  dataStore.ensureStudentCode(user);
  const expectedFolderName = dataStore.getStudentFolderSlug(user);

  let folderId = user.driveFolderId;
  let folderName = user.driveFolderName || expectedFolderName;
  let needsCreation = false;

  // 1. Is folder ID empty or emulated?
  if (!folderId || folderId.startsWith('gdrive_') || folderId.startsWith('local_')) {
    needsCreation = true;
  } else {
    // 2. Is this folder ID accidentally shared with another user (e.g., duplicated row in MySQL)?
    const isShared = (dataStore.data.users || []).some(
      u => u.id !== user.id && u.driveFolderId === folderId
    );
    if (isShared) {
      console.warn(`[Google Drive] Notice: Folder ID ${folderId} for ${user.name} (${user.studentCode}) is already used by another user. Creating distinct folder "${expectedFolderName}"...`);
      needsCreation = true;
    } else {
      // 3. Does the folder actually exist on Google Drive?
      const exists = await driveService.verifyFolderExists(folderId);
      if (!exists) {
        console.warn(`[Google Drive] Folder ID ${folderId} for ${user.name} not found on Drive. Creating "${expectedFolderName}"...`);
        needsCreation = true;
      }
    }
  }

  if (needsCreation) {
    console.log(`[Google Drive] Auto-creating dedicated Drive folder: "${expectedFolderName}" for user ${user.name} (${user.studentCode || user.id})...`);
    const folderResult = await driveService.getOrCreateStudentFolder(expectedFolderName);
    if (folderResult && folderResult.folderId && !folderResult.folderId.startsWith('gdrive_')) {
      folderId = folderResult.folderId;
      folderName = folderResult.folderName || expectedFolderName;
      user.driveFolderId = folderId;
      user.driveFolderName = folderName;
      dataStore.setUserDriveFolder(user.id, folderId, folderName);

      // Persist directly to MySQL users table
      try {
        const pool = db.getPool();
        if (pool) {
          await pool.query('UPDATE users SET drive_folder_id = ?, drive_folder_name = ? WHERE id = ?', [
            folderId,
            folderName,
            user.id
          ]);
        }
      } catch (sqlErr) {
        console.warn('[MySQL] Notice updating drive_folder_id in users:', sqlErr.message);
      }
      console.log(`[Google Drive] Successfully linked folder for ${user.name}: ID=${folderId}, Name="${folderName}"`);
    }
  }

  return { folderId, folderName };
}

/**
 * Scan all users in MySQL / DataStore and ensure every student has their dedicated Google Drive folder.
 */
async function ensureAllUserFolders() {
  const users = dataStore.data.users || [];
  let checked = 0;
  for (const u of users) {
    if (u.role === 'admin') continue;
    try {
      await ensureUserDriveFolder(u);
      checked++;
    } catch (e) {
      console.warn(`[Google Drive] Could not verify folder for ${u.name}:`, e.message);
    }
  }
  return checked;
}

/**
 * Safely generates a clean filename from a dynamic document type, preserving the original extension.
 * E.g.:
 * - "Aadhaar Card", "IMG1234.pdf" -> "Aadhaar_Card.pdf"
 * - "PAN Card", "scan45.jpg" -> "PAN_Card.jpg"
 * - "Resume", "manasa_cv.pdf" -> "Resume.pdf"
 * - "Degree Certificate", "cert.docx" -> "Degree_Certificate.docx"
 * - "Experience Certificate", "doc.pdf" -> "Experience_Certificate.pdf"
 */
function generateFilenameFromDocType(documentType, originalname) {
  const extension = path.extname(originalname || '') || '';
  if (!documentType || typeof documentType !== 'string' || !documentType.trim()) {
    return originalname || `Document${extension}`;
  }

  // Remove invalid filename characters: / \ : * ? " < > |
  // Replace spaces and consecutive whitespace with an underscore '_'
  let cleanType = documentType.trim()
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!cleanType) {
    cleanType = 'Document';
  }

  const cleanExt = extension.startsWith('.') ? extension : (extension ? `.${extension}` : '');
  return `${cleanType}${cleanExt}`;
}

// 4. Upload or Re-upload Document with Dynamic Renaming based on Document Type
const handleDocumentUpload = async (req, res) => {
  const rawDocId = req.params.id ? parseInt(req.params.id, 10) : null;
  const targetUserId = req.user.id;
  const userNotes = req.body.notes || '';
  const requestedDocType = (req.body.documentType || req.body.docType || '').trim();

  if (!req.file) {
    return res.status(400).json({ error: 'Please choose a document file to upload.' });
  }

  try {
    const user = dataStore.findUserById(targetUserId);
    if (!user) {
      return res.status(404).json({ error: 'User account not found' });
    }

    // Resolve existing document by ID or by Document Type name (Requirement 8)
    let existingDoc = null;
    if (rawDocId && !isNaN(rawDocId)) {
      existingDoc = dataStore.getDocumentById(targetUserId, rawDocId);
    }
    if (!existingDoc && requestedDocType) {
      existingDoc = (user.documents || []).find(d => 
        (d.name || '').trim().toLowerCase() === requestedDocType.toLowerCase()
      );
    }

    // Determine the effective document type (from request, or falling back to existing document's name)
    const effectiveDocType = requestedDocType || (existingDoc ? existingDoc.name : 'Document');

    // Permission Verification if document is locked
    if (existingDoc && existingDoc.permissions && !existingDoc.permissions.canUpload) {
      return res.status(403).json({
        error: 'Upload not permitted. This document is currently locked or approved.',
        permissions: existingDoc.permissions
      });
    }

    // Generate safe, dynamic filename from the selected document type (Requirements 2, 3, 6)
    const finalFileName = generateFilenameFromDocType(effectiveDocType, req.file.originalname);
    console.log(`[Dynamic File Renaming] "${req.file.originalname}" -> "${finalFileName}" (Document Type: "${effectiveDocType}")`);

    // Ensure student has their own unique verified Google Drive folder
    const folderInfo = await ensureUserDriveFolder(user);
    const studentFolderId = folderInfo.folderId;
    const studentFolderName = folderInfo.folderName;

    console.log(`[Google Drive Upload] Target folder for ${user.name} (${user.studentCode || user.id}): "${studentFolderName}" (ID: ${studentFolderId})`);

    // 1. Upload to Google Drive / local storage with the renamed filename
    const driveResult = await driveService.uploadFile({
      originalname: req.file.originalname,
      targetFileName: finalFileName,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
      size: req.file.size,
      folderId: studentFolderId,
      studentFolderName: studentFolderName
    });

    driveResult.fileName = finalFileName;

    // If upload returned a real folderId and user didn't have it saved yet
    if ((!user.driveFolderId || user.driveFolderId.startsWith('gdrive_')) && driveResult.folderId && !driveResult.folderId.startsWith('gdrive_') && driveResult.folderId !== driveService.folderId) {
      dataStore.setUserDriveFolder(targetUserId, driveResult.folderId, studentFolderName);
    }

    // 2. Update Document record in DataStore & MySQL
    const targetDocId = existingDoc ? existingDoc.id : rawDocId;
    const updatedDoc = await dataStore.saveDocumentUpload(
      targetUserId, 
      targetDocId, 
      driveResult, 
      userNotes, 
      effectiveDocType
    );

    return res.json({
      message: `Document "${effectiveDocType}" uploaded successfully as "${finalFileName}" into folder "${studentFolderName || 'Document'}"`,
      document: updatedDoc,
      generatedFileName: finalFileName,
      documentType: effectiveDocType,
      studentFolder: {
        id: studentFolderId,
        name: studentFolderName
      }
    });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({ error: 'Failed to process document upload: ' + err.message });
  }
};

app.post('/api/documents/:id/upload', authenticateToken, upload.single('file'), handleDocumentUpload);
app.post('/api/documents/upload', authenticateToken, upload.single('file'), handleDocumentUpload);

// 5. Update Document metadata (notes, fileName)
app.put('/api/documents/:id', authenticateToken, (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.user.id;

  try {
    const updatedDoc = dataStore.updateDocumentMetadata(targetUserId, docId, req.body);
    return res.json({
      message: 'Document metadata updated successfully.',
      document: updatedDoc
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// 6. Admin Review & Lock Document
app.patch('/api/documents/:id/review', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin permission required to review documents.' });
  }

  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.body.userId || 'u-1';
  const { approvalStatus, isLocked, adminFeedback } = req.body;

  try {
    const updatedDoc = dataStore.adminReviewDocument(targetUserId, docId, {
      approvalStatus,
      isLocked,
      adminFeedback
    });
    return res.json({
      message: `Document reviewed: ${approvalStatus || 'Status updated'}`,
      document: updatedDoc
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// 7. Delete Document or Version
app.delete('/api/documents/:id', authenticateToken, async (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.user.id;
  const versionNumber = req.query.version ? parseInt(req.query.version, 10) : undefined;

  // Refresh latest state from MySQL first
  try {
    await dataStore.loadFromMysql();
  } catch (_) {}

  const existingDoc = dataStore.getDocumentById(targetUserId, docId);
  if (!existingDoc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Only block if locked by admin and not rejected
  if (existingDoc.isLocked && existingDoc.approvalStatus !== 'Rejected') {
    return res.status(403).json({ error: 'Cannot delete document. It is locked by compliance review.' });
  }

  try {
    const updatedDoc = await dataStore.deleteDocument(targetUserId, docId, versionNumber);
    return res.json({
      message: versionNumber && (existingDoc.versions?.length || 0) > 1
        ? `Document version #${versionNumber} deleted successfully.`
        : `Document "${updatedDoc?.name || existingDoc.name}" has been deleted.`,
      document: updatedDoc
    });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete document.' });
  }
});

// ======================== GOOGLE DRIVE ROUTES ========================

// 1. Google Drive service health / status
app.get('/api/drive/status', (req, res) => {
  return res.json(driveService.getDriveStatus());
});

// 2. Direct API Integration: List all files in Google Drive folder
app.get(['/api/drive/files', '/api/drive/documents'], async (req, res) => {
  try {
    const folderId = req.query.folderId;
    const result = await driveService.listFiles(folderId);
    return res.json(result);
  } catch (err) {
    console.error('[API] Error listing drive files:', err);
    return res.status(500).json({ error: 'Failed to list Google Drive files: ' + err.message });
  }
});

// 3. Sync files from Google Drive folder directly into backend checklist
app.post('/api/drive/sync', authenticateToken, async (req, res) => {
  try {
    const targetUserId = (req.user.role === 'admin' && req.body.userId) 
      ? req.body.userId 
      : req.user.id;

    const driveList = await driveService.listFiles();
    const syncResult = dataStore.syncGoogleDriveFiles(targetUserId, driveList.files || []);

    return res.json({
      message: `Google Drive sync complete. ${syncResult.syncedCount} new document(s) imported into checklist.`,
      syncedCount: syncResult.syncedCount,
      totalDriveFiles: driveList.count || (driveList.files ? driveList.files.length : 0),
      folderUrl: driveList.folderUrl,
      documents: syncResult.documents
    });
  } catch (err) {
    console.error('[API] Error syncing Google Drive files:', err);
    return res.status(500).json({ error: 'Failed to sync with Google Drive: ' + err.message });
  }
});

// 4. Ensure & Synchronize All User Folders on Google Drive
app.post('/api/drive/sync-folders', authenticateToken, async (req, res) => {
  try {
    await dataStore.loadFromMysql();
    const count = await ensureAllUserFolders();
    const students = (dataStore.data.users || [])
      .filter(u => u.role !== 'admin')
      .map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        studentCode: u.studentCode,
        driveFolderId: u.driveFolderId,
        driveFolderName: u.driveFolderName,
        folderUrl: u.driveFolderId ? `https://drive.google.com/drive/folders/${u.driveFolderId}` : null
      }));

    return res.json({
      message: `Verified and synchronized Google Drive folders for ${students.length} student(s).`,
      count,
      students
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to sync student folders: ' + err.message });
  }
});

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getResolvedMimeType(fileName, existingMimeType) {
  const ext = path.extname(fileName || '').toLowerCase();
  const MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword'
  };
  if (MIME_BY_EXT[ext]) {
    return MIME_BY_EXT[ext];
  }
  return existingMimeType || 'application/octet-stream';
}

function renderDocumentPage(originalName, docHtml, downloadUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(originalName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F5F3EF;
      color: #1C1917;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .doc-topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #FFFFFF;
      padding: 14px 28px;
      border-bottom: 1px solid #E5DED3;
      box-shadow: 0 2px 10px rgba(0,0,0,0.03);
    }
    .doc-info {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
    }
    .doc-icon {
      width: 34px;
      height: 34px;
      background: #FFF7ED;
      color: #EA580C;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .doc-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1C1917;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 480px;
    }
    .doc-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-shrink: 0;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-primary {
      background: #EA580C;
      color: #FFFFFF;
      border: 1px solid #EA580C;
    }
    .btn-primary:hover {
      background: #C2410C;
    }
    .btn-secondary {
      background: #FAF7F2;
      color: #44403C;
      border: 1px solid #E5DED3;
    }
    .btn-secondary:hover {
      background: #F5EFEB;
    }
    .doc-container {
      max-width: 860px;
      margin: 36px auto;
      padding: 0 20px;
      width: 100%;
    }
    .doc-paper {
      background: #FFFFFF;
      border: 1px solid #E5DED3;
      border-radius: 8px;
      padding: 56px 64px;
      box-shadow: 0 10px 30px -4px rgba(40, 20, 10, 0.05);
      line-height: 1.7;
      font-size: 1.02rem;
      color: #292524;
    }
    .doc-paper h1, .doc-paper h2, .doc-paper h3, .doc-paper h4 {
      color: #1C1917;
      margin-top: 1.6em;
      margin-bottom: 0.6em;
      font-weight: 700;
      line-height: 1.3;
    }
    .doc-paper h1 { font-size: 1.8rem; border-bottom: 2px solid #F5EFEB; padding-bottom: 10px; margin-top: 0; }
    .doc-paper h2 { font-size: 1.45rem; }
    .doc-paper h3 { font-size: 1.2rem; }
    .doc-paper p { margin-bottom: 1.1em; }
    .doc-paper ul, .doc-paper ol { margin: 1em 0 1.2em 1.8em; }
    .doc-paper li { margin-bottom: 0.45em; }
    .doc-paper table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.6em 0;
    }
    .doc-paper table td, .doc-paper table th {
      border: 1px solid #E5DED3;
      padding: 10px 14px;
      font-size: 0.92rem;
    }
    .doc-paper table th {
      background: #FAF7F2;
      font-weight: 600;
      text-align: left;
    }
    @media print {
      .doc-topbar { display: none; }
      body { background: #FFFFFF; }
      .doc-container { margin: 0; max-width: 100%; padding: 0; }
      .doc-paper { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <header class="doc-topbar">
    <div class="doc-info">
      <div class="doc-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
      <span class="doc-title">${escapeHtml(originalName)}</span>
    </div>
    <div class="doc-actions">
      <a class="btn btn-primary" href="${downloadUrl}" download>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download
      </a>
    </div>
  </header>
  <main class="doc-container">
    <article class="doc-paper">
      ${docHtml || '<p style="color:#78716c;font-style:italic;">(This document has no readable text content)</p>'}
    </article>
  </main>
</body>
</html>`;
}

// Serve drive file preview / view - redirects directly to Google Drive for cloud files
app.get('/api/drive/files/:id/view', async (req, res) => {
  const fileId = req.params.id;

  // 1. If it's a Google Drive cloud file, redirect directly to Google Drive
  if (!fileId.startsWith('gdrive_') && !fileId.startsWith('local_')) {
    return res.redirect(`https://drive.google.com/file/d/${fileId}/view`);
  }

  // 1b. If live Google Drive is configured and ID is a cloud file
  if (driveService.isLiveDriveConfigured() && !fileId.startsWith('gdrive_') && !fileId.startsWith('local_')) {
    try {
      const meta = await driveService.getFileMetadata(fileId);
      const stream = await driveService.getFileStream(fileId);
      if (meta && stream) {
        const ext = path.extname(meta.name || '').toLowerCase();
        const isDocx = ext === '.docx' || ext === '.doc' || (meta.mimeType && meta.mimeType.includes('wordprocessingml'));

        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const fileBuffer = Buffer.concat(chunks);

        if (isDocx) {
          try {
            const mammoth = require('mammoth');
            const conversionResult = await mammoth.convertToHtml({ buffer: fileBuffer });
            const docHtml = conversionResult.value;
            const downloadUrl = `/api/drive/files/${fileId}/download`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(renderDocumentPage(meta.name, docHtml, downloadUrl));
          } catch (mErr) {
            console.warn('[Mammoth Render Notice]:', mErr.message);
          }
        }

        // For PDF, images, etc.
        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name || 'document')}"`);
        return res.send(fileBuffer);
      }
    } catch (err) {
      console.warn('[Google Drive] Streaming failed:', err.message);
    }
  }

  // 2. Otherwise local / emulated drive storage
  const uploadsDir = path.join(__dirname, 'uploads');

  // Search in database for savedFileName matching fileId
  let foundSavedFileName = null;
  let mimeType = 'application/octet-stream';
  let originalName = 'document';

  for (const user of dataStore.data.users) {
    for (const doc of user.documents) {
      if (doc.driveFileId === fileId) {
        foundSavedFileName = doc.savedFileName;
        mimeType = doc.mimeType || mimeType;
        originalName = doc.fileName || originalName;
        break;
      }
      if (doc.versions) {
        const match = doc.versions.find(v => v.driveFileId === fileId);
        if (match) {
          foundSavedFileName = match.savedFileName;
          mimeType = match.mimeType || mimeType;
          originalName = match.fileName || originalName;
          break;
        }
      }
    }
    if (foundSavedFileName) break;
  }

  if (!foundSavedFileName && fs.existsSync(uploadsDir)) {
    // If not found by ID, look for file on disk that contains fileId
    const files = fs.readdirSync(uploadsDir);
    const match = files.find(f => f.includes(fileId));
    if (match) foundSavedFileName = match;
  }

  if (!foundSavedFileName) {
    return res.status(404).send('Document file not found in storage.');
  }

  const filePath = path.join(uploadsDir, foundSavedFileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File missing from disk.');
  }

  const ext = path.extname(originalName || foundSavedFileName || '').toLowerCase();

  // If docx, render HTML document view
  if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = require('mammoth');
      const conversionResult = await mammoth.convertToHtml({ path: filePath });
      const docHtml = conversionResult.value;
      const downloadUrl = `/api/drive/files/${fileId}/download`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderDocumentPage(originalName, docHtml, downloadUrl, null));
    } catch (docxErr) {
      console.warn('[Docx Preview] Conversion failed, fallback to standard stream:', docxErr.message);
    }
  }

  const resolvedMime = getResolvedMimeType(originalName, mimeType);
  res.setHeader('Content-Type', resolvedMime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
  fs.createReadStream(filePath).pipe(res);
});

// Download drive file
app.get('/api/drive/files/:id/download', async (req, res) => {
  const fileId = req.params.id;

  // 1. If live Google Drive is configured and ID is a cloud file
  if (driveService.isLiveDriveConfigured() && !fileId.startsWith('gdrive_')) {
    try {
      const meta = await driveService.getFileMetadata(fileId);
      const stream = await driveService.getFileStream(fileId);
      if (meta && stream) {
        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name || 'document')}"`);
        return stream.pipe(res);
      }
    } catch (err) {
      console.warn('[Google Drive] Download streaming failed, redirecting:', err.message);
      return res.redirect(`https://drive.google.com/uc?id=${fileId}&export=download`);
    }
  }

  // 2. Otherwise local / emulated drive storage
  const uploadsDir = path.join(__dirname, 'uploads');

  let foundSavedFileName = null;
  let originalName = 'downloaded_document';

  for (const user of dataStore.data.users) {
    for (const doc of user.documents) {
      if (doc.driveFileId === fileId) {
        foundSavedFileName = doc.savedFileName;
        originalName = doc.fileName || originalName;
        break;
      }
      if (doc.versions) {
        const match = doc.versions.find(v => v.driveFileId === fileId);
        if (match) {
          foundSavedFileName = match.savedFileName;
          originalName = match.fileName || originalName;
          break;
        }
      }
    }
    if (foundSavedFileName) break;
  }

  if (!foundSavedFileName && fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    const match = files.find(f => f.includes(fileId));
    if (match) foundSavedFileName = match;
  }

  if (!foundSavedFileName) {
    return res.status(404).send('File not found');
  }

  const filePath = path.join(uploadsDir, foundSavedFileName);
  res.download(filePath, originalName);
});

// Root welcome endpoint
app.get('/api', (req, res) => {
  res.json({
    title: 'Document Checklist API with Google Drive & MySQL Storage',
    version: '1.0.0',
    status: 'online',
    driveStatus: driveService.getDriveStatus(),
    mysqlStatus: {
      connected: db.isDbConnected(),
      database: process.env.DB_NAME || 'doc_checklist',
      host: process.env.DB_HOST || 'localhost'
    }
  });
});

function listenOnPort(port, retries = 3) {
  const server = app.listen(port, () => {
    console.log(`=======================================================`);
    console.log(`Document Checklist API running on http://localhost:${port}`);
    console.log(`Mode: Google Drive Integration Enabled`);
    console.log(`Database: MySQL (doc_checklist) Connected`);
    console.log(`Default User Account:  john.doe@example.com / password123`);
    console.log(`Default Admin Account: admin@example.com / adminpassword`);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port ${port} in use] Automatically clearing zombie process on port ${port}...`);
      try {
        const { execSync } = require('child_process');
        if (process.platform === 'win32') {
          const stdout = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
          });
          const pids = new Set();
          stdout.trim().split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parseInt(parts[parts.length - 1], 10);
              if (pid && pid !== process.pid) pids.add(pid);
            }
          });
          pids.forEach(pid => {
            try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
          });
        }
      } catch (_) {}

      if (retries > 0) {
        setTimeout(() => {
          listenOnPort(port, retries - 1);
        }, 1200);
      } else {
        console.error(`[Error] Port ${port} could not be freed.`);
        process.exit(1);
      }
    } else {
      console.error('[Server Error]:', err);
    }
  });
}

async function startServer() {
  try {
    await db.initDatabase();
    await dataStore.loadFromMysql();
    // Auto-create/verify Google Drive folders for all users in the database
    console.log('[Google Drive] Verifying student folders on startup...');
    await ensureAllUserFolders();
  } catch (err) {
    console.warn('[MySQL Warning]:', err.message);
  }

  listenOnPort(PORT);
}

startServer();
