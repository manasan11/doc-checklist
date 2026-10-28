require('dotenv').config();
const dataStore = require('./dataStore');
const { getPool } = require('./db');

async function organizeExistingFiles() {
  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('No GOOGLE_APPS_SCRIPT_URL configured in .env');
    return;
  }

  await dataStore.loadFromMysql();

  for (const user of dataStore.data.users) {
    if (user.role === 'admin') continue;
    const studentFolderName = dataStore.getStudentFolderSlug(user);

    // 1. Get or create the student subfolder
    console.log(`\n[Organize] Ensuring folder for ${user.name}: "${studentFolderName}"...`);
    const folderRes = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_student_folder',
        studentFolderName: studentFolderName
      }),
      redirect: 'follow'
    });

    const folderData = await folderRes.json();
    if (!folderData.success || !folderData.folderId) {
      console.error(`[Organize] Could not create folder for ${user.name}:`, folderData);
      continue;
    }

    const studentFolderId = folderData.folderId;
    console.log(`[Organize] Student folder ready: "${studentFolderName}" (ID: ${studentFolderId})`);
    dataStore.setUserDriveFolder(user.id, studentFolderId, studentFolderName);

    // 2. Move user's uploaded files into their student folder
    for (const doc of user.documents) {
      if (doc.uploadStatus === 'Uploaded' && doc.driveFileId && !doc.driveFileId.startsWith('gdrive_')) {
        console.log(`[Organize] Moving file "${doc.fileName}" (${doc.driveFileId}) into "${studentFolderName}"...`);
        const moveRes = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'move_file',
            fileId: doc.driveFileId,
            studentFolderName: studentFolderName
          }),
          redirect: 'follow'
        });
        const moveData = await moveRes.json();
        if (moveData.success) {
          console.log(`[Organize] Successfully moved "${doc.fileName}" into "${studentFolderName}"!`);
        } else {
          console.warn(`[Organize] Notice moving file "${doc.fileName}":`, moveData.error);
        }
      }
    }
  }

  dataStore.save();
  console.log('\n[Organize] Completed organization of all student files.');
}

if (require.main === module) {
  organizeExistingFiles().then(() => process.exit(0)).catch(err => {
    console.error('[Organize Error]:', err);
    process.exit(1);
  });
}

module.exports = organizeExistingFiles;
