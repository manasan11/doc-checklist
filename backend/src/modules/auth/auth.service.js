const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../../config/database');
const mailService = require('../../services/mail.service');

// Active users cached in memory
const userCache = new Map();
// Active password reset tokens { [token]: { email, username, studentCode, userId, expiresAt } }
const resetTokens = {};

function cacheUser(user) {
  if (!user || !user.id) return user;
  const key = String(user.id).toLowerCase().trim();
  userCache.set(key, user);
  if (user.studentCode) {
    userCache.set(String(user.studentCode).toLowerCase().trim(), user);
    userCache.set(`u-${String(user.studentCode).toLowerCase().trim()}`, user);
  }
  if (user.email) {
    userCache.set(String(user.email).toLowerCase().trim(), user);
  }
  if (user.username) {
    userCache.set(String(user.username).toLowerCase().trim(), user);
  }
  return user;
}

function findUserById(userId) {
  if (!userId) return null;
  const cleanId = String(userId).trim().toLowerCase();
  if (userCache.has(cleanId)) {
    return userCache.get(cleanId);
  }
  // Try strip u-
  const stripped = cleanId.replace(/^u-/, '');
  if (userCache.has(stripped)) {
    return userCache.get(stripped);
  }
  if (userCache.has(`u-${cleanId}`)) {
    return userCache.get(`u-${cleanId}`);
  }
  return null;
}

function findUserByEmailOrUsername(identifier) {
  if (!identifier) return null;
  const lower = String(identifier).trim().toLowerCase();
  if (userCache.has(lower)) {
    return userCache.get(lower);
  }
  return null;
}

async function findOrLoadUser(userId) {
  if (!userId) return null;
  const existing = findUserById(userId);
  if (existing) return existing;

  try {
    if (String(userId).startsWith('admin-')) {
      const staff = await db.findStaffOrAdminUser(String(userId).replace(/^admin-/, ''));
      if (staff) {
        const newAdmin = {
          id: staff.id,
          email: staff.email || '',
          username: staff.username || staff.name,
          name: staff.name,
          password: staff.password,
          role: staff.role,
          department: staff.department,
          documents: []
        };
        return cacheUser(newAdmin);
      }
    }

    const rawId = String(userId).replace(/^u-/, '').trim();
    const s = await db.findUserByIdentifier(rawId);
    if (s) {
      const studentCode = String(s.studentCode || rawId).trim();
      const newUser = {
        id: s.id || `u-${studentCode}`,
        email: s.email || '',
        username: s.username || s.email || `student_${studentCode}`,
        name: s.name || `Student ${studentCode}`,
        password: s.password || '',
        role: s.role || 'user',
        department: s.department || 'General Operations',
        studentCode: studentCode,
        driveFolderId: null,
        driveFolderName: null,
        documents: []
      };
      return cacheUser(newUser);
    }
  } catch (err) {
    console.warn('[AuthService] findOrLoadUser error:', err.message);
  }
  return null;
}

async function authenticateUser(identifier, password) {
  if (!identifier || !password) return null;
  const cleanId = String(identifier).trim();
  const cleanLower = cleanId.toLowerCase();
  const passTrim = String(password).trim();
  let accountExists = false;

  // 1. Check MySQL user_details table (Admin and Staff authentication)
  try {
    const staffUser = await db.findStaffOrAdminUser(cleanId);
    if (staffUser) {
      accountExists = true;
      const expectedPass = staffUser.password ? String(staffUser.password).trim() : null;
      if (expectedPass && expectedPass === passTrim) {
        let user = findUserById(staffUser.id);
        if (!user) {
          user = {
            id: staffUser.id,
            email: staffUser.email,
            username: staffUser.username,
            name: staffUser.name,
            password: staffUser.password,
            role: staffUser.role,
            department: staffUser.department,
            documents: []
          };
          cacheUser(user);
        } else {
          user.password = staffUser.password;
          user.role = staffUser.role;
        }
        return user;
      }
    }
  } catch (err) {
    console.warn('[AuthService] Notice querying user_details for login:', err.message);
  }

  // 2. Optional Environment Admin fallback (only if BOTH ADMIN_USERNAME and ADMIN_PASSWORD are configured in .env)
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const envAdmin = process.env.ADMIN_USERNAME.trim().toLowerCase();
    if (cleanLower === envAdmin) {
      accountExists = true;
      if (passTrim === process.env.ADMIN_PASSWORD.trim()) {
        let user = findUserById('u-admin');
        if (!user) {
          user = {
            id: 'u-admin',
            email: process.env.SMTP_USER || '',
            username: process.env.ADMIN_USERNAME,
            name: 'Administrator',
            password: process.env.ADMIN_PASSWORD,
            role: 'admin',
            department: 'Operations & Compliance',
            documents: []
          };
          cacheUser(user);
        }
        return user;
      }
    }
  }

  // 3. Query MySQL student table
  try {
    const stu = await db.findUserByIdentifier(cleanId);
    if (stu) {
      accountExists = true;
      const expectedPass = stu.password ? String(stu.password).trim() : null;
      if (expectedPass && expectedPass === passTrim) {
        const user = await findOrLoadUser(stu.id);
        if (user) {
          user.password = expectedPass;
        }
        return user || stu;
      }
    }
  } catch (err) {
    console.warn('[AuthService] Notice querying MySQL for student login:', err.message);
  }

  // 4. Memory check for existing cached user
  const user = findUserByEmailOrUsername(cleanLower);
  if (user) {
    accountExists = true;
    if (user.password && String(user.password).trim() === passTrim) {
      return user;
    }
  }

  if (accountExists) {
    return { error: 'Incorrect password.' };
  }

  return { error: 'Account not found. Only registered users in the database can log in.' };
}

function createResetToken(email, user = null) {
  const now = Date.now();
  for (const key of Object.keys(resetTokens)) {
    if (!resetTokens[key]?.expiresAt || resetTokens[key].expiresAt < now) {
      delete resetTokens[key];
    }
  }
  const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  resetTokens[token] = {
    email,
    username: user?.username || null,
    studentCode: user?.studentCode || (user?.id ? String(user.id).replace(/^u-/, '') : null),
    userId: user?.id || null,
    expiresAt: Date.now() + 3600000
  };
  return token;
}

async function verifyAndResetPassword(token, newPassword) {
  const record = resetTokens[token];
  if (!record || record.expiresAt < Date.now()) {
    return { success: false, message: 'Reset link has expired or is invalid. Please request a new one.' };
  }

  const targetEmail = (record.email || '').toLowerCase().trim();
  const targetUsername = (record.username || '').toLowerCase().trim();
  const studentCode = record.studentCode || (record.userId ? String(record.userId).replace(/^u-/, '') : null);

  let mysqlUpdated = false;
  try {
    mysqlUpdated = await db.updateUserPassword(studentCode, targetEmail, targetUsername || targetEmail, newPassword);
  } catch (err) {
    console.warn('[AuthService] MySQL update error during password reset:', err.message);
  }

  // Update cached user if present
  let foundLocal = false;
  for (const u of userCache.values()) {
    const uEmail = (u.email || '').toLowerCase().trim();
    const uUser = (u.username || '').toLowerCase().trim();
    const uCode = u.studentCode || (u.id ? String(u.id).replace(/^u-/, '') : null);
    if (
      (targetEmail && uEmail === targetEmail) ||
      (targetUsername && uUser === targetUsername) ||
      (studentCode && uCode === studentCode)
    ) {
      u.password = newPassword;
      foundLocal = true;
    }
  }

  if (!foundLocal && !mysqlUpdated) {
    return { success: false, message: 'User account not found.' };
  }

  delete resetTokens[token];
  return { success: true, email: targetEmail };
}

async function updateUserPassword(userId, newPassword) {
  let user = findUserById(userId);
  if (!user) {
    user = await findOrLoadUser(userId);
  }
  if (!user) {
    return { success: false, message: 'User account not found.' };
  }

  user.password = newPassword;

  try {
    const studentCode = user.studentCode || String(userId || '').replace(/^u-/, '').trim();
    const cleanEmail = (user.email || '').toLowerCase().trim();
    const cleanUsername = (user.username || '').toLowerCase().trim();
    await db.updateUserPassword(studentCode, cleanEmail, cleanUsername, newPassword);
  } catch (err) {
    console.warn('[MySQL] Error updating password in database:', err.message);
  }

  return { success: true, email: user.email };
}

async function authenticate(username, password) {
  const result = await authenticateUser(username, password);
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
    user = await db.findUserByIdentifier(cleanLower);
  } catch (err) {
    console.warn('[AuthService] findUserByIdentifier warning:', err.message);
  }

  if (!user) {
    user = findUserByEmailOrUsername(trimmedInput);
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

  const resetToken = createResetToken(targetEmail, user);

  let clientOrigin = config.frontendUrl;
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      clientOrigin = `${parsed.protocol}//${parsed.host}`;
    } catch (_) {
      clientOrigin = originHeader.replace(/\/$/, '');
    }
  }

  const resetLink = `${clientOrigin}/#/login?view=reset&token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(targetEmail)}`;

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

async function resetPassword(token, newPassword) {
  const result = await verifyAndResetPassword(token, newPassword);
  if (!result.success) {
    return { success: false, error: result.message };
  }

  try {
    if (result.email) {
      await db.updateUserPassword(result.studentCode || null, result.email, result.username || null, newPassword);
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
  const result = await updateUserPassword(userId, newPassword);
  if (!result.success) {
    return { success: false, error: result.message || 'Failed to update password.' };
  }

  return { success: true, message: 'Your password has been reset successfully.' };
}

module.exports = {
  // User cache & lookup
  cacheUser,
  findUserById,
  findUserByEmailOrUsername,
  findOrLoadUser,
  authenticateUser,
  userCache,

  // Reset tokens & passwords
  createResetToken,
  verifyAndResetPassword,
  updateUserPassword,

  // Auth operations
  authenticate,
  generateToken,
  requestPasswordReset,
  resetPassword,
  changePassword
};
