const path = require('path');
const fs = require('fs');
const driveService = require('../../services/drive.service');
const driveConfig = require('../../config/drive.config');
const documentService = require('../documents/document.service');
const authService = require('../auth/auth.service');
const studentService = require('../students/student.service');
const { convertDocxBufferToHtml, convertDocxFileToHtml, renderDocumentPage } = require('../../services/docx.service');

function getStatus() {
  return driveService.getDriveStatus();
}

async function listFiles(folderId) {
  return await driveService.listFiles(folderId);
}

async function syncFiles(targetUserId) {
  const driveList = await driveService.listFiles();
  const syncResult = documentService.syncGoogleDriveFiles(targetUserId, driveList.files || []);
  return {
    syncResult,
    driveList
  };
}

async function syncAllStudentFolders() {
  const allStudents = await studentService.getAllStudents();
  let count = 0;
  for (const s of allStudents) {
    try {
      const u = authService.findUserById(s.id) || await authService.findOrLoadUser(s.id);
      if (u) {
        await documentService.ensureUserDriveFolder(u);
        count++;
      }
    } catch (e) {
      console.warn(`[Google Drive] Could not verify folder for ${s.name}:`, e.message);
    }
  }

  const students = allStudents.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    studentCode: u.studentCode,
    driveFolderId: u.driveFolderId || null,
    driveFolderName: u.driveFolderName || null,
    folderUrl: u.driveFolderId ? `https://drive.google.com/drive/folders/${u.driveFolderId}` : null
  }));

  return {
    count,
    students
  };
}

module.exports = {
  getStatus,
  listFiles,
  syncFiles,
  syncAllStudentFolders
};
