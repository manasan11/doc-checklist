const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'Password',
      database: process.env.DB_NAME || 'doc_checklist',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
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
    const dbName = process.env.DB_NAME || 'doc_checklist';
    console.log(`[MySQL] Connected successfully to database: "${dbName}"`);
    return true;
  } catch (err) {
    isConnected = false;
    console.error('[MySQL] Connection warning:', err.message);
    return false;
  }
}

// ============================================================================
// STORED DATABASE QUERIES & DATA ACCESS METHODS
// ============================================================================

/**
 * Find user by email, username, or Student_Id in student table.
 */
async function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  const pool = getPool();
  if (!pool) return null;
  const clean = String(identifier).trim();
  const cleanLower = clean.toLowerCase();

  try {
    const [stuRows] = await pool.query(
      'SELECT * FROM student WHERE (LOWER(TRIM(Username)) = ? OR LOWER(TRIM(Email)) = ? OR Student_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL) LIMIT 1',
      [cleanLower, cleanLower, clean]
    );
    if (stuRows && stuRows.length > 0) {
      const s = stuRows[0];
      return {
        id: `u-${s.Student_Id}`,
        email: s.Email,
        username: s.Username || s.Email,
        name: s.Student_Name,
        password: s.Password,
        role: 'user',
        department: s.Proceeding_Course_Name || 'General Operations',
        studentCode: s.Student_Id
      };
    }
  } catch (err) {
    console.warn('[DB Query] findUserByIdentifier error:', err.message);
  }
  return null;
}

/**
 * Update user password in student table.
 */
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
    console.warn('[DB Query] updateUserPassword error:', err.message);
  }
  return updated;
}

/**
 * Update dedicated Google Drive folder for a user.
 */
async function updateUserDriveFolder(userId, folderId, folderName) {
  return true;
}

/**
 * Load all active students from MySQL.
 */
async function loadActiveStudents() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [students] = await pool.query(
      'SELECT Student_Id, Student_Name, Email, Username, Password, Unique_Id, Proceeding_Course_Name FROM student WHERE DeleteStatus = 0 OR DeleteStatus IS NULL'
    );
    return students || [];
  } catch (err) {
    console.warn('[DB Query] loadActiveStudents error:', err.message);
    return [];
  }
}

/**
 * Load master documents from MySQL catalog.
 */
async function loadMasterDocuments() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [masterDocs] = await pool.query(
      'SELECT Document_Id, Document_Name, Document_Type_Id FROM document WHERE DeleteStatus = 0 ORDER BY Document_Id ASC'
    );
    return masterDocs || [];
  } catch (err) {
    console.warn('[DB Query] loadMasterDocuments error:', err.message);
    return [];
  }
}

/**
 * Ensure master document exists in document table.
 */
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
    console.warn('[DB Query] ensureMasterDocument error:', err.message);
    return false;
  }
}

/**
 * Fetch all uploaded documents for a student from student_document table.
 */
async function getStudentUploadedDocuments(studentCode, legacyNumId = null) {
  const pool = getPool();
  if (!pool || !studentCode) return [];
  try {
    const [stuDocs] = await pool.query(
      'SELECT * FROM student_document WHERE Student_Id = ? OR Student_Id = ? ORDER BY Student_Document_Id ASC',
      [studentCode, legacyNumId ? String(legacyNumId) : studentCode]
    );
    return stuDocs || [];
  } catch (err) {
    console.warn('[DB Query] getStudentUploadedDocuments error:', err.message);
    return [];
  }
}

/**
 * Insert a newly uploaded or re-uploaded document into student_document table.
 */
async function insertStudentDocument(studentCode, fileName, docId, docName, driveLink, notes = '') {
  const pool = getPool();
  if (!pool || !studentCode) return null;
  try {
    const [res] = await pool.query(`
      INSERT INTO student_document (
        Student_Id, Entry_date, File_Name, Document_Id, Document_Name, Image, Description, DeleteStatus
      ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, 0)
    `, [
      studentCode,
      fileName,
      docId,
      docName,
      driveLink,
      notes || ''
    ]);
    return res?.insertId || null;
  } catch (err) {
    console.warn('[DB Query] insertStudentDocument error:', err.message);
    return null;
  }
}

/**
 * Get active student_document records for a specific Document_Id.
 */
async function getActiveStudentDocumentIds(studentCode, legacyNumId, docId) {
  const pool = getPool();
  if (!pool || !studentCode) return [];
  try {
    const [rows] = await pool.query(
      'SELECT Student_Document_Id FROM student_document WHERE (Student_Id = ? OR Student_Id = ?) AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id ASC',
      [studentCode, legacyNumId ? String(legacyNumId) : studentCode, docId]
    );
    return rows || [];
  } catch (err) {
    console.warn('[DB Query] getActiveStudentDocumentIds error:', err.message);
    return [];
  }
}

/**
 * Soft delete a single student_document row by primary key (Student_Document_Id).
 */
async function softDeleteStudentDocumentById(studentDocumentId) {
  const pool = getPool();
  if (!pool || !studentDocumentId) return false;
  try {
    await pool.query('UPDATE student_document SET DeleteStatus = 1 WHERE Student_Document_Id = ?', [studentDocumentId]);
    return true;
  } catch (err) {
    console.warn('[DB Query] softDeleteStudentDocumentById error:', err.message);
    return false;
  }
}

/**
 * Soft delete all student_document records for a document under a student.
 */
async function softDeleteAllStudentDocuments(studentCode, legacyNumId, docId) {
  const pool = getPool();
  if (!pool || !studentCode) return false;
  try {
    await pool.query(
      'UPDATE student_document SET DeleteStatus = 1 WHERE (Student_Id = ? OR Student_Id = ?) AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
      [studentCode, legacyNumId ? String(legacyNumId) : studentCode, docId]
    );
    return true;
  } catch (err) {
    console.warn('[DB Query] softDeleteAllStudentDocuments error:', err.message);
    return false;
  }
}

/**
 * Upsert student into student table.
 */
async function upsertStudent(studentCode, name, email, username, password) {
  const pool = getPool();
  if (!pool || !studentCode) return false;
  try {
    await pool.query(`
      INSERT INTO student (Student_Id, Student_Name, Email, Username, Password, Unique_Id, Entry_date, DeleteStatus, Is_Registered)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 1)
      ON DUPLICATE KEY UPDATE
        Student_Name=VALUES(Student_Name),
        Email=VALUES(Email),
        Username=VALUES(Username),
        Password=COALESCE(student.Password, VALUES(Password)),
        Unique_Id=VALUES(Unique_Id),
        DeleteStatus=0,
        Is_Registered=1
    `, [studentCode, name, email, username, password, studentCode]);
    return true;
  } catch (err) {
    console.warn('[DB Query] upsertStudent error:', err.message);
    return false;
  }
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected: () => isConnected,

  // Stored Query Methods
  findUserByIdentifier,
  updateUserPassword,
  updateUserDriveFolder,
  loadActiveStudents,
  loadMasterDocuments,
  ensureMasterDocument,
  getStudentUploadedDocuments,
  insertStudentDocument,
  getActiveStudentDocumentIds,
  softDeleteStudentDocumentById,
  softDeleteAllStudentDocuments,
  upsertStudent
};
