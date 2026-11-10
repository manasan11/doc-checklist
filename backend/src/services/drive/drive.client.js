const fs = require('fs');
const { google } = require('googleapis');
const driveConfig = require('../../config/drive.config');

class DriveClient {
  constructor() {
    this.driveClient = null;
    this.authMode = 'none'; // 'oauth2' | 'service_account' | 'none'
    this.oauth2Client = null;
    this.init();
  }

  init() {
    try {
      // 1. Check for OAuth2 credentials
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

      // 2. Check for Service Account Key File
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

      // 3. Check for Service Account Environment Credentials
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

      console.log('[Google Drive] No live credentials configured. Running in Emulated Google Drive Mode.');
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

module.exports = new DriveClient();

