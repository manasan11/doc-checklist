const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '801172938885-s3pvaqv7diouqk54cincd01o6ve93pn6.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const PORT = 5055;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file'
  ]
});

console.log('========================================================================');
console.log('            YSQUARE - GOOGLE DRIVE OAUTH2 AUTHORIZATION                 ');
console.log('========================================================================');
console.log('\nTarget Google Drive Folder: ' + (process.env.GOOGLE_DRIVE_FOLDER_ID || '1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk'));
console.log('\nOpening your browser to authorize access with your Google account...\n');
console.log('If browser does not open automatically, copy and open this URL:');
console.log(authUrl);
console.log('\nWaiting for authorization callback on http://localhost:' + PORT + ' ...');
console.log('========================================================================\n');

const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url, true);
  const code = reqUrl.query.code;

  if (code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      if (!tokens.refresh_token) {
        console.warn('\nNotice: No refresh token returned. You may need to revoke prior app access and retry with prompt=consent.');
      }

      // Save credentials and refresh token to .env
      let envData = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

      const updates = {
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN: tokens.refresh_token || '',
        GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/drive/oauth2callback'
      };

      for (const [key, val] of Object.entries(updates)) {
        if (!val) continue;
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envData)) {
          envData = envData.replace(regex, `${key}=${val}`);
        } else {
          envData += `\n${key}=${val}`;
        }
      }

      fs.writeFileSync(envPath, envData.trim() + '\n', 'utf8');

      console.log('\n Authorization Successful!');
      console.log('Credentials and Refresh Token have been saved to your .env file.');
      console.log('You can now restart the backend to start using live Google Drive uploads with user quota.\n');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #16a34a;"> Authorization Successful!</h1>
          <p>Your Google Drive OAuth2 tokens have been saved to the backend <code>.env</code> file.</p>
          <p>You can close this window and return to your terminal.</p>
        </body>
        </html>
      `);

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);

    } catch (err) {
      console.error('\nError exchanging authorization code for tokens:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error exchanging code: ' + err.message);
    }
  } else {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('No authorization code found in request.');
  }
});

server.listen(PORT, () => {
  // Open URL in default browser
  const startCmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open');
  exec(`${startCmd} "${authUrl}"`, (err) => {
    if (err) {
      // Ignored if browser cannot be launched in headless environments
    }
  });
});
