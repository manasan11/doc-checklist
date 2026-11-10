const path = require('path');
const fs = require('fs');
const config = require('./index');

const rootDir = path.resolve(__dirname, '../../');
const keyFilePath = config.drive.serviceAccountKeyFile
  ? (path.isAbsolute(config.drive.serviceAccountKeyFile)
      ? config.drive.serviceAccountKeyFile
      : path.resolve(rootDir, config.drive.serviceAccountKeyFile))
  : path.resolve(rootDir, 'service-account.json');

const driveConfig = {
  folderId: config.drive.folderId,
  clientId: config.drive.clientId,
  clientSecret: config.drive.clientSecret,
  refreshToken: config.drive.refreshToken,
  redirectUri: config.drive.redirectUri,
  clientEmail: config.drive.clientEmail,
  privateKey: config.drive.privateKey,
  keyFilePath: fs.existsSync(keyFilePath) ? keyFilePath : null,
  appsScriptUrl: config.drive.appsScriptUrl,
  uploadsDir: path.resolve(rootDir, 'uploads')
};

module.exports = driveConfig;

