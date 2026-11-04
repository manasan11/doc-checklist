const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '49.13.118.79',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'TrackB0xPa$$w0rd',
      database: process.env.DB_NAME || 'trackbox_ysquare_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      connectTimeout: 20000,
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
    const dbName = process.env.DB_NAME || 'trackbox_ysquare_db';
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
 * Find user by email, username, Student_Id, or Unique_Id in student table.
 */
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
        studentCode: studentCode
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
    console.warn('[DB Query] getStudentUploadedDocuments error:', err.message);
    return [];
  }
}

/**
 * Bulk load all active student documents in a single query for fast startup.
 */
async function loadAllActiveStudentDocuments() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      'SELECT * FROM student_document WHERE DeleteStatus = 0 OR DeleteStatus IS NULL ORDER BY Student_Document_Id ASC'
    );
    return rows || [];
  } catch (err) {
    console.warn('[DB Query] loadAllActiveStudentDocuments error:', err.message);
    return [];
  }
}

/**
 * Insert a newly uploaded or re-uploaded document into student_document table.
 */
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
  const cleanStudentNum = String(studentCode).replace(/\D/g, '');
  const cleanId = cleanStudentNum ? Number(cleanStudentNum) : String(studentCode).replace(/^u-/, '').trim();
  try {
    const [rows] = await pool.query(
      'SELECT Student_Document_Id FROM student_document WHERE Student_Id = ? AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id ASC',
      [cleanId, Number(docId)]
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

/**
 * Update student profile details directly in MySQL student table.
 */
async function updateStudentDetails(studentId, { name, email, username, phone, department, password } = {}) {
  const pool = getPool();
  if (!pool || !studentId) return false;
  const cleanId = String(studentId).replace(/^u-/, '').trim();
  const sets = [];
  const params = [];

  if (name !== undefined) {
    sets.push('Student_Name = ?');
    params.push(String(name).trim());
  }
  if (email !== undefined) {
    sets.push('Email = ?');
    params.push(String(email).trim());
  }
  if (username !== undefined) {
    sets.push('Username = ?');
    params.push(String(username).trim());
  }
  if (phone !== undefined) {
    sets.push('Phone_Number = ?');
    params.push(String(phone).trim());
  }
  if (department !== undefined) {
    sets.push('Proceeding_Course_Name = ?');
    params.push(String(department).trim());
  }
  if (password !== undefined && password) {
    sets.push('Password = ?');
    params.push(String(password).trim());
  }

  if (sets.length === 0) return true;

  params.push(cleanId, cleanId);
  try {
    const [res] = await pool.query(
      `UPDATE student SET ${sets.join(', ')} WHERE (Student_Id = ? OR Unique_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)`,
      params
    );
    return Boolean(res && (res.affectedRows > 0 || res.changedRows >= 0));
  } catch (err) {
    console.warn('[DB Query] updateStudentDetails error:', err.message);
    return false;
  }
}

/**
 * Fetch followup record by Student_Id and Dept_Id, retrieving the assigned User_Id.
 */
async function getFollowupUserByStudentAndDept(studentId, deptId = null) {
  const pool = getPool();
  if (!pool || !studentId) return null;
  const cleanStudent = String(studentId).replace(/^u-/, '').trim();
  const cleanDept = deptId ? String(deptId).trim() : null;

  try {
    let query = 'SELECT Student_FollowUp_Id, Student_Id, Department, Dept_Name, User_Id, UserName, Entry_date FROM student_followup WHERE Student_Id = ?';
    const params = [cleanStudent];
    if (cleanDept) {
      query += ' AND (Department = ? OR Dept_Name = ?)';
      params.push(cleanDept, cleanDept);
    }
    query += ' AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Entry_date DESC, Student_FollowUp_Id DESC LIMIT 1';

    const [rows] = await pool.query(query, params);
    if (rows && rows.length > 0) {
      return rows[0];
    }
    // If specific deptId had no exact match, return latest active followup for that student
    if (cleanDept) {
      const [fallbackRows] = await pool.query(
        'SELECT Student_FollowUp_Id, Student_Id, Department, Dept_Name, User_Id, UserName, Entry_date FROM student_followup WHERE Student_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Entry_date DESC, Student_FollowUp_Id DESC LIMIT 1',
        [cleanStudent]
      );
      if (fallbackRows && fallbackRows.length > 0) return fallbackRows[0];
    }
    return null;
  } catch (err) {
    console.warn('[DB Query] getFollowupUserByStudentAndDept error:', err.message);
    return null;
  }
}

/**
 * Update Assigned_Staff in student_document table for a student.
 */
async function updateStudentDocumentStaff(studentId, staffId) {
  const pool = getPool();
  if (!pool || !studentId || !staffId) return false;
  const cleanStudentNum = String(studentId).replace(/\D/g, '');
  const cleanStaffNum = String(staffId).replace(/\D/g, '');
  const cleanId = cleanStudentNum ? Number(cleanStudentNum) : String(studentId).replace(/^u-/, '').trim();
  const cleanStaff = cleanStaffNum ? Number(cleanStaffNum) : (staffId || null);
  try {
    const [res] = await pool.query(
      'UPDATE student_document SET Assigned_Staff = ? WHERE Student_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
      [cleanStaff, cleanId]
    );
    return Boolean(res && res.affectedRows > 0);
  } catch (err) {
    console.warn('[DB Query] updateStudentDocumentStaff error:', err.message);
    return false;
  }
}

/**
 * Update Verification_Status in student_document table.
 * Supports updating a specific version by Student_Document_Id or the latest version by Document_Id.
 * 0: Pending, 1: Approved, 2: Rejected
 */
async function updateStudentDocumentVerificationStatus(studentId, docId, status, rejectionReason = null, studentDocumentId = null) {
  const pool = getPool();
  if (!pool || !studentId) return false;
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
    console.warn('[DB Query] updateStudentDocumentVerificationStatus error:', err.message);
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
  updateStudentDetails,
  getFollowupUserByStudentAndDept,
  updateStudentDocumentStaff,
  updateStudentDocumentVerificationStatus,
  updateUserDriveFolder,
  loadActiveStudents,
  loadAllActiveStudentDocuments,
  loadMasterDocuments,
  ensureMasterDocument,
  getStudentUploadedDocuments,
  insertStudentDocument,
  getActiveStudentDocumentIds,
  softDeleteStudentDocumentById,
  softDeleteAllStudentDocuments,
  upsertStudent
};
