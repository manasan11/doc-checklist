const dataStore = require('../../dataStore');
const driveService = require('../../services/drive/drive.service');
const studentRepo = require('../students/student.repository');
const { generateFilenameFromDocType } = require('../../common/utils');
const db = require('../../config/database');

async function ensureUserDriveFolder(user) {
  if (!user || user.role === 'admin') {
    return { folderId: null, folderName: null };
  }

  dataStore.ensureStudentCode(user);
  const expectedFolderName = dataStore.getStudentFolderSlug(user);

  let folderId = user.driveFolderId;
  let folderName = user.driveFolderName || expectedFolderName;

  if (user.driveFolderVerified && folderId && !folderId.startsWith('gdrive_') && !folderId.startsWith('local_')) {
    return { folderId, folderName };
  }

  let needsCreation = false;

  if (!folderId || folderId.startsWith('gdrive_') || folderId.startsWith('local_')) {
    needsCreation = true;
  } else {
    const isShared = (dataStore.data.users || []).some(
      u => u.id !== user.id && u.driveFolderId === folderId
    );
    if (isShared) {
      console.warn(`[Google Drive] Notice: Folder ID ${folderId} for ${user.name} is shared. Creating distinct folder...`);
      needsCreation = true;
    } else {
      const exists = await driveService.verifyFolderExists(folderId);
      if (!exists) {
        needsCreation = true;
      }
    }
  }

  if (needsCreation) {
    console.log(`[Google Drive] Auto-creating dedicated Drive folder: "${expectedFolderName}" for user ${user.name}...`);
    const folderResult = await driveService.getOrCreateStudentFolder(expectedFolderName);
    if (folderResult && folderResult.folderId && !folderResult.folderId.startsWith('gdrive_')) {
      folderId = folderResult.folderId;
      folderName = folderResult.folderName || expectedFolderName;
      user.driveFolderId = folderId;
      user.driveFolderName = folderName;
      dataStore.setUserDriveFolder(user.id, folderId, folderName);
    }
  }

  user.driveFolderVerified = true;
  return { folderId, folderName };
}

async function getChecklist(targetUserId, studentIdParam, deptIdParam, syncDrive = false) {
  let followup = null;

  if (studentIdParam || deptIdParam) {
    try {
      const lookupStudent = studentIdParam || targetUserId;
      const fRecord = await studentRepo.getFollowupUserByStudentAndDept(lookupStudent, deptIdParam);
      if (fRecord) {
        followup = {
          studentFollowUpId: fRecord.Student_FollowUp_Id,
          studentId: fRecord.Student_Id,
          departmentId: fRecord.Department,
          departmentName: fRecord.Dept_Name,
          userId: fRecord.User_Id,
          userName: fRecord.UserName,
          entryDate: fRecord.Entry_date
        };
      }
    } catch (fErr) {
      console.warn('[Followup Lookup Notice]:', fErr.message);
    }
  }

  if (syncDrive) {
    try {
      const driveList = await driveService.listFiles();
      if (driveList && driveList.files) {
        dataStore.syncGoogleDriveFiles(targetUserId, driveList.files);
      }
    } catch (syncErr) {
      console.warn('[Sync Notice]:', syncErr.message);
    }
  }

  const documents = await dataStore.getOrLoadUserDocuments(targetUserId);

  return {
    userId: targetUserId,
    studentId: studentIdParam || String(targetUserId).replace(/^u-/, ''),
    associatedUserId: followup ? followup.userId : null,
    associatedUserName: followup ? followup.userName : null,
    followup,
    totalDocuments: documents.length,
    uploadedCount: documents.filter(d => d.uploadStatus === 'Uploaded').length,
    approvedCount: documents.filter(d => d.approvalStatus === 'Approved').length,
    pendingCount: documents.filter(d => d.uploadStatus === 'Uploaded' && d.approvalStatus === 'Pending').length,
    rejectedCount: documents.filter(d => d.approvalStatus === 'Rejected').length,
    documents
  };
}

async function getFollowupDocuments(studentId, deptId) {
  const cleanStudentCode = String(studentId).replace(/^u-/, '').trim();
  const followupRecord = await studentRepo.getFollowupUserByStudentAndDept(cleanStudentCode, deptId);

  const associatedUserId = followupRecord ? followupRecord.User_Id : null;
  const associatedUserName = followupRecord ? followupRecord.UserName : null;

  if (associatedUserId && db.updateStudentDocumentStaff) {
    try {
      await db.updateStudentDocumentStaff(cleanStudentCode, associatedUserId);
    } catch (_) {}
  }

  const targetUserId = `u-${cleanStudentCode}`;
  const documents = await dataStore.getOrLoadUserDocuments(targetUserId);

  return {
    studentId: cleanStudentCode,
    deptId: deptId || (followupRecord ? followupRecord.Department : null),
    associatedUserId,
    associatedUserName,
    followupRecord: followupRecord ? {
      studentFollowUpId: followupRecord.Student_FollowUp_Id,
      studentId: followupRecord.Student_Id,
      departmentId: followupRecord.Department,
      departmentName: followupRecord.Dept_Name,
      userId: followupRecord.User_Id,
      userName: followupRecord.UserName,
      entryDate: followupRecord.Entry_date
    } : null,
    totalDocuments: documents.length,
    uploadedCount: documents.filter(d => d.uploadStatus === 'Uploaded').length,
    approvedCount: documents.filter(d => d.approvalStatus === 'Approved').length,
    pendingCount: documents.filter(d => d.uploadStatus === 'Uploaded' && d.approvalStatus === 'Pending').length,
    rejectedCount: documents.filter(d => d.approvalStatus === 'Rejected').length,
    documents
  };
}

function getAllDocuments() {
  return dataStore.getAllUsersWithDocuments();
}

function getDocumentById(userId, docId) {
  return dataStore.getDocumentById(userId, docId);
}

async function processDocumentUpload({ rawDocId, targetUserId, userNotes, requestedDocType, file }) {
  const user = await dataStore.findOrLoadUser(targetUserId);
  if (!user) {
    return { error: 'User account not found', status: 404 };
  }

  if (!user.documents || user.documents.length === 0) {
    await dataStore.getOrLoadUserDocuments(targetUserId);
  }

  let existingDoc = null;
  if (rawDocId && !isNaN(rawDocId)) {
    existingDoc = dataStore.getDocumentById(targetUserId, rawDocId);
  }
  if (!existingDoc && requestedDocType) {
    existingDoc = (user.documents || []).find(d => 
      (d.name || '').trim().toLowerCase() === requestedDocType.toLowerCase()
    );
  }

  const effectiveDocType = requestedDocType || (existingDoc ? existingDoc.name : 'Document');

  if (existingDoc && existingDoc.permissions && !existingDoc.permissions.canUpload) {
    return {
      error: 'Upload not permitted. This document is currently locked or approved.',
      permissions: existingDoc.permissions,
      status: 403
    };
  }

  const finalFileName = generateFilenameFromDocType(effectiveDocType, file.originalname);
  console.log(`[Dynamic File Renaming] "${file.originalname}" -> "${finalFileName}" (Document Type: "${effectiveDocType}")`);

  const folderInfo = await ensureUserDriveFolder(user);
  const studentFolderId = folderInfo.folderId;
  const studentFolderName = folderInfo.folderName;

  const driveResult = await driveService.uploadFile({
    originalname: file.originalname,
    targetFileName: finalFileName,
    mimetype: file.mimetype,
    buffer: file.buffer,
    size: file.size,
    folderId: studentFolderId,
    studentFolderName
  });

  driveResult.fileName = finalFileName;

  if ((!user.driveFolderId || user.driveFolderId.startsWith('gdrive_')) && driveResult.folderId && !driveResult.folderId.startsWith('gdrive_') && driveResult.folderId !== driveService.folderId) {
    dataStore.setUserDriveFolder(targetUserId, driveResult.folderId, studentFolderName);
  }

  const targetDocId = existingDoc ? existingDoc.id : rawDocId;
  const updatedDoc = await dataStore.saveDocumentUpload(
    targetUserId, 
    targetDocId, 
    driveResult, 
    userNotes, 
    effectiveDocType
  );

  return {
    message: `Document "${effectiveDocType}" uploaded successfully as "${finalFileName}" into folder "${studentFolderName || 'Document'}"`,
    document: updatedDoc,
    generatedFileName: finalFileName,
    documentType: effectiveDocType,
    studentFolder: {
      id: studentFolderId,
      name: studentFolderName
    }
  };
}

function updateMetadata(userId, docId, updates) {
  return dataStore.updateDocumentMetadata(userId, docId, updates);
}

function reviewDocument(targetUserId, docId, reviewData) {
  return dataStore.adminReviewDocument(targetUserId, docId, reviewData);
}

async function deleteDocument(targetUserId, docId, versionNumber) {
  return await dataStore.deleteDocument(targetUserId, docId, versionNumber);
}

module.exports = {
  ensureUserDriveFolder,
  getChecklist,
  getFollowupDocuments,
  getAllDocuments,
  getDocumentById,
  processDocumentUpload,
  updateMetadata,
  reviewDocument,
  deleteDocument
};

