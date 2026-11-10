const jwt = require('jsonwebtoken');
const config = require('../../config');
const dataStore = require('../../dataStore');
const authRepo = require('./auth.repository');
const mailService = require('../../services/mail/mail.service');

async function authenticate(username, password) {
  const result = await dataStore.authenticateUser(username, password);
  if (!result || result.error) {
    return { error: result?.error || 'Invalid credentials' };
  }
  return { user: result };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );
}

async function requestPasswordReset(emailInput, originHeader) {
  const trimmedInput = (emailInput || '').trim();
  const cleanLower = trimmedInput.toLowerCase();

  let user = null;
  try {
    user = await authRepo.findUserByIdentifier(cleanLower);
  } catch (err) {
    console.warn('[AuthService] findUserByIdentifier warning:', err.message);
  }

  if (!user) {
    user = dataStore.findUserByEmailOrUsername(trimmedInput);
  }

  if (!user) {
    return { error: 'No account registered with this email or username in the database', status: 404 };
  }

  let targetEmail = trimmedInput.includes('@') ? trimmedInput : null;
  if (user && user.email && user.email.trim() && !user.email.endsWith('@example.com')) {
    targetEmail = user.email.trim();
  } else if (user && user.role === 'admin') {
    targetEmail = config.smtp.user || 'Docs@ysquareoverseas.com';
  }

  if (!targetEmail) {
    return {
      error: `The account "${user.name || user.username || trimmedInput}" does not have an email address in the database. Please enter your email address.`,
      status: 400
    };
  }

  const resetToken = dataStore.createResetToken(targetEmail, user);

  let clientOrigin = config.frontendUrl;
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      clientOrigin = `${parsed.protocol}//${parsed.host}`;
    } catch (_) {
      clientOrigin = originHeader.replace(/\/$/, '');
    }
  }

  const resetLink = `${clientOrigin}/login?view=reset&token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(targetEmail)}`;

  let mailResult = { liveEmailSent: false };
  try {
    mailResult = await mailService.sendPasswordResetEmail({
      to: targetEmail,
      name: user.name || 'Student',
      resetLink,
      token: resetToken
    });
  } catch (mailErr) {
    console.error('[AuthService] Mail error:', mailErr.message);
  }

  return {
    success: true,
    message: mailResult.liveEmailSent
      ? `A password reset link has been sent to your registered email (${user.email}). Please check your inbox and click the link to reset your password.`
      : `Password reset link prepared for ${user.email}. Check your email or use the reset link below.`,
    resetLink,
    resetToken,
    email: user.email,
    liveEmailSent: mailResult.liveEmailSent,
    instructions: `Please click the link sent to your registered email address (${user.email}) to set a new password.`
  };
}

function verifyResetToken(token) {
  const tokenInfo = dataStore.getResetToken(token);
  if (!tokenInfo || tokenInfo.expiresAt < Date.now()) {
    return { valid: false, error: 'This password reset link has expired or is invalid. Please request a new one.' };
  }

  const user = dataStore.findUserByEmailOrUsername(tokenInfo.email);
  return {
    valid: true,
    email: tokenInfo.email,
    name: user ? user.name : tokenInfo.email
  };
}

async function resetPassword(token, newPassword) {
  const result = await dataStore.verifyAndResetPassword(token, newPassword);
  if (!result.success) {
    return { success: false, error: result.message };
  }

  try {
    if (result.email) {
      await authRepo.updateUserPassword(result.studentCode || null, result.email, result.username || null, newPassword);
    }
  } catch (err) {
    console.warn('[AuthService] MySQL notice updating password:', err.message);
  }

  return {
    success: true,
    email: result.email,
    message: 'Password has been successfully updated. You may now log in with your new password.'
  };
}

async function changePassword(userId, userEmail, newPassword) {
  const result = await dataStore.updateUserPassword(userId, newPassword);
  if (!result.success) {
    return { success: false, error: result.message || 'Failed to update password.' };
  }

  try {
    const user = dataStore.findUserById(userId);
    const studentCode = user?.studentCode || (String(userId).includes('STU') ? String(userId).replace(/^u-/, '') : null);
    const cleanEmail = (userEmail || user?.email || '').toLowerCase().trim();
    const cleanUsername = (user?.username || '').toLowerCase().trim();

    await authRepo.updateUserPassword(studentCode, cleanEmail, cleanUsername, newPassword);
  } catch (err) {
    console.warn('[AuthService] MySQL notice updating password:', err.message);
  }

  return { success: true, message: 'Your password has been reset successfully.' };
}

function getUserProfile(userId) {
  return dataStore.findUserById(userId);
}

module.exports = {
  authenticate,
  generateToken,
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
  changePassword,
  getUserProfile
};
