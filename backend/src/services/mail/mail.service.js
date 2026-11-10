const nodemailer = require('nodemailer');
const config = require('../../config');
const { getPasswordResetHtml } = require('./templates/password-reset.template');

class MailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    const user = config.smtp.user;
    const pass = config.smtp.pass;
    const host = config.smtp.host;
    const port = config.smtp.port;

    if (user && pass) {
      if (host.includes('gmail.com')) {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
        console.log(`[MailService] Configured live Gmail transport for: ${user}`);
      } else if (host) {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure: config.smtp.secure || port === 465,
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

  async sendPasswordResetEmail({ to, name, resetLink, token }) {
    const displayName = name || 'Student';
    const fromAddress = config.smtp.from;
    const htmlContent = getPasswordResetHtml({ displayName, resetLink, to });

    console.log(`\n=======================================================`);
    console.log(`[PASSWORD RESET EMAIL DISPATCHED]`);
    console.log(`To:        ${to} (${displayName})`);
    console.log(`Subject:   Reset Your Ysquare Password`);
    console.log(`Reset Link: ${resetLink}`);
    console.log(`Token:     ${token}`);
    console.log(`=======================================================\n`);

    if (!to || !String(to).trim()) {
      console.warn('[MailService] Cannot send email: recipient "to" address is empty.');
      return { success: false, liveEmailSent: false, error: 'No recipient email address specified.', resetLink };
    }

    const cleanTo = String(to).trim();

    // 1. Direct SMTP / Gmail
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to: cleanTo,
          subject: 'Reset Your Ysquare Password',
          html: htmlContent,
          text: `Hello ${displayName},\n\nWe received a request to reset your Ysquare password.\n\nPlease open this link to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not make this request, you can ignore this email.`
        });
        console.log(`[MailService via Gmail SMTP] Live email successfully sent to ${cleanTo}. MessageId: ${info.messageId}`);
        return { success: true, liveEmailSent: true, messageId: info.messageId, resetLink };
      } catch (err) {
        console.error(`[MailService] Notice sending email via SMTP:`, err.message);
      }
    }

    // 2. Fallback to Google Apps Script
    const appsScriptUrl = config.drive.appsScriptUrl;
    if (appsScriptUrl) {
      try {
        const payload = {
          action: 'sendEmail',
          to: cleanTo,
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
          console.log(`[MailService via Google Apps Script] Live email successfully sent to ${cleanTo}!`);
          return { success: true, liveEmailSent: true, resetLink };
        }
      } catch (scriptErr) {
        console.error('[MailService] Error sending email via Google Apps Script:', scriptErr.message);
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
