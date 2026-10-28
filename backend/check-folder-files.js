const { google } = require('googleapis');
const path = require('path');
const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, 'service-account.json'), scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

async function check() {
  const rootRes = await drive.files.list({
    q: "'1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk' in parents and trashed = false",
    fields: 'files(id, name, mimeType)'
  });
  console.log('DOCUMENTS ROOT ALL ITEMS:', rootRes.data.files);

  const res1 = await drive.files.list({
    q: "'1whfnEORdpKpSjnVAxLCYIMoH3PSsfUcI' in parents and trashed = false",
    fields: 'files(id, name, mimeType, webViewLink, size)'
  });
  console.log('STU001_Johnathan_Doe FILES IN GOOGLE DRIVE:');
  console.log(res1.data.files);
}

check().then(() => process.exit(0)).catch(console.error);
