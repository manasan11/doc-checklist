require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const { getPool } = require('./db');
const dataStore = require('./dataStore');

async function linkFolders() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'service-account.json'),
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  const drive = google.drive({ version: 'v3', auth });
  const pool = getPool();

  const res = await drive.files.list({
    q: "'1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)'
  });

  const folders = res.data.files || [];
  console.log('Detected folders in documents:', folders);

  await dataStore.loadFromMysql();

  for (const f of folders) {
    for (const u of dataStore.data.users) {
      if (u.role === 'admin') continue;
      const slug = dataStore.getStudentFolderSlug(u);
      if (f.name === slug || f.name.toLowerCase() === slug.toLowerCase() || (u.studentCode && f.name.startsWith(u.studentCode))) {
        console.log(`Linking user ${u.name} (${u.email}) to folder "${f.name}" (ID: ${f.id})`);
        u.driveFolderId = f.id;
        u.driveFolderName = f.name;
        await pool.query('UPDATE users SET drive_folder_id = ?, drive_folder_name = ? WHERE id = ?', [
          f.id, f.name, u.id
        ]);
      }
    }
  }

  dataStore.save();
  console.log('Updated user folder mappings successfully!');
}

if (require.main === module) {
  linkFolders().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = linkFolders;
