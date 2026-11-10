const { getPool } = require('../../config/database');

async function loadMasterDocuments() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const [masterDocs] = await pool.query(
      'SELECT Document_Id, Document_Name, Document_Type_Id FROM document WHERE DeleteStatus = 0 ORDER BY Document_Id ASC'
    );
    return masterDocs || [];
  } catch (err) {
    console.warn('[DocRepository] loadMasterDocuments error:', err.message);
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
    console.warn('[DocRepository] ensureMasterDocument error:', err.message);
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
    console.warn('[DocRepository] getStudentUploadedDocuments error:', err.message);
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
    console.warn('[DocRepository] loadAllActiveStudentDocuments error:', err.message);
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
    console.warn('[DocRepository] insertStudentDocument error:', err.message);
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
    console.warn('[DocRepository] getActiveStudentDocumentIds error:', err.message);
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
    console.warn('[DocRepository] softDeleteStudentDocumentById error:', err.message);
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
    console.warn('[DocRepository] softDeleteAllStudentDocuments error:', err.message);
    return false;
  }
}

async function updateStudentDocumentVerificationStatus(studentIdOrDocId, docIdOrStatus, statusOrReason, rejectionReason = null, studentDocumentId = null) {
  const pool = getPool();
  if (!pool) return false;

  // Support direct signature: updateStudentDocumentVerificationStatus(studentDocumentId, verificationStatus, rejectionReason)
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
      console.warn('[DocRepository] updateStudentDocumentVerificationStatus error:', err.message);
      return false;
    }
  }

  // Support full signature: (studentId, docId, status, rejectionReason, studentDocumentId)
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
    console.warn('[DocRepository] updateStudentDocumentVerificationStatus error:', err.message);
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
    console.warn('[DocRepository] updateStudentDocumentStaff error:', err.message);
    return false;
  }
}

module.exports = {
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
