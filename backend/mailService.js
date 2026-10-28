const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

class MailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const service = process.env.SMTP_SERVICE; // e.g. 'gmail'

    if (user && pass) {
      if (service === 'gmail' || (host && host.includes('gmail.com'))) {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
        console.log(`[MailService] Configured live Gmail transport for: ${user}`);
      } else if (host) {
        const secure = process.env.SMTP_SECURE === 'true' || port === 465;
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
        console.log(`[MailService] Configured live SMTP transport with host: ${host} (user: ${user})`);
      }
    } else {
      console.log('[MailService] SMTP credentials not set in .env. Emails will be logged to console.');
      this.transporter = null;
    }
  }

  /**
   * Send Password Reset Email with dynamic link
   */
  async sendPasswordResetEmail({ to, name, resetLink, token }) {
    // Reload .env to immediately catch any newly entered SMTP credentials
    try {
      require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
      this.initTransporter();
    } catch (_) {}

    const displayName = name || 'Student';
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || '"Ysquare Support" <no-reply@ysquare.com>';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Ysquare Password</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #FAF7F2; margin: 0; padding: 0; color: #1C1917; }
          .container { max-width: 580px; margin: 30px auto; background: #FFFFFF; border-radius: 14px; border: 1px solid #EAE3D8; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.04); }
          .header { background: linear-gradient(135deg, #1C1917 0%, #292524 100%); padding: 28px 32px; text-align: left; }
          .brand-title { color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }
          .brand-accent { color: #F15A24; }
          .brand-tag { font-size: 12px; color: #A8A29E; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
          .content { padding: 36px 32px; }
          .greeting { font-size: 18px; font-weight: 600; margin-bottom: 14px; color: #1C1917; }
          .paragraph { font-size: 15px; line-height: 1.6; color: #57534E; margin-bottom: 24px; }
          .btn-container { text-align: center; margin: 32px 0; }
          .btn-reset { display: inline-block; background: linear-gradient(135deg, #E64323 0%, #F15A24 100%); color: #FFFFFF !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 34px; border-radius: 10px; box-shadow: 0 4px 14px rgba(230, 67, 35, 0.35); }
          .url-box { background: #FCFAF6; border: 1px solid #EAE3D8; border-radius: 8px; padding: 14px; font-size: 12px; color: #78716C; word-break: break-all; margin-top: 24px; line-height: 1.5; }
          .url-link { color: #F15A24; text-decoration: none; }
          .footer { background: #FCFAF6; border-top: 1px solid #EAE3D8; padding: 20px 32px; text-align: center; font-size: 12px; color: #A8A29E; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="brand-title">Ysquare <span class="brand-accent">Documents</span></h1>
            <div class="brand-tag">Smart Document Checklist & Verification</div>
          </div>
          <div class="content">
            <div class="greeting">Hello, ${displayName}!</div>
            <p class="paragraph">
              We received a request to reset the password for your Ysquare account (<strong>${to}</strong>).
            </p>
            <p class="paragraph">
              Click the button below to choose a new password. This link is secure and will remain active for <strong>1 hour</strong>.
            </p>
            <div class="btn-container">
              <a href="${resetLink}" class="btn-reset" target="_blank">Reset My Password</a>
            </div>
            <p class="paragraph" style="font-size: 13px; color: #78716C;">
              If you didn't request a password reset, you can safely disregard this email. Your current password will remain unchanged.
            </p>
            <div class="url-box">
              <strong>Can't click the button?</strong> Copy and paste this URL into your browser:<br>
              <a href="${resetLink}" class="url-link">${resetLink}</a>
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Ysquare. All rights reserved.<br>
            Secure Document Verification System
          </div>
        </div>
      </body>
      </html>
    `;

    console.log(`\n=======================================================`);
    console.log(`[PASSWORD RESET EMAIL DISPATCHED]`);
    console.log(`To:        ${to} (${displayName})`);
    console.log(`Subject:   Reset Your Ysquare Password`);
    console.log(`Reset Link: ${resetLink}`);
    console.log(`Token:     ${token}`);
    console.log(`=======================================================\n`);

    // 1. Try Google Apps Script (Delivers directly to user's inbox without SMTP passwords)
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (appsScriptUrl) {
      try {
        const payload = {
          action: 'sendEmail',
          to,
          subject: 'Reset Your Ysquare Password',
          html: htmlContent,
          text: `Hello ${displayName},\n\nWe received a request to reset your Ysquare password.\n\nPlease open this link to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not make this request, you can ignore this email.`
        };

        const res = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        const text = await res.text();
        let result = null;
        try { result = JSON.parse(text); } catch (_) {}

        if (result && (result.success || (result.message && !result.error))) {
          console.log(`[MailService via Google Apps Script] Live email successfully sent to ${to}!`);
          return { success: true, liveEmailSent: true, resetLink };
        } else if (result && result.error && !result.error.includes('base64')) {
          console.warn('[MailService] Google Apps Script email response:', result.error);
        }
      } catch (scriptErr) {
        console.error('[MailService] Error sending email via Google Apps Script:', scriptErr.message);
      }
    }

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to,
          subject: 'Reset Your Ysquare Password',
          html: htmlContent,
          text: `Hello ${displayName},\n\nWe received a request to reset your Ysquare password.\n\nPlease open this link to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not make this request, you can ignore this email.`
        });
        console.log(`[MailService] Live email successfully sent to ${to}. MessageId: ${info.messageId}`);
        return { success: true, liveEmailSent: true, messageId: info.messageId, resetLink };
      } catch (err) {
        console.error(`[MailService] Error sending email via SMTP:`, err.message);
        return { success: true, liveEmailSent: false, error: err.message, resetLink };
      }
    }

    return {
      success: true,
      liveEmailSent: false,
      message: 'Email simulated in development mode. Check console or click direct link.',
      resetLink
    };
  }
}

module.exports = new MailService();
