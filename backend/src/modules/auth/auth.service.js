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
  if (userCache.has(cleanId)) return userCache.get(cleanId);
  const stripped = cleanId.replace(/^u-/, '');
  if (userCache.has(stripped)) return userCache.get(stripped);
  if (userCache.has(`u-${cleanId}`)) return userCache.get(`u-${cleanId}`);
  return null;
}

function findUserByEmailOrUsername(identifier) {
  if (!identifier) return null;
  const lower = String(identifier).trim().toLowerCase();
  return userCache.get(lower) || null;
}

// Direct DB Query: Find staff or admin from MySQL user_details table
async function findStaffOrAdminInDb(identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim();
  const cleanLower = clean.toLowerCase();

  try {
    const isEmail = clean.includes('@');
    let query = '';
    let params = [];

    if (isEmail) {
      query = 'SELECT * FROM user_details WHERE LOWER(TRIM(Email)) = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) AND (Working_Status = 1 OR Working_Status = "1") LIMIT 1';
      params = [cleanLower];
    } else {
      const isNum = /^\d+$/.test(clean);
      if (isNum) {
        query = 'SELECT * FROM user_details WHERE (LOWER(TRIM(User_Details_Name)) = ? OR LOWER(TRIM(Email)) = ? OR User_Details_Id = ? OR Employee_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) AND (Working_Status = 1 OR Working_Status = "1") LIMIT 1';
        params = [cleanLower, cleanLower, parseInt(clean, 10), parseInt(clean, 10)];
      } else {
        query = 'SELECT * FROM user_details WHERE (LOWER(TRIM(User_Details_Name)) = ? OR LOWER(TRIM(Email)) = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) AND (Working_Status = 1 OR Working_Status = "1") LIMIT 1';
        params = [cleanLower, cleanLower];
      }
    }

    const [rows] = await db.query(query, params);
    if (rows && rows.length > 0) {
      const u = rows[0];
      const dept = (u.Department_Name || '').toLowerCase();
      const role = (dept.includes('admin') || (u.User_Details_Name || '').toLowerCase() === 'admin') ? 'admin' : 'staff';
      return {
        id: `admin-${u.User_Details_Id}`,
        name: u.User_Details_Name || 'Administrator',
        email: u.Email || '',
        username: u.User_Details_Name || u.Email,
        password: u.Password,
        role: role,
        department: u.Department_Name || 'Operations & Compliance',
        userDetailsId: u.User_Details_Id
      };
    }
  } catch (err) {
    console.warn('[AuthService] findStaffOrAdminInDb notice:', err.message);
  }
  return null;
}

// Direct DB Query: Find student from MySQL student table
async function findStudentInDb(identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim();
  const isEmail = clean.includes('@');
  const prefixMatch = !isEmail ? clean.match(/^(?:u-|stu|student[-_]?)(\d+)$/i) : null;
  const numPart = prefixMatch ? prefixMatch[1] : null;

  try {
    let query = '';
    let params = [];

    if (isEmail) {
      query = 'SELECT * FROM student WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?)) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
      params = [clean];
    } else {
      query = 'SELECT * FROM student WHERE (Username = ? OR Student_Name = ?';
      params = [clean, clean];
      if (/^\d+$/.test(clean)) {
        query += ' OR Student_Id = ?';
        params.push(parseInt(clean, 10));
      }
      query += ' OR Unique_Id = ?';
      params.push(clean);
      if (numPart && numPart !== clean && /^\d+$/.test(numPart)) {
        query += ' OR Student_Id = ?';
        params.push(parseInt(numPart, 10));
      }
      query += ') AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
    }

    const [stuRows] = await db.query(query, params);
    if (stuRows && stuRows.length > 0) {
      const s = stuRows[0];
      const studentCode = String(s.Student_Id || s.Unique_Id || clean).trim();
      return {
        id: `u-${studentCode}`,
        email: s.Email,
        username: s.Username || s.Email,
        name: s.Student_Name || s.Username || `Student ${studentCode}`,
        password: s.Password,
        role: 'user',
        department: s.Proceeding_Course_Name || 'General Operations',
        studentCode
      };
    }
  } catch (err) {
    console.warn('[AuthService] findStudentInDb error:', err.message);
  }
  return null;
}

function clearUserCache(userId, email, username, studentCode) {
  const toDelete = [];
  const uId = userId ? String(userId).toLowerCase().trim() : null;
  const em = email ? String(email).toLowerCase().trim() : null;
  const un = username ? String(username).toLowerCase().trim() : null;
  const sc = studentCode ? String(studentCode).toLowerCase().trim() : null;

  for (const [key, val] of userCache.entries()) {
    const k = key.toLowerCase();
    const vId = val?.id ? String(val.id).toLowerCase() : '';
    const vEm = val?.email ? String(val.email).toLowerCase() : '';
    const vUn = val?.username ? String(val.username).toLowerCase() : '';
    const vSc = val?.studentCode ? String(val.studentCode).toLowerCase() : '';

    if (
      (uId && (k === uId || k === uId.replace(/^u-/, '') || k === uId.replace(/^admin-/, '') || vId === uId)) ||
      (em && (k === em || vEm === em)) ||
      (un && (k === un || vUn === un)) ||
      (sc && (k === sc || k === `u-${sc}` || vSc === sc))
    ) {
      toDelete.push(key);
    }
  }
  for (const k of toDelete) {
    userCache.delete(k);
  }
}

// Direct DB Query: Update password in user_details (admin/staff) or student tables
async function updatePasswordInDb({ userId, studentCode, email, username, newPassword }) {
  if (!newPassword) return false;
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanUsername = (username || '').toLowerCase().trim();
  let updated = false;

  try {
    // 1. If explicit admin/staff userId (e.g. 'admin-151')
    if (userId && String(userId).startsWith('admin-')) {
      const adminId = parseInt(String(userId).replace(/^admin-/, ''), 10);
      if (adminId) {
        const [res] = await db.query(
          'UPDATE user_details SET Password = ? WHERE User_Details_Id = ?',
          [newPassword, adminId]
        );
        if (res && (res.affectedRows > 0 || res.changedRows > 0)) updated = true;
      }
    }

    // 2. If explicit student userId (e.g. 'u-1')
    if (!updated && userId && String(userId).startsWith('u-')) {
      const sCode = String(userId).replace(/^u-/, '').trim();
      const [res] = await db.query(
        'UPDATE student SET Password = ? WHERE (Student_Id = ? OR Unique_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
        [newPassword, sCode, sCode]
      );
      if (res && (res.affectedRows > 0 || res.changedRows > 0)) updated = true;
    }

    // 3. By studentCode if provided and not an admin
    if (!updated && studentCode && !String(studentCode).startsWith('admin-')) {
      const cleanCode = String(studentCode).replace(/^u-/, '').trim();
      const [res] = await db.query(
        'UPDATE student SET Password = ? WHERE (Student_Id = ? OR Unique_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
        [newPassword, cleanCode, cleanCode]
      );
      if (res && (res.affectedRows > 0 || res.changedRows > 0)) updated = true;
    }

    // 4. By email: check user_details first, then student
    if (!updated && cleanEmail) {
      const [staffCheck] = await db.query(
        'SELECT User_Details_Id FROM user_details WHERE LOWER(TRIM(Email)) = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
        [cleanEmail]
      );
      if (staffCheck && staffCheck.length > 0) {
        const [res] = await db.query(
          'UPDATE user_details SET Password = ? WHERE User_Details_Id = ?',
          [newPassword, staffCheck[0].User_Details_Id]
        );
        if (res && (res.affectedRows > 0 || res.changedRows > 0)) updated = true;
      } else {
        const [res] = await db.query(
          'UPDATE student SET Password = ? WHERE LOWER(TRIM(Email)) = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [newPassword, cleanEmail]
        );
        if (res && (res.affectedRows > 0 || res.changedRows > 0)) updated = true;
      }
    }

    // 5. By username if not updated yet
    if (!updated && cleanUsername) {
      const [staffRes] = await db.query(
        'UPDATE user_details SET Password = ? WHERE LOWER(TRIM(User_Details_Name)) = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
        [newPassword, cleanUsername]
      );
      if (staffRes && (staffRes.affectedRows > 0 || staffRes.changedRows > 0)) {
        updated = true;
      } else {
        const [stuRes] = await db.query(
          'UPDATE student SET Password = ? WHERE LOWER(TRIM(Username)) = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [newPassword, cleanUsername]
        );
        if (stuRes && (stuRes.affectedRows > 0 || stuRes.changedRows > 0)) updated = true;
      }
    }

    // 6. Direct numeric ID fallback
    if (!updated && userId && /^\d+$/.test(String(userId).trim())) {
      const numId = parseInt(String(userId).trim(), 10);
      const [staffRes] = await db.query(
        'UPDATE user_details SET Password = ? WHERE User_Details_Id = ?',
        [newPassword, numId]
      );
      if (staffRes && (staffRes.affectedRows > 0 || staffRes.changedRows > 0)) {
        updated = true;
      } else {
        const [stuRes] = await db.query(
          'UPDATE student SET Password = ? WHERE Student_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [newPassword, numId]
        );
        if (stuRes && (stuRes.affectedRows > 0 || stuRes.changedRows > 0)) updated = true;
      }
    }
  } catch (err) {
    console.warn('[AuthService] updatePasswordInDb error:', err.message);
  }

  // Clear in-memory cache so no stale password can ever be used
  clearUserCache(userId, cleanEmail, cleanUsername, studentCode);

  return updated;
}

async function findOrLoadUser(userId) {
  if (!userId) return null;
  const existing = findUserById(userId);
  if (existing) return existing;

  if (String(userId).startsWith('admin-')) {
    const staff = await findStaffOrAdminInDb(String(userId).replace(/^admin-/, ''));
    if (staff) return cacheUser(staff);
  }

  const rawId = String(userId).replace(/^u-/, '').trim();
  const student = await findStudentInDb(rawId);
  if (student) return cacheUser(student);

  // Fallback check staff
  const staff = await findStaffOrAdminInDb(rawId);
  if (staff) return cacheUser(staff);

  return null;
}

async function authenticate(username, password) {
  if (!username || !password) return { error: 'Username and password are required' };
  const cleanId = String(username).trim();
  const passTrim = String(password).trim();

  // 1. Check MySQL user_details (Staff / Admin)
  const staff = await findStaffOrAdminInDb(cleanId);
  if (staff) {
    const expectedPass = staff.password ? String(staff.password).trim() : '';
    if (expectedPass === passTrim || expectedPass.toLowerCase() === passTrim.toLowerCase()) {
      return { user: cacheUser(staff) };
    }
    return { error: 'Incorrect password.' };
  }

  // 2. Check MySQL student table
  const student = await findStudentInDb(cleanId);
  if (student) {
    const expectedPass = student.password ? String(student.password).trim() : '';
    if (expectedPass === passTrim || expectedPass.toLowerCase() === passTrim.toLowerCase()) {
      return { user: cacheUser(student) };
    }
    return { error: 'Incorrect password.' };
  }

  return { error: 'Account not found. Only registered users in the database can log in.' };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );
}

function createResetToken(email, user = null) {
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

async function requestPasswordReset(emailInput, originHeader) {
  const clean = (emailInput || '').trim();
  let user = await findStudentInDb(clean) || await findStaffOrAdminInDb(clean) || findUserByEmailOrUsername(clean);

  if (!user) {
    return { error: 'No account registered with this email or username in the database', status: 404 };
  }

  const targetEmail = user.email || (clean.includes('@') ? clean : null);
  if (!targetEmail) {
    return { error: 'No email address found for this account. Please contact admin.', status: 400 };
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
      name: user.name || 'User',
      resetLink,
      token: resetToken
    });
  } catch (err) {
    console.error('[AuthService] Mail error:', err.message);
  }

  return {
    success: true,
    message: mailResult.liveEmailSent
      ? `A password reset link has been sent to ${targetEmail}.`
      : `Password reset link prepared for ${targetEmail}.`,
    resetLink,
    resetToken,
    email: targetEmail
  };
}

async function resetPassword(token, newPassword) {
  const record = resetTokens[token];
  if (!record || record.expiresAt < Date.now()) {
    return { success: false, error: 'Reset link has expired or is invalid.' };
  }

  const cleanPass = String(newPassword || '').trim();
  if (!cleanPass || cleanPass.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters long.' };
  }

  // Prevent reusing existing password
  let user = null;
  if (record.userId) user = await findOrLoadUser(record.userId);
  if (!user && record.email) user = await findStaffOrAdminInDb(record.email) || await findStudentInDb(record.email);
  if (!user && record.username) user = await findStaffOrAdminInDb(record.username) || await findStudentInDb(record.username);

  if (user && user.password) {
    const existingPass = String(user.password).trim();
    if (existingPass === cleanPass || existingPass.toLowerCase() === cleanPass.toLowerCase()) {
      return {
        success: false,
        error: 'New password cannot be the same as your old password. Please choose a different password.'
      };
    }
  }

  const updated = await updatePasswordInDb({
    userId: record.userId || user?.id,
    studentCode: record.studentCode || user?.studentCode,
    email: record.email || user?.email,
    username: record.username || user?.username,
    newPassword: cleanPass
  });

  if (!updated) {
    return {
      success: false,
      error: 'Failed to update password in database. Please try again.'
    };
  }

  clearUserCache(record.userId || user?.id, record.email || user?.email, record.username || user?.username, record.studentCode || user?.studentCode);
  delete resetTokens[token];

  return {
    success: true,
    email: record.email,
    message: 'Password has been successfully updated.'
  };
}

async function changePassword(userId, userEmail, newPassword) {
  const cleanPass = String(newPassword || '').trim();
  if (!cleanPass || cleanPass.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters long.' };
  }

  const user = await findOrLoadUser(userId);
  if (user && user.password) {
    const existingPass = String(user.password).trim();
    if (existingPass === cleanPass || existingPass.toLowerCase() === cleanPass.toLowerCase()) {
      return {
        success: false,
        error: 'New password cannot be the same as your current password. Please choose a different password.'
      };
    }
  }

  const updated = await updatePasswordInDb({
    userId,
    studentCode: user?.studentCode,
    email: userEmail || user?.email,
    username: user?.username,
    newPassword: cleanPass
  });

  if (!updated) {
    return {
      success: false,
      error: 'Failed to update password in database. Please verify your account and try again.'
    };
  }

  if (user) user.password = cleanPass;
  clearUserCache(userId, userEmail || user?.email, user?.username, user?.studentCode);

  return {
    success: true,
    message: 'Password updated in database successfully.'
  };
}

module.exports = {
  cacheUser,
  findUserById,
  findUserByEmailOrUsername,
  findOrLoadUser,
  authenticate,
  generateToken,
  requestPasswordReset,
  resetPassword,
  changePassword,
  findStaffOrAdminInDb,
  findStudentInDb
};
