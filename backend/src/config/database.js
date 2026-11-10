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

async function updateUserDriveFolder(userId, folderId, folderName) {
  return true;
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected,
  updateUserDriveFolder,

  // Auth queries (lazy loaded to prevent circular dependencies)
  get findUserByIdentifier() { return require('../modules/auth/auth.repository').findUserByIdentifier; },
  get updateUserPassword() { return require('../modules/auth/auth.repository').updateUserPassword; },

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

