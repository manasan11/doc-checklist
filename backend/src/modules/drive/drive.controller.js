const path = require('path');
const fs = require('fs');
const driveModuleService = require('./drive.service');
const driveService = require('../../services/drive/drive.service');
const dataStore = require('../../dataStore');
const driveConfig = require('../../config/drive.config');
const { renderDocumentPage } = require('../../services/viewer/viewer.template');
const { convertDocxBufferToHtml, convertDocxFileToHtml } = require('../../services/viewer/docx.service');
const { getMimeTypeByExtension } = require('../../common/utils/file.util');

function getStatus(req, res) {
  return res.json(driveModuleService.getStatus());
}

async function listFiles(req, res) {
  try {
    const folderId = req.query.folderId;
    const result = await driveModuleService.listFiles(folderId);
    return res.json(result);
  } catch (err) {
    console.error('[DriveController] listFiles error:', err);
    return res.status(500).json({ error: 'Failed to list Google Drive files: ' + err.message });
  }
}

async function syncFiles(req, res) {
  try {
    const targetUserId = (req.user.role === 'admin' && req.body.userId) 
      ? req.body.userId 
      : req.user.id;

    const { syncResult, driveList } = await driveModuleService.syncFiles(targetUserId);

    return res.json({
      message: `Google Drive sync complete. ${syncResult.syncedCount} new document(s) imported into checklist.`,
      syncedCount: syncResult.syncedCount,
      totalDriveFiles: driveList.count || (driveList.files ? driveList.files.length : 0),
      folderUrl: driveList.folderUrl,
      documents: syncResult.documents
    });
  } catch (err) {
    console.error('[DriveController] syncFiles error:', err);
    return res.status(500).json({ error: 'Failed to sync with Google Drive: ' + err.message });
  }
}

async function syncFolders(req, res) {
  try {
    const { count, students } = await driveModuleService.syncAllStudentFolders();

    return res.json({
      message: `Verified and synchronized Google Drive folders for ${students.length} student(s).`,
      count,
      students
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to sync student folders: ' + err.message });
  }
}

async function viewFile(req, res) {
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
            const docHtml = await convertDocxBufferToHtml(fileBuffer);
            const downloadUrl = `/api/drive/files/${fileId}/download`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(renderDocumentPage(meta.name, docHtml, downloadUrl));
          } catch (mErr) {
            console.warn('[Mammoth Render Notice]:', mErr.message);
          }
        }

        res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.name || 'document')}"`);
        return res.send(fileBuffer);
      }
    } catch (err) {
      console.warn('[Google Drive] Streaming failed:', err.message);
    }
  }

  // 2. Otherwise local / emulated drive storage
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

  if (!foundSavedFileName && fs.existsSync(driveConfig.uploadsDir)) {
    const files = fs.readdirSync(driveConfig.uploadsDir);
    const match = files.find(f => f.includes(fileId));
    if (match) foundSavedFileName = match;
  }

  if (!foundSavedFileName) {
    return res.status(404).send('Document file not found in storage.');
  }

  const filePath = path.join(driveConfig.uploadsDir, foundSavedFileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File missing from disk.');
  }

  const ext = path.extname(originalName || foundSavedFileName || '').toLowerCase();

  if (ext === '.docx' || ext === '.doc') {
    try {
      const docHtml = await convertDocxFileToHtml(filePath);
      const downloadUrl = `/api/drive/files/${fileId}/download`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderDocumentPage(originalName, docHtml, downloadUrl));
    } catch (docxErr) {
      console.warn('[Docx Preview] Conversion failed, fallback to standard stream:', docxErr.message);
    }
  }

  const resolvedMime = getMimeTypeByExtension(ext) || mimeType;
  res.setHeader('Content-Type', resolvedMime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
  fs.createReadStream(filePath).pipe(res);
}

async function downloadFile(req, res) {
  const fileId = req.params.id;

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

  if (!foundSavedFileName && fs.existsSync(driveConfig.uploadsDir)) {
    const files = fs.readdirSync(driveConfig.uploadsDir);
    const match = files.find(f => f.includes(fileId));
    if (match) foundSavedFileName = match;
  }

  if (!foundSavedFileName) {
    return res.status(404).send('File not found');
  }

  const filePath = path.join(driveConfig.uploadsDir, foundSavedFileName);
  res.download(filePath, originalName);
}

module.exports = {
  getStatus,
  listFiles,
  syncFiles,
  syncFolders,
  viewFile,
  downloadFile
};

