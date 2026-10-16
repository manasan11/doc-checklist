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
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1R4O69oYqihfJOxXjYmLoJNKiUu_A6y0p';
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

  async uploadViaAppsScript({ originalname, mimetype, buffer, size }) {
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!appsScriptUrl) return null;

    try {
      const base64 = buffer.toString('base64');
      const payload = {
        fileName: originalname,
        mimeType: mimetype,
        base64: base64,
        folderId: this.folderId
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
        console.log(`[Google Drive via Apps Script] Uploaded directly into Google Drive folder ${this.folderId}: ID=${fileId}`);
        return {
          driveFileId: fileId,
          fileName: data.name || originalname,
          mimeType: mimetype,
          fileSize: Number(data.size) || size,
          webViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          driveWebViewLink: data.url || `https://drive.google.com/file/d/${fileId}/view`,
          downloadUrl: data.downloadUrl || `https://drive.google.com/uc?export=download&id=${fileId}`,
          storageType: 'google_drive_cloud',
          uploadedAt: new Date().toISOString()
        };
      } else if (data && data.error) {
        console.error('[Google Drive Apps Script Error reported]:', data.error);
      }
    } catch (err) {
      console.error('[Google Drive Apps Script Error]:', err.message);
    }
    return null;
  }

  async uploadFile({ originalname, mimetype, buffer, size }) {
    const timestamp = Date.now();
    const safeName = `${timestamp}_${originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // 1. Try Apps Script if configured (Directly uploads into user's personal @gmail.com folder)
    if (process.env.GOOGLE_APPS_SCRIPT_URL) {
      const scriptResult = await this.uploadViaAppsScript({ originalname, mimetype, buffer, size });
      if (scriptResult) return scriptResult;
    }

    if (this.isLiveDriveConfigured()) {
      try {
        const fileMetadata = {
          name: originalname,
          parents: this.folderId ? [this.folderId] : undefined,
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

        console.log(`[Google Drive] File uploaded successfully to Google Drive folder ${this.folderId}: ID=${res.data.id}`);

        return {
          driveFileId: res.data.id,
          fileName: res.data.name || originalname,
          mimeType: res.data.mimeType || mimetype,
          fileSize: Number(res.data.size) || size,
          webViewLink: `/api/drive/files/${res.data.id}/view`,
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
    const localFilePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(localFilePath, buffer);

    const mockDriveId = `gdrive_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    return {
      driveFileId: mockDriveId,
      fileName: originalname,
      savedFileName: safeName,
      mimeType: mimetype,
      fileSize: size,
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
}

module.exports = new DriveService();
