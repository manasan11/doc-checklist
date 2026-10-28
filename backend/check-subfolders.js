const { google } = require('googleapis');
const path = require('path');
const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, 'service-account.json'), scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

async function check() {
  const res = await drive.files.list({
    q: "'1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)'
  });
  console.log('CURRENT SUBFOLDERS IN GOOGLE DRIVE:', res.data.files);
}

check().catch(console.error);
