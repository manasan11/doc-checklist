const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const driveConfig = require('../../config/drive.config');
const driveClient = require('./drive.client');
const appsScriptClient = require('./drive.appsscript');

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

    // 1. Try Apps Script Web App
    if (appsScriptClient.isConfigured()) {
      const scriptResult = await appsScriptClient.createStudentFolder(folderName, parentId);
      if (scriptResult) {
        this.folderCache.set(folderName, scriptResult);
        this.verifiedFoldersSet.add(scriptResult.folderId);
        return scriptResult;
      }
    }

    // 2. Direct Google Drive API
    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const escapedName = folderName.replace(/'/g, "\\'");
        const query = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const listRes = await client.files.list({
          q: query,
          fields: 'files(id, name, webViewLink)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        if (listRes.data.files && listRes.data.files.length > 0) {
          const existing = listRes.data.files[0];
          console.log(`[Google Drive API] Reusing existing folder "${folderName}": ID=${existing.id}`);
          client.permissions.create({
            fileId: existing.id,
            supportsAllDrives: true,
            requestBody: { role: 'writer', type: 'anyone' }
          }).catch(() => {});

          const result = {
            folderId: existing.id,
            folderName: existing.name,
            folderUrl: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`
          };
          this.folderCache.set(folderName, result);
          this.verifiedFoldersSet.add(existing.id);
          return result;
        }

        const createRes = await client.files.create({
          supportsAllDrives: true,
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          },
          fields: 'id, name, webViewLink'
        });

        client.permissions.create({
          fileId: createRes.data.id,
          supportsAllDrives: true,
          requestBody: { role: 'writer', type: 'anyone' }
        }).catch(() => {});

        console.log(`[Google Drive API] Dynamically created student folder "${folderName}": ID=${createRes.data.id}`);
        const result = {
          folderId: createRes.data.id,
          folderName: createRes.data.name,
          folderUrl: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`
        };
        this.folderCache.set(folderName, result);
        this.verifiedFoldersSet.add(createRes.data.id);
        return result;
      } catch (apiErr) {
        console.warn('[Google Drive API] Folder creation notice:', apiErr.message);
      }
    }

    // 3. Fallback / Emulated storage
    const mockFolderId = `gdrive_folder_${folderName}_${Date.now()}`;
    const fallbackResult = {
      folderId: mockFolderId,
      folderName,
      folderUrl: `https://drive.google.com/drive/folders/${this.folderId}`
    };
    this.folderCache.set(folderName, fallbackResult);
    return fallbackResult;
  }

  async verifyFolderExists(folderId) {
    if (!folderId || folderId.startsWith('gdrive_') || folderId.startsWith('local_')) return false;
    if (this.verifiedFoldersSet.has(folderId)) return true;
    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const res = await client.files.get({
          fileId: folderId,
          fields: 'id, name, trashed, mimeType',
          supportsAllDrives: true
        });
        if (res.data && !res.data.trashed && res.data.mimeType === 'application/vnd.google-apps.folder') {
          this.verifiedFoldersSet.add(folderId);
          return true;
        }
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  async uploadFile({ originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName }) {
    let targetFolderId = folderId;
    if (!targetFolderId || targetFolderId.startsWith('gdrive_') || targetFolderId.startsWith('local_')) {
      targetFolderId = this.folderId;
    }
    const finalFileName = targetFileName || originalname;

    // 1. Try Apps Script if configured
    if (appsScriptClient.isConfigured()) {
      const scriptResult = await appsScriptClient.uploadFile({
        originalname,
        mimetype,
        buffer,
        size,
        folderId: targetFolderId,
        studentFolderName,
        targetFileName: finalFileName
      });
      if (scriptResult) {
        scriptResult.fileName = finalFileName;
        scriptResult.savedFileName = null;
        return scriptResult;
      }
    }

    // 2. Direct Google Drive API
    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const fileMetadata = {
          name: finalFileName,
          parents: targetFolderId ? [targetFolderId] : undefined,
          description: `Uploaded via Document Checklist System at ${new Date().toISOString()}`
        };

        const readableStream = new Readable();
        readableStream.push(buffer);
        readableStream.push(null);

        const media = {
          mimeType: mimetype,
          body: readableStream,
        };

        const res = await client.files.create({
          supportsAllDrives: true,
          resource: fileMetadata,
          media: media,
          fields: 'id, name, webViewLink, webContentLink, size, mimeType, createdTime',
        });

        client.permissions.create({
          fileId: res.data.id,
          supportsAllDrives: true,
          requestBody: { role: 'reader', type: 'anyone' }
        }).catch(() => {});

        console.log(`[Google Drive] File uploaded successfully to folder ${targetFolderId}: ID=${res.data.id}`);

        return {
          driveFileId: res.data.id,
          fileName: finalFileName,
          savedFileName: null,
          mimeType: res.data.mimeType || mimetype,
          fileSize: Number(res.data.size) || size,
          folderId: targetFolderId,
          studentFolderName,
          webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
          driveWebViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
          downloadUrl: `/api/drive/files/${res.data.id}/download`,
          storageType: 'google_drive_cloud',
          uploadedAt: res.data.createdTime || new Date().toISOString()
        };
      } catch (err) {
        console.error('[Google Drive] Upload notice:', err.message);
      }
    }

    // 3. Emulated Google Drive Storage fallback
    const mockDriveId = `gdrive_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    return {
      driveFileId: mockDriveId,
      fileName: finalFileName,
      savedFileName: null,
      mimeType,
      fileSize: size,
      folderId: targetFolderId,
      studentFolderName,
      webViewLink: `/api/drive/files/${mockDriveId}/view`,
      driveWebViewLink: `/api/drive/files/${mockDriveId}/view`,
      downloadUrl: `/api/drive/files/${mockDriveId}/download`,
      storageType: 'google_drive_emulated',
      uploadedAt: new Date().toISOString()
    };
  }

  async getFileStream(driveFileId) {
    if (this.isLiveDriveConfigured() && driveFileId && !driveFileId.startsWith('gdrive_')) {
      const client = driveClient.getClient();
      const response = await client.files.get(
        { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
      return response.data;
    }
    return null;
  }

  async getFileMetadata(driveFileId) {
    if (this.isLiveDriveConfigured() && driveFileId && !driveFileId.startsWith('gdrive_')) {
      const client = driveClient.getClient();
      const response = await client.files.get({
        fileId: driveFileId,
        fields: 'id, name, mimeType, size, webViewLink, webContentLink, createdTime, parents',
        supportsAllDrives: true
      });
      return response.data;
    }
    return null;
  }

  async deleteFile(driveFileId, savedFileName) {
    if (this.isLiveDriveConfigured() && driveFileId && !driveFileId.startsWith('gdrive_')) {
      try {
        const client = driveClient.getClient();
        await client.files.delete({ fileId: driveFileId, supportsAllDrives: true });
        return { success: true };
      } catch (err) {
        console.warn('[Google Drive] Notice deleting cloud file:', err.message);
      }
    }

    if (savedFileName) {
      const localFilePath = path.join(driveConfig.uploadsDir, savedFileName);
      if (fs.existsSync(localFilePath)) {
        try { fs.unlinkSync(localFilePath); } catch (_) {}
      }
    }
    return { success: true };
  }

  async listFiles(targetFolderId) {
    const folderId = targetFolderId || this.folderId;

    if (this.isLiveDriveConfigured()) {
      try {
        const client = driveClient.getClient();
        const query = folderId 
          ? `'${folderId}' in parents and trashed = false`
          : 'trashed = false';

        const res = await client.files.list({
          q: query,
          fields: 'files(id, name, mimeType, size, webViewLink, webContentLink, createdTime, modifiedTime, thumbnailLink, iconLink)',
          orderBy: 'modifiedTime desc',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 100
        });

        const files = (res.data.files || []).map(f => ({
          driveFileId: f.id,
          fileName: f.name,
          mimeType: f.mimeType,
          fileSize: Number(f.size) || 0,
          createdTime: f.createdTime,
          modifiedTime: f.modifiedTime,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          driveWebViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          downloadUrl: `/api/drive/files/${f.id}/download`,
          cloudDownloadUrl: f.webContentLink || `https://drive.google.com/uc?id=${f.id}&export=download`,
          thumbnailLink: f.thumbnailLink || null,
          iconLink: f.iconLink || null,
          storageType: 'google_drive_cloud'
        }));

        return {
          source: 'google_drive_cloud',
          folderId,
          folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
          count: files.length,
          files
        };
      } catch (err) {
        console.error('[Google Drive] listFiles error:', err.message);
      }
    }

    const files = [];
    if (fs.existsSync(driveConfig.uploadsDir)) {
      const dirFiles = fs.readdirSync(driveConfig.uploadsDir);
      for (const fileName of dirFiles) {
        if (fileName === '.gitkeep') continue;
        const filePath = path.join(driveConfig.uploadsDir, fileName);
        const stats = fs.statSync(filePath);
        const parts = fileName.split('_');
        const originalName = parts.length > 1 ? parts.slice(1).join('_') : fileName;
        files.push({
          driveFileId: `local_${fileName}`,
          fileName: originalName,
          savedFileName: fileName,
          fileSize: stats.size,
          createdTime: stats.birthtime.toISOString(),
          modifiedTime: stats.mtime.toISOString(),
          webViewLink: `/api/drive/files/local_${fileName}/view`,
          downloadUrl: `/api/drive/files/local_${fileName}/download`,
          storageType: 'google_drive_emulated'
        });
      }
    }

    return {
      source: 'google_drive_emulated',
      folderId: folderId || null,
      folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
      count: files.length,
      files
    };
  }
}

module.exports = new DriveService();
