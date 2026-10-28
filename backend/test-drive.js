const driveService = require('./driveService');

async function test() {
  console.log('[1] Checking Google Drive Status...');
  const status = driveService.getDriveStatus();
  console.log('Status Result:\n', JSON.stringify(status, null, 2));

  console.log('\n[2] Checking Google Drive Client...');
  console.log('Drive Client initialized:', driveService.isLiveDriveConfigured());
  console.log('Auth Mode:', driveService.authMode);

  if (process.env.GOOGLE_APPS_SCRIPT_URL) {
    console.log('\n[3] Testing Apps Script URL reachable (GET)...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, { signal: controller.signal });
      clearTimeout(timeout);
      console.log('Apps Script HTTP Status:', res.status, res.statusText);
    } catch (err) {
      console.log('Apps Script check failed or timed out:', err.message);
    }
  }

  if (driveService.isLiveDriveConfigured()) {
    console.log('\n[4] Testing Google Drive API list files via service account/OAuth...');
    try {
      const folderId = driveService.folderId;
      console.log('Querying files inside folderId:', folderId);
      const res = await driveService.driveClient.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, size, webViewLink, webContentLink, createdTime, modifiedTime)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      console.log('Successfully connected to Google Drive API!');
      console.log('Found files in folder:', res.data.files);
    } catch (err) {
      console.log('Google Drive API list error:', err.message);
    }
  }

  console.log('\n[5] Testing driveService.listFiles()...');
  const driveFilesResult = await driveService.listFiles();
  console.log('driveService.listFiles() Result:');
  console.log(' - Source:', driveFilesResult.source);
  console.log(' - Total Files:', driveFilesResult.count);
  console.log(' - Files:');
  (driveFilesResult.files || []).forEach(f => {
    console.log(`     * "${f.fileName}" (ID: ${f.driveFileId}, Size: ${f.fileSize} bytes)`);
  });

  console.log('\n[6] Testing dataStore sync with drive files for user u-1...');
  const dataStore = require('./dataStore');
  const syncResult = dataStore.syncGoogleDriveFiles('u-1', driveFilesResult.files);
  console.log(' - Newly Synced count:', syncResult.syncedCount);
  console.log(' - User Document Checklist now has:');
  syncResult.documents.forEach(d => {
    console.log(`   #${d.id} [${d.uploadStatus}] ${d.name} -> File: ${d.fileName || '(none)'} (Drive ID: ${d.driveFileId || 'none'})`);
  });
}

test().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
