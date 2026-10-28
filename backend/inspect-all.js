const { google } = require('googleapis');
const path = require('path');
const auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, 'service-account.json'), scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth });

async function inspect() {
  const rootRes = await drive.files.list({
    q: "'1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk' in parents and trashed = false",
    fields: 'files(id, name, mimeType, createdTime)'
  });
  console.log('--- ROOT DOCUMENTS FOLDER (1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk) ---');
  console.log(JSON.stringify(rootRes.data.files, null, 2));

  const johnRes = await drive.files.list({
    q: "'1ILq7BZSJHN7FV9m5Cy_hHyR9h3i-UvLv' in parents and trashed = false",
    fields: 'files(id, name, mimeType, createdTime)'
  });
  console.log('--- STU001_Johnathan_Doe (1ILq7BZSJHN7FV9m5Cy_hHyR9h3i-UvLv) ---');
  console.log(JSON.stringify(johnRes.data.files, null, 2));

  const demoRes = await drive.files.list({
    q: "'1xED29gzZ2lUfVVbvk8WKsj63fl_fvcLa' in parents and trashed = false",
    fields: 'files(id, name, mimeType, createdTime)'
  });
  console.log('--- STU002_Demo (1xED29gzZ2lUfVVbvk8WKsj63fl_fvcLa) ---');
  console.log(JSON.stringify(demoRes.data.files, null, 2));
}

inspect().then(() => process.exit(0)).catch(console.error);
