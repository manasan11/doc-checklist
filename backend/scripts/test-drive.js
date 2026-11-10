const driveService = require('../src/services/drive/drive.service');

async function test() {
  console.log('[1] Checking Google Drive Status...');
  const status = driveService.getDriveStatus();
  console.log('Status Result:\n', JSON.stringify(status, null, 2));

  console.log('\n[2] Checking Google Drive Client...');
  console.log('Drive Client initialized:', driveService.isLiveDriveConfigured());
  console.log('Auth Mode:', driveService.authMode || status.authMode);

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
      const res = await driveService.listFiles(folderId);
      console.log('Successfully connected to Google Drive API!');
      console.log('Found files in folder:', res.count);
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

  console.log('\n Google Drive Integration Test Completed Successfully!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
