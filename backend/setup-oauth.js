const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env') });

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
      const envPath = path.join(__dirname, '.env');
      let envData = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

      if (tokens.refresh_token) {
        if (envData.includes('GOOGLE_REFRESH_TOKEN=')) {
          envData = envData.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          envData += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }
      }

      fs.writeFileSync(envPath, envData, 'utf8');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 60px 20px; background: #FAF7F2; min-height: 100vh;">
          <div style="max-width: 520px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; border: 1px solid #EAE3D8; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
            <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
            <h1 style="color: #059669; margin: 0 0 12px 0; font-size: 24px;">Google Drive Connected Successfully!</h1>
            <p style="color: #57534E; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
              Your Google account has been authorized. The target folder (<strong>${process.env.GOOGLE_DRIVE_FOLDER_ID || '1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk'}</strong>) is now linked with your personal Drive quota.
            </p>
            <p style="color: #A8A29E; font-size: 13px;">You can close this tab and return to Ysquare.</p>
          </div>
        </div>
      `);

      console.log('\n[SUCCESS] OAuth2 tokens received and saved to backend/.env!');
      console.log('Refresh Token saved successfully.');
      console.log('Closing authorization server...\n');

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);

    } catch (err) {
      console.error('Error exchanging authorization code:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Authentication failed: ' + err.message);
    }
  } else if (reqUrl.query.error) {
    console.error('Google OAuth Error:', reqUrl.query.error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Authorization denied: ' + reqUrl.query.error);
  }
});

server.listen(PORT, () => {
  const startCmd = process.platform === 'win32' ? `start "" "${authUrl}"` : `open "${authUrl}"`;
  exec(startCmd, (err) => {
    if (err) console.log('Could not open browser automatically. Please open the link manually.');
  });
});
