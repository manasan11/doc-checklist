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

async function updateUserDriveFolder(userId, folderId, folderName) {
  return true;
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected,
  updateUserDriveFolder,

  // Auth queries (integrated directly)
  findUserByIdentifier,
  updateUserPassword,

  // Student queries
  get loadActiveStudents() { return require('../modules/students/student.repository').loadActiveStudents; },
  get updateStudentDetails() { return require('../modules/students/student.repository').updateStudentDetails; },
  get getFollowupUserByStudentAndDept() { return require('../modules/students/student.repository').getFollowupUserByStudentAndDept; },
  get upsertStudent() { return require('../modules/students/student.repository').upsertStudent; },

  // Document queries
  get loadMasterDocuments() { return require('../modules/documents/document.repository').loadMasterDocuments; },
  get ensureMasterDocument() { return require('../modules/documents/document.repository').ensureMasterDocument; },
  get getStudentUploadedDocuments() { return require('../modules/documents/document.repository').getStudentUploadedDocuments; },
  get loadAllActiveStudentDocuments() { return require('../modules/documents/document.repository').loadAllActiveStudentDocuments; },
  get insertStudentDocument() { return require('../modules/documents/document.repository').insertStudentDocument; },
  get getActiveStudentDocumentIds() { return require('../modules/documents/document.repository').getActiveStudentDocumentIds; },
  get softDeleteStudentDocumentById() { return require('../modules/documents/document.repository').softDeleteStudentDocumentById; },
  get softDeleteAllStudentDocuments() { return require('../modules/documents/document.repository').softDeleteAllStudentDocuments; },
  get updateStudentDocumentVerificationStatus() { return require('../modules/documents/document.repository').updateStudentDocumentVerificationStatus; },
  get updateStudentDocumentStaff() { return require('../modules/documents/document.repository').updateStudentDocumentStaff; }
};

