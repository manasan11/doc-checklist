const path = require('path');
const fs = require('fs');
const driveService = require('../../services/drive/drive.service');
const dataStore = require('../../dataStore');
const { renderDocumentPage } = require('../../services/viewer/viewer.template');
const { convertDocxBufferToHtml, convertDocxFileToHtml } = require('../../services/viewer/docx.service');
const { getMimeTypeByExtension } = require('../../common/utils/file.util');
const { ensureUserDriveFolder } = require('../documents/document.service');

const uploadsDir = path.resolve(__dirname, '../../uploads');

function getStatus(req, res) {
  return res.json(driveService.getDriveStatus());
}

async function listFiles(req, res) {
  try {
    const folderId = req.query.folderId;
    const result = await driveService.listFiles(folderId);
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
    console.error('[DriveController] syncFiles error:', err);
    return res.status(500).json({ error: 'Failed to sync with Google Drive: ' + err.message });
  }
}

async function syncFolders(req, res) {
  try {
    const users = dataStore.data.users || [];
    let count = 0;
    for (const u of users) {
      if (u.role === 'admin') continue;
      try {
        await ensureUserDriveFolder(u);
        count++;
      } catch (e) {
        console.warn(`[Google Drive] Could not verify folder for ${u.name}:`, e.message);
      }
    }

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

  if (!foundSavedFileName && fs.existsSync(uploadsDir)) {
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
}

module.exports = {
  getStatus,
  listFiles,
  syncFiles,
  syncFolders,
  viewFile,
  downloadFile
};
