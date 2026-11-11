const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const driveConfig = require('../config/drive.config');

// 1. Apps Script Client
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

// 2. Drive Client (OAuth2 & Service Account)
class DriveClient {
  constructor() {
    this.driveClient = null;
    this.authMode = 'none';
    this.oauth2Client = null;
    this.init();
  }

  init() {
    try {
      if (driveConfig.clientId && driveConfig.clientSecret && driveConfig.refreshToken) {
        this.oauth2Client = new google.auth.OAuth2(
          driveConfig.clientId,
          driveConfig.clientSecret,
          driveConfig.redirectUri
        );
        this.oauth2Client.setCredentials({ refresh_token: driveConfig.refreshToken });
        this.driveClient = google.drive({ version: 'v3', auth: this.oauth2Client });
        this.authMode = 'oauth2';
        console.log('[Google Drive] Authenticated successfully via OAuth 2.0 User Token.');
        return;
      }

      if (driveConfig.keyFilePath && fs.existsSync(driveConfig.keyFilePath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: driveConfig.keyFilePath,
          scopes: ['https://www.googleapis.com/auth/drive']
        });
        this.driveClient = google.drive({ version: 'v3', auth });
        this.authMode = 'service_account';
        console.log('[Google Drive] Authenticated successfully via Service Account key file:', driveConfig.keyFilePath);
        return;
      }

      if (driveConfig.clientEmail && driveConfig.privateKey) {
        const auth = new google.auth.JWT({
          email: driveConfig.clientEmail,
          key: driveConfig.privateKey,
          scopes: ['https://www.googleapis.com/auth/drive']
        });
        this.driveClient = google.drive({ version: 'v3', auth });
        this.authMode = 'service_account';
        console.log('[Google Drive] Authenticated successfully via environment Service Account credentials.');
        return;
      }

      this.driveClient = null;
      this.authMode = 'none';
    } catch (err) {
      console.warn('[Google Drive] Initialization notice:', err.message);
      this.driveClient = null;
      this.authMode = 'none';
    }
  }

  getClient() {
    return this.driveClient;
  }

  getAuthMode() {
    return this.authMode;
  }

  isConfigured() {
    return this.driveClient !== null;
  }
}

const driveClient = new DriveClient();
const appsScriptClient = new AppsScriptClient();

// 3. Central Google Drive Service
class DriveService {
  constructor() {
    this.folderId = driveConfig.folderId;
    this.folderCache = new Map();
    this.verifiedFoldersSet = new Set();
  }

  isLiveDriveConfigured() {
    return driveClient.isConfigured();
  }

  getDriveStatus() {
    const isLive = this.isLiveDriveConfigured() || appsScriptClient.isConfigured();
    return {
      mode: isLive ? 'live_google_drive' : 'emulated_google_drive',
      configured: isLive,
      authMode: appsScriptClient.isConfigured() ? 'apps_script' : driveClient.getAuthMode(),
      folderId: this.folderId,
      folderUrl: `https://drive.google.com/drive/folders/${this.folderId}`,
      hasServiceAccount: Boolean(driveConfig.keyFilePath || driveConfig.clientEmail),
      hasOAuth: Boolean(driveConfig.refreshToken),
      hasAppsScript: appsScriptClient.isConfigured(),
      message: appsScriptClient.isConfigured()
        ? 'Connected to Google Drive via Apps Script Web App (Personal Drive storage enabled).'
        : (isLive 
            ? (driveClient.getAuthMode() === 'oauth2'
                ? 'Connected via OAuth 2.0 User Token (Live upload directly into Google Drive folder enabled).'
                : 'Connected via Google Service Account (Notice: Service Accounts have 0MB quota on personal @gmail.com folders).')
            : 'Running in Emulated Drive Mode (stored locally with Drive IDs). Connect Google Drive to sync directly.')
    };
  }

  async getOrCreateStudentFolder(folderName, parentFolderId = null) {
    if (this.folderCache.has(folderName)) {
      return this.folderCache.get(folderName);
    }
    const parentId = parentFolderId || this.folderId;

    if (appsScriptClient.isConfigured()) {
      const scriptResult = await appsScriptClient.createStudentFolder(folderName, parentId);
      if (scriptResult) {
        this.folderCache.set(folderName, scriptResult);
        this.verifiedFoldersSet.add(scriptResult.folderId);
        return scriptResult;
      }
    }

    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const escapedName = folderName.replace(/'/g, "\\'");
        const query = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

        const res = await client.files.list({
          q: query,
          fields: 'files(id, name, webViewLink)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        if (res.data.files && res.data.files.length > 0) {
          const folder = res.data.files[0];
          const result = {
            folderId: folder.id,
            folderName: folder.name,
            folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`
          };
          this.folderCache.set(folderName, result);
          this.verifiedFoldersSet.add(folder.id);
          return result;
        }

        const createRes = await client.files.create({
          resource: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          },
          fields: 'id, name, webViewLink',
          supportsAllDrives: true
        });

        const created = createRes.data;
        const result = {
          folderId: created.id,
          folderName: created.name,
          folderUrl: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`
        };
        this.folderCache.set(folderName, result);
        this.verifiedFoldersSet.add(created.id);
        return result;
      } catch (err) {
        console.warn(`[Google Drive] Direct API folder creation error for "${folderName}":`, err.message);
      }
    }

    const fallbackId = `gdrive_folder_${folderName.replace(/\W+/g, '_')}`;
    const fallback = {
      folderId: fallbackId,
      folderName,
      folderUrl: `https://drive.google.com/drive/folders/${fallbackId}`
    };
    this.folderCache.set(folderName, fallback);
    return fallback;
  }

  async uploadFile(fileOrOpts, studentFolderNameArg, targetFileNameArg, userNotesArg, folderIdArg) {
    let originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName;
    if (fileOrOpts && (fileOrOpts.buffer || fileOrOpts.originalname)) {
      originalname = fileOrOpts.originalname;
      mimetype = fileOrOpts.mimetype;
      buffer = fileOrOpts.buffer;
      size = fileOrOpts.size;
      studentFolderName = studentFolderNameArg || fileOrOpts.studentFolderName;
      targetFileName = targetFileNameArg || fileOrOpts.targetFileName || originalname;
      folderId = folderIdArg || fileOrOpts.folderId;
    } else {
      ({ originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName } = fileOrOpts || {});
    }
    const finalFileName = targetFileName || originalname;

    if (appsScriptClient.isConfigured()) {
      const scriptResult = await appsScriptClient.uploadFile({
        originalname,
        mimetype,
        buffer,
        size,
        folderId,
        studentFolderName,
        targetFileName: finalFileName
      });
      if (scriptResult) return scriptResult;
    }

    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        let targetFolderId = folderId;
        if (!targetFolderId || targetFolderId.startsWith('gdrive_') || targetFolderId.startsWith('local_')) {
          targetFolderId = this.folderId;
        }

        const readableStream = new Readable();
        readableStream.push(buffer);
        readableStream.push(null);

        const media = {
          mimeType: mimetype,
          body: readableStream
        };

        const res = await client.files.create({
          resource: {
            name: finalFileName,
            parents: [targetFolderId]
          },
          media,
          fields: 'id, name, size, webViewLink, webContentLink, mimeType',
          supportsAllDrives: true
        });

        const file = res.data;
        console.log(`[Google Drive Direct API] Uploaded to folder ${targetFolderId}: ID=${file.id} ("${file.name}")`);

        try {
          await client.permissions.create({
            fileId: file.id,
            resource: { role: 'reader', type: 'anyone' },
            supportsAllDrives: true
          });
        } catch (_) {}

        return {
          driveFileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType || mimetype,
          fileSize: Number(file.size) || size,
          folderId: targetFolderId,
          studentFolderName,
          webViewLink: file.webViewLink,
          driveWebViewLink: file.webViewLink,
          downloadUrl: `/api/drive/files/${file.id}/download`,
          storageType: 'google_drive_cloud',
          uploadedAt: new Date().toISOString()
        };
      } catch (err) {
        console.error('[Google Drive] Direct API upload error:', err.message);
      }
    }

    // Local disk fallback
    const uploadsDir = driveConfig.uploadsDir;
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const localId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const savedFileName = `${localId}_${finalFileName}`;
    fs.writeFileSync(path.join(uploadsDir, savedFileName), buffer);

    return {
      driveFileId: localId,
      fileName: finalFileName,
      savedFileName,
      mimeType: mimetype,
      fileSize: size,
      folderId: folderId || 'local_folder',
      studentFolderName,
      webViewLink: `/api/drive/files/${localId}/view`,
      driveWebViewLink: `/api/drive/files/${localId}/view`,
      downloadUrl: `/api/drive/files/${localId}/download`,
      storageType: 'local_fallback',
      uploadedAt: new Date().toISOString()
    };
  }

  async listFiles(folderId = null) {
    const targetFolder = folderId || this.folderId;
    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const res = await client.files.list({
          q: `'${targetFolder}' in parents and trashed = false`,
          fields: 'files(id, name, size, mimeType, webViewLink, webContentLink, createdTime)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        const files = (res.data.files || []).map(f => ({
          driveFileId: f.id,
          fileName: f.name,
          fileSize: Number(f.size) || 0,
          mimeType: f.mimeType,
          createdTime: f.createdTime,
          webViewLink: f.webViewLink,
          driveWebViewLink: f.webViewLink,
          downloadUrl: `/api/drive/files/${f.id}/download`,
          storageType: 'google_drive_cloud'
        }));

        return {
          source: 'google_drive_cloud',
          folderId: targetFolder,
          totalFiles: files.length,
          files
        };
      } catch (err) {
        console.warn('[Google Drive] List files error:', err.message);
      }
    }

    return {
      source: 'emulated',
      folderId: targetFolder,
      totalFiles: 0,
      files: []
    };
  }

  async getFileMetadata(fileId) {
    if (this.isLiveDriveConfigured() && !fileId.startsWith('local_') && !fileId.startsWith('gdrive_')) {
      try {
        const client = driveClient.getClient();
        const res = await client.files.get({
          fileId,
          fields: 'id, name, size, mimeType, webViewLink',
          supportsAllDrives: true
        });
        return res.data;
      } catch (err) {
        console.warn(`[Google Drive] Metadata error for ${fileId}:`, err.message);
      }
    }
    return null;
  }

  async getFileStream(fileId) {
    if (this.isLiveDriveConfigured() && !fileId.startsWith('local_') && !fileId.startsWith('gdrive_')) {
      try {
        const client = driveClient.getClient();
        const res = await client.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream' }
        );
        return res.data;
      } catch (err) {
        console.warn(`[Google Drive] Download stream error for ${fileId}:`, err.message);
      }
    }
    return null;
  }

  async deleteFile(fileId) {
    if (!fileId) return false;
    if (this.isLiveDriveConfigured() && !fileId.startsWith('local_') && !fileId.startsWith('gdrive_')) {
      try {
        const client = driveClient.getClient();
        await client.files.delete({ fileId, supportsAllDrives: true });
        return true;
      } catch (err) {
        console.warn(`[Google Drive] Delete error for ${fileId}:`, err.message);
        return false;
      }
    }
    return false;
  }
}

module.exports = new DriveService();
