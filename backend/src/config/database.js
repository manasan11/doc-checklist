const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: 0,
      charset: config.db.charset,
      connectTimeout: config.db.connectTimeout,
      ssl: false
    });
  }
  return pool;
}

async function initDatabase() {
  try {
    const dbPool = getPool();
    const conn = await dbPool.getConnection();
    conn.release();
    isConnected = true;
    console.log(`[MySQL] Connected successfully to database: "${config.db.database}"`);
    return true;
  } catch (err) {
    isConnected = false;
    console.error('[MySQL] Connection warning:', err.message);
    return false;
  }
}

function isDbConnected() {
  return isConnected;
}

async function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  const pool = getPool();
  if (!pool) return null;
  const clean = String(identifier).trim();
  const isEmail = clean.includes('@');
  const numPart = isEmail ? '' : clean.replace(/\D/g, '');

  try {
    let query = '';
    let params = [];
    if (isEmail) {
      query = 'SELECT * FROM student WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?)) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
      params = [clean];
    } else {
      query = 'SELECT * FROM student WHERE (Username = ? OR Student_Id = ? OR Unique_Id = ?';
      params = [clean, clean, clean];
      if (numPart && numPart !== clean) {
        query += ' OR Student_Id = ? OR Unique_Id = ?';
        params.push(numPart, numPart);
      }
      query += ') AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1';
    }

    const [stuRows] = await pool.query(query, params);
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
    console.warn('[Database] findUserByIdentifier error:', err.message);
  }
  return null;
}

async function updateUserPassword(studentCode, email, username, newPassword) {
  const pool = getPool();
  if (!pool) return false;
  const cleanEmail = email ? String(email).toLowerCase().trim() : null;
  const cleanUsername = username ? String(username).toLowerCase().trim() : null;
  const cleanCode = studentCode ? String(studentCode).trim() : null;

  let updated = false;
  try {
    const [stuRes] = await pool.query(
      'UPDATE student SET Password = ? WHERE (Student_Id IS NOT NULL AND Student_Id = ?) OR (LOWER(TRIM(Email)) = ? AND Email IS NOT NULL AND Email != "") OR (LOWER(TRIM(Username)) = ? AND Username IS NOT NULL AND Username != "")',
      [newPassword, cleanCode, cleanEmail, cleanUsername || cleanEmail]
    );
    updated = Boolean(stuRes && (stuRes.affectedRows > 0 || stuRes.changedRows > 0));
  } catch (err) {
    console.warn('[Database] updateUserPassword error:', err.message);
  }
  return updated;
}

async function loadMasterDocuments() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [masterDocs] = await pool.query(
      'SELECT Document_Id, Document_Name, Document_Type_Id FROM document WHERE DeleteStatus = 0 ORDER BY Document_Id ASC'
    );
    return masterDocs || [];
  } catch (err) {
    console.warn('[Database] loadMasterDocuments error:', err.message);
    return [];
  }
}

async function ensureMasterDocument(docId, docName, docTypeId = 1) {
  const pool = getPool();
  if (!pool || !docId) return false;
  try {
    await pool.query(
      'INSERT INTO document (Document_Id, Document_Name, Document_Type_Id, DeleteStatus) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE Document_Name=VALUES(Document_Name), DeleteStatus=0',
      [docId, docName, docTypeId]
    );
    return true;
  } catch (err) {
    console.warn('[Database] ensureMasterDocument error:', err.message);
    return false;
  }
}

async function getStudentUploadedDocuments(studentCode, legacyNumId = null) {
  const pool = getPool();
  if (!pool || !studentCode) return [];
  const cleanCode = String(studentCode).trim();
  const numPart = cleanCode.replace(/\D/g, '');

  try {
    const targets = new Set();
    if (numPart) {
      targets.add(Number(numPart));
    } else {
      targets.add(cleanCode);
    }
    if (legacyNumId && !isNaN(Number(legacyNumId))) {
      targets.add(Number(legacyNumId));
    }

    const targetList = Array.from(targets);
    const placeholders = targetList.map(() => '?').join(' OR Student_Id = ');
    const query = `SELECT * FROM student_document WHERE (Student_Id = ${placeholders}) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id ASC`;

    const [stuDocs] = await pool.query(query, targetList);
    return stuDocs || [];
  } catch (err) {
    console.warn('[Database] getStudentUploadedDocuments error:', err.message);
    return [];
  }
}

async function loadAllActiveStudentDocuments() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT * FROM student_document WHERE DeleteStatus = 0 OR DeleteStatus IS NULL ORDER BY Student_Document_Id ASC'
    );
    return rows || [];
  } catch (err) {
    console.warn('[Database] loadAllActiveStudentDocuments error:', err.message);
    return [];
  }
}

async function insertStudentDocument(studentCode, fileName, docId, docName, driveLink, notes = '', assignedStaff = null, verificationStatus = 0) {
  const pool = getPool();
  if (!pool || !studentCode) return null;
  const cleanStudentNum = String(studentCode).replace(/\D/g, '');
  const cleanStudent = cleanStudentNum ? Number(cleanStudentNum) : String(studentCode).replace(/^u-/, '').trim();
  const cleanStaffNum = assignedStaff ? String(assignedStaff).replace(/\D/g, '') : null;
  const cleanStaff = cleanStaffNum ? Number(cleanStaffNum) : (assignedStaff || null);
  try {
    const [res] = await pool.query(`
      INSERT INTO student_document (
        Student_Id, Entry_date, File_Name, Document_Id, Document_Name, Image, Description, DeleteStatus, Assigned_Staff, Verification_Status
      ) VALUES (?, NOW(), ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      cleanStudent,
      fileName,
      docId,
      docName,
      driveLink,
      notes || '',
      cleanStaff,
      verificationStatus !== undefined && verificationStatus !== null ? Number(verificationStatus) : 0
    ]);
    return res?.insertId || null;
  } catch (err) {
    console.warn('[Database] insertStudentDocument error:', err.message);
    return null;
  }
}

async function getActiveStudentDocumentIds(studentCode, legacyNumId, docId) {
  const pool = getPool();
  if (!pool || !studentCode) return [];
  const cleanStudentNum = String(studentCode).replace(/\D/g, '');
  const cleanId = cleanStudentNum ? Number(cleanStudentNum) : String(studentCode).replace(/^u-/, '').trim();
  try {
    const [rows] = await pool.query(
      'SELECT Student_Document_Id FROM student_document WHERE Student_Id = ? AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id ASC',
      [cleanId, Number(docId)]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Database] getActiveStudentDocumentIds error:', err.message);
    return [];
  }
}

async function softDeleteStudentDocumentById(studentDocumentId) {
  const pool = getPool();
  if (!pool || !studentDocumentId) return false;
  try {
    await pool.query('UPDATE student_document SET DeleteStatus = 1 WHERE Student_Document_Id = ?', [studentDocumentId]);
    return true;
  } catch (err) {
    console.warn('[Database] softDeleteStudentDocumentById error:', err.message);
    return false;
  }
}

async function softDeleteAllStudentDocuments(studentCode, legacyNumId, docId) {
  const pool = getPool();
  if (!pool || !studentCode) return false;
  const cleanStudentNum = String(studentCode).replace(/\D/g, '');
  const cleanId = cleanStudentNum ? Number(cleanStudentNum) : String(studentCode).replace(/^u-/, '').trim();
  try {
    await pool.query(
      'UPDATE student_document SET DeleteStatus = 1 WHERE Student_Id = ? AND Document_Id = ?',
      [cleanId, Number(docId)]
    );
    return true;
  } catch (err) {
    console.warn('[Database] softDeleteAllStudentDocuments error:', err.message);
    return false;
  }
}

async function updateStudentDocumentVerificationStatus(studentIdOrDocId, docIdOrStatus, statusOrReason, rejectionReason = null, studentDocumentId = null) {
  const pool = getPool();
  if (!pool) return false;

  if (typeof studentIdOrDocId === 'number' && typeof docIdOrStatus === 'number' && (studentDocumentId === null || studentDocumentId === undefined)) {
    const sDocId = studentIdOrDocId;
    const vStatus = Number(docIdOrStatus) || 0;
    const reason = vStatus === 2 ? (statusOrReason ? String(statusOrReason).trim() : null) : null;
    try {
      await pool.query(
        'UPDATE student_document SET Verification_Status = ?, rejection_reason = ? WHERE Student_Document_Id = ?',
        [vStatus, reason, sDocId]
      );
      return true;
    } catch (err) {
      console.warn('[Database] updateStudentDocumentVerificationStatus error:', err.message);
      return false;
    }
  }

  const studentId = studentIdOrDocId;
  const docId = docIdOrStatus;
  const status = statusOrReason;
  const cleanStudentNum = String(studentId).replace(/\D/g, '');
  const cleanId = cleanStudentNum ? Number(cleanStudentNum) : String(studentId).replace(/^u-/, '').trim();
  const vStatus = Number(status) || 0;
  const reasonVal = vStatus === 2 ? (rejectionReason ? String(rejectionReason).trim() : null) : null;

  try {
    if (studentDocumentId) {
      const [res] = await pool.query(
        'UPDATE student_document SET Verification_Status = ?, rejection_reason = ? WHERE Student_Document_Id = ? AND Student_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
        [vStatus, reasonVal, Number(studentDocumentId), cleanId]
      );
      return Boolean(res && res.affectedRows > 0);
    } else {
      const [res] = await pool.query(
        'UPDATE student_document SET Verification_Status = ?, rejection_reason = ? WHERE Student_Id = ? AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id DESC LIMIT 1',
        [vStatus, reasonVal, cleanId, Number(docId)]
      );
      return Boolean(res && res.affectedRows > 0);
    }
  } catch (err) {
    console.warn('[Database] updateStudentDocumentVerificationStatus error:', err.message);
    return false;
  }
}

async function updateStudentDocumentStaff(studentCode, staffUserId) {
  const pool = getPool();
  if (!pool || !studentCode || !staffUserId) return false;
  const cleanStudentNum = String(studentCode).replace(/\D/g, '');
  const cleanStudent = cleanStudentNum ? Number(cleanStudentNum) : String(studentCode).replace(/^u-/, '').trim();
  const cleanStaff = Number(staffUserId);
  try {
    await pool.query(
      'UPDATE student_document SET Assigned_Staff = ? WHERE Student_Id = ? AND (Assigned_Staff IS NULL OR Assigned_Staff = 0)',
      [cleanStaff, cleanStudent]
    );
    return true;
  } catch (err) {
    console.warn('[Database] updateStudentDocumentStaff error:', err.message);
    return false;
  }
}

async function updateUserDriveFolder(userId, folderId, folderName) {
  return true;
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected,
  updateUserDriveFolder,

  // Auth queries
  findUserByIdentifier,
  updateUserPassword,

  // Student queries
  get loadActiveStudents() { return require('../modules/students/student.repository').loadActiveStudents; },
  get updateStudentDetails() { return require('../modules/students/student.repository').updateStudentDetails; },
  get getFollowupUserByStudentAndDept() { return require('../modules/students/student.repository').getFollowupUserByStudentAndDept; },
  get upsertStudent() { return require('../modules/students/student.repository').upsertStudent; },

  // Document queries (integrated directly)
  loadMasterDocuments,
  ensureMasterDocument,
  getStudentUploadedDocuments,
  loadAllActiveStudentDocuments,
  insertStudentDocument,
  getActiveStudentDocumentIds,
  softDeleteStudentDocumentById,
  softDeleteAllStudentDocuments,
  updateStudentDocumentVerificationStatus,
  updateStudentDocumentStaff
};

