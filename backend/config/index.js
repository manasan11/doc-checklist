const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  jwtSecret: process.env.JWT_SECRET || 'doc-checklist-super-secret-key-2026',
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',

  db: {
    host: process.env.DB_HOST || '49.13.118.79',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'TrackB0xPa$$w0rd',
    database: process.env.DB_NAME || 'trackbox_ysquare_db',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    connectTimeout: 20000,
    charset: 'utf8mb4'
  },

  drive: {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
    serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'service-account.json',
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/oauth2callback',
    appsScriptUrl: process.env.GOOGLE_APPS_SCRIPT_URL || ''
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"TrackBox Checklist" <no-reply@trackbox.com>'
  }
};

module.exports = config;
