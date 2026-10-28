const fs = require('fs');
const path = require('path');
const driveService = require('./driveService');
const dataStore = require('./dataStore');
const { getPool } = require('./db');

async function syncPendingToDrive() {
  console.log('[Sync] Starting sync of emulated files to Google Drive...');
  const pool = getPool();
  await dataStore.loadFromMysql();

  for (const user of dataStore.data.users) {
    if (user.role === 'admin') continue;
    const studentFolderName = dataStore.getStudentFolderSlug(user);

    for (const doc of user.documents) {
      if (doc.uploadStatus === 'Uploaded' && (doc.storageType === 'google_drive_emulated' || (doc.driveFileId && doc.driveFileId.startsWith('gdrive_')))) {
        if (!doc.savedFileName) continue;
        const localFilePath = path.join(__dirname, 'uploads', doc.savedFileName);
        if (!fs.existsSync(localFilePath)) {
          console.warn(`[Sync] Local file not found: ${localFilePath}`);
          continue;
        }

        console.log(`[Sync] Uploading "${doc.fileName}" for ${user.name} (${studentFolderName}) to Google Drive...`);
        const buffer = fs.readFileSync(localFilePath);
        const driveRes = await driveService.uploadFile({
          originalname: doc.fileName,
          mimetype: doc.mimeType || 'application/octet-stream',
          buffer: buffer,
          size: doc.fileSize || buffer.length,
          folderId: user.driveFolderId,
          studentFolderName: studentFolderName
        });

        if (driveRes && driveRes.driveFileId && !driveRes.driveFileId.startsWith('gdrive_')) {
          console.log(`[Sync] Successfully uploaded to Drive: File ID=${driveRes.driveFileId}, Folder ID=${driveRes.folderId}`);
          doc.driveFileId = driveRes.driveFileId;
          doc.storageType = 'google_drive_cloud';
          doc.webViewLink = driveRes.webViewLink;
          doc.downloadUrl = driveRes.downloadUrl;

          if (driveRes.folderId && !driveRes.folderId.startsWith('gdrive_') && driveRes.folderId !== driveService.folderId) {
            user.driveFolderId = driveRes.folderId;
            user.driveFolderName = studentFolderName;
          }

          if (doc.versions && doc.versions.length > 0) {
            const latestVer = doc.versions[doc.versions.length - 1];
            latestVer.driveFileId = driveRes.driveFileId;
            latestVer.storageType = 'google_drive_cloud';
            latestVer.webViewLink = driveRes.webViewLink;
            latestVer.downloadUrl = driveRes.downloadUrl;
          }
        } else {
          console.error(`[Sync] Failed to upload "${doc.fileName}" for user ${user.name}`);
        }
      }
    }
  }

  dataStore.save();
  console.log('[Sync] Finished sync process.');
}

if (require.main === module) {
  syncPendingToDrive().then(() => process.exit(0)).catch(err => {
    console.error('[Sync Error]:', err);
    process.exit(1);
  });
}

module.exports = syncPendingToDrive;
