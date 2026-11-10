const { getPool, initDatabase, isDbConnected } = require('./src/config/database');
const authRepo = require('./src/modules/auth/auth.repository');
const studentRepo = require('./src/modules/students/student.repository');
const docRepo = require('./src/modules/documents/document.repository');

async function updateUserDriveFolder(userId, folderId, folderName) {
  return true;
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected,

  // Auth queries
  findUserByIdentifier: authRepo.findUserByIdentifier,
  updateUserPassword: authRepo.updateUserPassword,

  // Student queries
  loadActiveStudents: studentRepo.loadActiveStudents,
  updateStudentDetails: studentRepo.updateStudentDetails,
  getFollowupUserByStudentAndDept: studentRepo.getFollowupUserByStudentAndDept,
  upsertStudent: studentRepo.upsertStudent,
  updateUserDriveFolder,

  // Document queries
  loadMasterDocuments: docRepo.loadMasterDocuments,
  ensureMasterDocument: docRepo.ensureMasterDocument,
  getStudentUploadedDocuments: docRepo.getStudentUploadedDocuments,
  loadAllActiveStudentDocuments: docRepo.loadAllActiveStudentDocuments,
  insertStudentDocument: docRepo.insertStudentDocument,
  getActiveStudentDocumentIds: docRepo.getActiveStudentDocumentIds,
  softDeleteStudentDocumentById: docRepo.softDeleteStudentDocumentById,
  softDeleteAllStudentDocuments: docRepo.softDeleteAllStudentDocuments,
  updateStudentDocumentVerificationStatus: docRepo.updateStudentDocumentVerificationStatus,
  updateStudentDocumentStaff: docRepo.updateStudentDocumentStaff
};
