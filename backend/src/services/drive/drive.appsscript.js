const driveConfig = require('../../config/drive.config');

class AppsScriptClient {
  constructor() {
    this.appsScriptUrl = driveConfig.appsScriptUrl;
  }

  isConfigured() {
    return Boolean(this.appsScriptUrl);
  }

  async createStudentFolder(folderName, parentFolderId) {
    if (!this.appsScriptUrl) return null;
    try {
      const payload = {
        action: 'create_student_folder',
        folderName,
        studentFolderName: folderName,
        parentFolderId,
        folderId: parentFolderId
      };
      const res = await fetch(this.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (data && data.success && (data.folderId || data.id)) {
        const folderId = data.folderId || data.id;
        return {
          folderId,
          folderName: data.folderName || folderName,
          folderUrl: data.folderUrl || `https://drive.google.com/drive/folders/${folderId}`
        };
      }
    } catch (err) {
      console.warn('[AppsScript] Folder creation warning:', err.message);
    }
    return null;
  }

  async uploadFile({ originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName }) {
    if (!this.appsScriptUrl) return null;

    // Files > 10 MB stream directly to Drive API to avoid Apps Script payload constraints
    if (buffer && buffer.length > 10 * 1024 * 1024) {
      console.log(`[AppsScript] File "${targetFileName || originalname}" is > 10MB. Streaming via direct Drive API.`);
      return null;
    }

    try {
      const base64 = buffer.toString('base64');
      let targetFolderId = folderId;
      if (!targetFolderId || targetFolderId.startsWith('gdrive_') || targetFolderId.startsWith('local_')) {
        targetFolderId = driveConfig.folderId;
      }

      const finalFileName = targetFileName || originalname;
      const payload = {
        fileName: finalFileName,
        mimeType: mimetype,
        base64,
        folderId: targetFolderId,
        studentFolderName
      };

      const res = await fetch(this.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(18000)
      });

      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (data && (data.fileId || data.id)) {
        const fileId = data.fileId || data.id;
        const actualFolderId = data.folderId || data.studentFolderId || targetFolderId;
        console.log(`[Google Drive via Apps Script] Uploaded into folder ${actualFolderId}: ID=${fileId} ("${finalFileName}")`);
        return {
          driveFileId: fileId,
          fileName: finalFileName,
          mimeType: mimetype,
          fileSize: Number(data.size) || size,
          folderId: actualFolderId,
          studentFolderName,
          webViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          driveWebViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          downloadUrl: `/api/drive/files/${fileId}/download`,
          storageType: 'google_drive_cloud',
          uploadedAt: new Date().toISOString()
        };
      }
    } catch (err) {
      console.error('[AppsScript] Upload error:', err.message);
    }
    return null;
  }
}

module.exports = new AppsScriptClient();

