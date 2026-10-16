require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const dataStore = require('./dataStore');
const driveService = require('./driveService');

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

  if (!token) {
    req.user = { id: 'u-1', email: 'john.doe@example.com', name: 'Johnathan Doe', role: 'user' };
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = { id: 'u-1', email: 'john.doe@example.com', name: 'Johnathan Doe', role: 'user' };
      return next();
    }
    req.user = decoded;
    next();
  });
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

// 1. Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const result = dataStore.authenticateOrProvisionUser(username, password);
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

// 2. Forgot Password Request
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  const user = dataStore.findUserByEmailOrUsername(email);
  if (!user) {
    // Return standard friendly response even if not found for security, but for our demo provide clear feedback
    return res.status(404).json({ error: 'No account registered with this email or username' });
  }

  const resetToken = dataStore.createResetToken(user.email);
  return res.json({
    message: 'Password reset link has been generated successfully.',
    resetToken,
    instructions: `In a production setup, an email with a reset link is dispatched. For this application, you can immediately use this token: ${resetToken}`
  });
});

// 3. Password Reset
app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const result = dataStore.verifyAndResetPassword(token, newPassword);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }

  return res.json({
    message: 'Password has been successfully updated. You may now log in with your new password.'
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

// Get Document Checklist (all 10 documents with permissions calculated)
app.get('/api/documents', authenticateToken, (req, res) => {
  const targetUserId = (req.user.role === 'admin' && req.query.userId) 
    ? req.query.userId 
    : req.user.id;

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

// Get Single Document with full version history
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

// Upload or Re-upload Document
app.post('/api/documents/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.user.id;
  const userNotes = req.body.notes || '';

  if (!req.file) {
    return res.status(400).json({ error: 'Please choose a document file to upload.' });
  }

  const existingDoc = dataStore.getDocumentById(targetUserId, docId);
  if (!existingDoc) {
    return res.status(404).json({ error: 'Document item not found' });
  }

  // Permission Verification
  if (!existingDoc.permissions.canUpload) {
    return res.status(403).json({
      error: 'Upload not permitted. This document is currently locked or approved.',
      permissions: existingDoc.permissions
    });
  }

  try {
    // 1. Upload to Google Drive (or Emulated Drive with Drive File ID)
    const driveResult = await driveService.uploadFile({
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
      size: req.file.size
    });

    // 2. Update Document record in DataStore
    const updatedDoc = dataStore.saveDocumentUpload(targetUserId, docId, driveResult, userNotes);

    return res.json({
      message: `Document "${updatedDoc.name}" uploaded successfully (Version ${updatedDoc.currentVersion})`,
      document: updatedDoc
    });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({ error: 'Failed to process document upload: ' + err.message });
  }
});


// Delete Document or Version
app.delete('/api/documents/:id', authenticateToken, async (req, res) => {
  const docId = parseInt(req.params.id, 10);
  const targetUserId = req.user.id;
  const versionNumber = req.query.version ? parseInt(req.query.version, 10) : undefined;

  const existingDoc = dataStore.getDocumentById(targetUserId, docId);
  if (!existingDoc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  if (!existingDoc.permissions.canDelete) {
    return res.status(403).json({ error: 'Cannot delete document. It is currently locked.' });
  }

  try {
    const updatedDoc = dataStore.deleteDocument(targetUserId, docId, versionNumber);
    return res.json({
      message: versionNumber && (existingDoc.versions?.length || 0) > 1
        ? `Document version #${versionNumber} deleted successfully.`
        : `Document "${updatedDoc.name}" has been deleted and reset to Upload Pending.`,
      document: updatedDoc
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Google Drive service health / status
app.get('/api/drive/status', (req, res) => {
  return res.json(driveService.getDriveStatus());
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

// Serve drive file preview / view
app.get('/api/drive/files/:id/view', async (req, res) => {
  const fileId = req.params.id;

  // 1. If live Google Drive is configured and ID is a cloud file
  if (driveService.isLiveDriveConfigured() && !fileId.startsWith('gdrive_')) {
    try {
      const meta = await driveService.getFileMetadata(fileId);
      const stream = await driveService.getFileStream(fileId);
      if (meta && stream) {
        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name || 'document')}"`);
        return stream.pipe(res);
      }
    } catch (err) {
      console.warn('[Google Drive] Streaming failed, redirecting to webViewLink:', err.message);
      return res.redirect(`https://drive.google.com/file/d/${fileId}/view`);
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

      const pageHtml = `<!DOCTYPE html>
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
    }
    .doc-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1C1917;
    }
    .doc-actions {
      display: flex;
      gap: 10px;
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
      <button class="btn btn-secondary" onclick="window.print()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
        Print
      </button>
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
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(pageHtml);
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
    title: 'Document Checklist API with Google Drive Storage',
    version: '1.0.0',
    status: 'online',
    driveStatus: driveService.getDriveStatus()
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`Document Checklist API running on http://localhost:${PORT}`);
  console.log(`Mode: Google Drive Integration Enabled`);
  console.log(`Default User Account:  john.doe@example.com / password123`);
  console.log(`Default Admin Account: admin@example.com / adminpassword`);
  console.log(`=======================================================`);
});
