const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { google } = require('googleapis');
const { Readable } = require('stream');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

class DriveService {
  constructor() {
    this.driveClient = null;
    this.authMode = 'none'; // 'oauth2' | 'service_account' | 'none'
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk';
    this.oauth2Client = null;
    this.initClient();
  }


  initClient() {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      // 1. Check for OAuth2 credentials (Primary method for personal @gmail.com accounts with quota)
      if (clientId && clientSecret && refreshToken) {
        this.oauth2Client = new google.auth.OAuth2(
          clientId,
          clientSecret,
          process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/drive/oauth2callback'
        );
        this.oauth2Client.setCredentials({ refresh_token: refreshToken });
        this.driveClient = google.drive({ version: 'v3', auth: this.oauth2Client });
        this.authMode = 'oauth2';
        console.log('[Google Drive] Authenticated successfully via OAuth 2.0 User Token (Personal Drive Quota enabled).');
        return;
      }

      // 2. Check for Service Account Key (Method for Google Workspace Shared Drives)
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
      const privateKey = process.env.GOOGLE_PRIVATE_KEY 
        ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : null;
      const keyFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS 
        ? path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS) 
        : (fs.existsSync(path.resolve(__dirname, 'service-account.json')) 
            ? path.resolve(__dirname, 'service-account.json') 
            : null);

      if (keyFilePath && fs.existsSync(keyFilePath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: keyFilePath,
          scopes: ['https://www.googleapis.com/auth/drive'],
        });
        this.driveClient = google.drive({ version: 'v3', auth });
        this.authMode = 'service_account';
        console.log('[Google Drive] Authenticated successfully via Service Account key file:', keyFilePath);
      } else if (clientEmail && privateKey) {
        const auth = new google.auth.JWT({
          email: clientEmail,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/drive'],
        });
        this.driveClient = google.drive({ version: 'v3', auth });
        this.authMode = 'service_account';
        console.log('[Google Drive] Authenticated successfully via environment Service Account credentials.');
      } else {
        console.log('[Google Drive] No live credentials configured. Running in Emulated Google Drive Mode (Local Persistent Storage with Drive Schema).');
        this.driveClient = null;
        this.authMode = 'none';
      }
    } catch (err) {
      console.warn('[Google Drive] Initialization notice:', err.message, '- Operating in emulated Google Drive mode.');
      this.driveClient = null;
      this.authMode = 'none';
    }
  }

  isLiveDriveConfigured() {
    return this.driveClient !== null;
  }

  getDriveStatus() {
    const isLive = this.isLiveDriveConfigured() || Boolean(process.env.GOOGLE_APPS_SCRIPT_URL);
    return {
      mode: isLive ? 'live_google_drive' : 'emulated_google_drive',
      configured: isLive,
      authMode: process.env.GOOGLE_APPS_SCRIPT_URL ? 'apps_script' : this.authMode,
      folderId: this.folderId,
      folderUrl: `https://drive.google.com/drive/folders/${this.folderId}`,
      hasServiceAccount: Boolean(fs.existsSync(path.resolve(__dirname, 'service-account.json')) || process.env.GOOGLE_CLIENT_EMAIL),
      hasOAuth: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
      hasAppsScript: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL),
      message: process.env.GOOGLE_APPS_SCRIPT_URL 
        ? 'Connected to Google Drive via Apps Script Web App (Personal Drive storage enabled).'
        : (isLive 
            ? (this.authMode === 'oauth2' 
                ? 'Connected via OAuth 2.0 User Token (Live upload directly into Google Drive folder enabled).' 
                : 'Connected via Google Service Account (Notice: Service Accounts have 0MB quota on personal @gmail.com folders).')
            : 'Running in Emulated Drive Mode (stored locally with Drive IDs). Connect Google Drive to sync directly.')
    };
  }

  async getOrCreateStudentFolder(folderName, parentFolderId = null) {
    const parentId = parentFolderId || this.folderId;
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

    // 1. Try Apps Script Web App (runs as personal drive owner)
    if (appsScriptUrl) {
      try {
        const payload = {
          action: 'create_student_folder',
          folderName: folderName,
          studentFolderName: folderName,
          parentFolderId: parentId,
          folderId: parentId
        };
        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn('[Google Drive Apps Script] Non-JSON response for folder creation:', text.substring(0, 200));
        }

        if (data && data.success && (data.folderId || data.id)) {
          const folderId = data.folderId || data.id;
          console.log(`[Google Drive Apps Script] Student folder created/found: "${folderName}" ID=${folderId}`);
          return {
            folderId: folderId,
            folderName: data.folderName || folderName,
            folderUrl: data.folderUrl || `https://drive.google.com/drive/folders/${folderId}`
          };
        } else if (data && data.error) {
          console.warn('[Google Drive Apps Script] Notice:', data.error);
        }
      } catch (err) {
        console.warn('[Google Drive Apps Script] Notice:', err.message);
      }
    }

    // 2. Direct Drive API: Dynamically search or create folder in documents root and set writer permission
    if (this.isLiveDriveConfigured()) {
      try {
        const escapedName = folderName.replace(/'/g, "\\'");
        const query = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const listRes = await this.driveClient.files.list({
          q: query,
          fields: 'files(id, name, webViewLink)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });

        if (listRes.data.files && listRes.data.files.length > 0) {
          const existing = listRes.data.files[0];
          console.log(`[Google Drive API] Reusing existing folder "${folderName}": ID=${existing.id}`);
          try {
            await this.driveClient.permissions.create({
              fileId: existing.id,
              supportsAllDrives: true,
              requestBody: { role: 'writer', type: 'anyone' }
            });
          } catch (_) {}
          return {
            folderId: existing.id,
            folderName: existing.name,
            folderUrl: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`
          };
        }

        const createRes = await this.driveClient.files.create({
          supportsAllDrives: true,
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
          },
          fields: 'id, name, webViewLink'
        });

        try {
          await this.driveClient.permissions.create({
            fileId: createRes.data.id,
            supportsAllDrives: true,
            requestBody: { role: 'writer', type: 'anyone' }
          });
        } catch (_) {}

        console.log(`[Google Drive API] Dynamically created student folder "${folderName}": ID=${createRes.data.id}`);
        return {
          folderId: createRes.data.id,
          folderName: createRes.data.name,
          folderUrl: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`
        };
      } catch (apiErr) {
        console.warn('[Google Drive API] Folder creation notice:', apiErr.message);
      }
    }

    // 3. Fallback / Emulated storage
    const subfolderPath = path.join(UPLOADS_DIR, folderName);
    if (!fs.existsSync(subfolderPath)) {
      fs.mkdirSync(subfolderPath, { recursive: true });
    }
    const mockFolderId = `gdrive_folder_${folderName}_${Date.now()}`;
    return {
      folderId: mockFolderId,
      folderName: folderName,
      folderUrl: `https://drive.google.com/drive/folders/${this.folderId}`
    };
  }

  async verifyFolderExists(folderId) {
    if (!folderId || folderId.startsWith('gdrive_') || folderId.startsWith('local_')) return false;
    if (this.isLiveDriveConfigured()) {
      try {
        const res = await this.driveClient.files.get({
          fileId: folderId,
          fields: 'id, name, trashed, mimeType',
          supportsAllDrives: true
        });
        if (res.data && !res.data.trashed && res.data.mimeType === 'application/vnd.google-apps.folder') {
          return true;
        }
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  async uploadViaAppsScript({ originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName }) {
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!appsScriptUrl) return null;

    try {
      const base64 = buffer.toString('base64');
      let targetFolderId = folderId;
      if (!targetFolderId || targetFolderId.startsWith('gdrive_') || targetFolderId.startsWith('local_')) {
        targetFolderId = this.folderId;
      }

      const finalFileName = targetFileName || originalname;
      const payload = {
        fileName: finalFileName,
        mimeType: mimetype,
        base64: base64,
        folderId: targetFolderId,
        studentFolderName: studentFolderName
      };

      const res = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });

      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('[Google Drive Apps Script] Raw response (not JSON):', text.substring(0, 300));
        return null;
      }

      if (data && (data.fileId || data.id)) {
        const fileId = data.fileId || data.id;
        const actualFolderId = data.folderId || data.studentFolderId || targetFolderId;
        console.log(`[Google Drive via Apps Script] Uploaded directly into Google Drive folder ${actualFolderId}: ID=${fileId} ("${finalFileName}")`);
        return {
          driveFileId: fileId,
          fileName: finalFileName,
          mimeType: mimetype,
          fileSize: Number(data.size) || size,
          folderId: actualFolderId,
          studentFolderName: studentFolderName,
          webViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          driveWebViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          downloadUrl: `/api/drive/files/${fileId}/download`,
          storageType: 'google_drive_cloud',
          uploadedAt: new Date().toISOString()
        };
      } else if (data && data.error) {
        console.error('[Google Drive Apps Script Error reported]:', data.error);
        if (data.error.includes('No item with the given ID') && studentFolderName) {
          console.log(`[Google Drive Apps Script] Folder ${targetFolderId} not accessible. Dynamically creating subfolder "${studentFolderName}"...`);
          const newFolder = await this.getOrCreateStudentFolder(studentFolderName);
          if (newFolder && newFolder.folderId && !newFolder.folderId.startsWith('gdrive_') && newFolder.folderId !== targetFolderId) {
            return this.uploadViaAppsScript({ originalname, mimetype, buffer, size, folderId: newFolder.folderId, studentFolderName, targetFileName: finalFileName });
          }
        }
      }
    } catch (err) {
      console.error('[Google Drive Apps Script Error]:', err.message);
    }
    return null;
  }

  async uploadFile({ originalname, mimetype, buffer, size, folderId, studentFolderName, targetFileName }) {
    let targetFolderId = folderId;
    if (!targetFolderId || targetFolderId.startsWith('gdrive_') || targetFolderId.startsWith('local_')) {
      targetFolderId = this.folderId;
    }
    const finalFileName = targetFileName || originalname;
    const timestamp = Date.now();
    const safeName = `${timestamp}_${finalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // 1. Try Apps Script if configured (Directly uploads into user's personal @gmail.com folder)
    if (process.env.GOOGLE_APPS_SCRIPT_URL) {
      const scriptResult = await this.uploadViaAppsScript({ 
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
        return scriptResult;
      }
    }

    if (this.isLiveDriveConfigured()) {
      try {
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

        const res = await this.driveClient.files.create({
          supportsAllDrives: true,
          resource: fileMetadata,
          media: media,
          fields: 'id, name, webViewLink, webContentLink, size, mimeType, createdTime',
        });

        // Set file permissions to 'anyone with the link can view' for easier in-app preview
        try {
          await this.driveClient.permissions.create({
            fileId: res.data.id,
            supportsAllDrives: true,
            requestBody: {
              role: 'reader',
              type: 'anyone',
            },
          });
        } catch (permErr) {
          console.warn('[Google Drive] Permission setting notice:', permErr.message);
        }

        console.log(`[Google Drive] File uploaded successfully to Google Drive folder ${targetFolderId}: ID=${res.data.id}`);

        return {
          driveFileId: res.data.id,
          fileName: finalFileName,
          mimeType: res.data.mimeType || mimetype,
          fileSize: Number(res.data.size) || size,
          folderId: targetFolderId,
          studentFolderName: studentFolderName,
          webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
          driveWebViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
          downloadUrl: `/api/drive/files/${res.data.id}/download`,
          storageType: 'google_drive_cloud',
          uploadedAt: res.data.createdTime || new Date().toISOString()
        };
      } catch (err) {
        console.error('[Google Drive] Upload notice:', err.message);
        if (err.message && err.message.includes('storage quota')) {
          console.error('[Google Drive Quota Constraint]: Google Service Accounts do not have storage quota for personal @gmail.com folders. Files must be in a Google Workspace Shared Drive, or authenticated via OAuth2 User Credentials.');
        }
      }
    }

    // Emulated Google Drive Storage fallback
    const targetDir = studentFolderName 
      ? path.join(UPLOADS_DIR, studentFolderName) 
      : UPLOADS_DIR;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const localFilePath = path.join(targetDir, safeName);
    fs.writeFileSync(localFilePath, buffer);

    const relativeSavedName = studentFolderName ? `${studentFolderName}/${safeName}` : safeName;
    const mockDriveId = `gdrive_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    return {
      driveFileId: mockDriveId,
      fileName: finalFileName,
      savedFileName: relativeSavedName,
      mimeType: mimetype,
      fileSize: size,
      folderId: targetFolderId,
      studentFolderName: studentFolderName,
      webViewLink: `/api/drive/files/${mockDriveId}/view`,
      driveWebViewLink: `/api/drive/files/${mockDriveId}/view`,
      downloadUrl: `/api/drive/files/${mockDriveId}/download`,
      storageType: 'google_drive_emulated',
      uploadedAt: new Date().toISOString()
    };
  }

  async getFileStream(driveFileId) {
    if (this.isLiveDriveConfigured() && driveFileId && !driveFileId.startsWith('gdrive_')) {
      const response = await this.driveClient.files.get(
        { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
      return response.data;
    }
    return null;
  }

  async getFileMetadata(driveFileId) {
    if (this.isLiveDriveConfigured() && driveFileId && !driveFileId.startsWith('gdrive_')) {
      const response = await this.driveClient.files.get({
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
        await this.driveClient.files.delete({ fileId: driveFileId, supportsAllDrives: true });
        return { success: true };
      } catch (err) {
        console.warn('[Google Drive] Notice deleting cloud file:', err.message);
      }
    }

    if (savedFileName) {
      const localFilePath = path.join(UPLOADS_DIR, savedFileName);
      if (fs.existsSync(localFilePath)) {
        try {
          fs.unlinkSync(localFilePath);
        } catch (e) {
          console.warn('[Storage] Notice deleting local file:', e.message);
        }
      }
    }
    return { success: true };
  }

  async listFiles(targetFolderId) {
    const folderId = targetFolderId || this.folderId;

    if (this.isLiveDriveConfigured()) {
      try {
        const query = folderId 
          ? `'${folderId}' in parents and trashed = false`
          : 'trashed = false';

        const res = await this.driveClient.files.list({
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
          folderId: folderId || this.folderId,
          folderUrl: `https://drive.google.com/drive/folders/${folderId || this.folderId}`,
          count: files.length,
          files
        };
      } catch (err) {
        console.error('[Google Drive] listFiles error:', err.message);
      }
    }

    // Local / Emulated storage fallback
    const files = [];
    if (fs.existsSync(UPLOADS_DIR)) {
      const dirFiles = fs.readdirSync(UPLOADS_DIR);
      for (const fileName of dirFiles) {
        if (fileName === '.gitkeep') continue;
        const filePath = path.join(UPLOADS_DIR, fileName);
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
