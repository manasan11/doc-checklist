const path = require('path');
const fs = require('fs');
const driveService = require('../../services/drive/drive.service');
const dataStore = require('../../dataStore');
const driveConfig = require('../../config/drive.config');
const { ensureUserDriveFolder } = require('../documents/document.service');
const { convertDocxBufferToHtml, convertDocxFileToHtml } = require('../../services/viewer/docx.service');
const { renderDocumentPage } = require('../../services/viewer/viewer.template');
const { getMimeTypeByExtension } = require('../../common/utils');

function getStatus() {
  return driveService.getDriveStatus();
}

async function listFiles(folderId) {
  return await driveService.listFiles(folderId);
}

async function syncFiles(targetUserId) {
  const driveList = await driveService.listFiles();
  const syncResult = dataStore.syncGoogleDriveFiles(targetUserId, driveList.files || []);
  return {
    syncResult,
    driveList
  };
}

async function syncAllStudentFolders() {
  const users = dataStore.data.users || [];
  let count = 0;
  for (const u of users) {
    if (u.role === 'admin') continue;
    try {
      await ensureUserDriveFolder(u);
      count++;
    } catch (e) {
      console.warn(`[Google Drive] Could not verify folder for ${u.name}:`, e.message);
    }
  }

  const students = (dataStore.data.users || [])
    .filter(u => u.role !== 'admin')
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      studentCode: u.studentCode,
      driveFolderId: u.driveFolderId,
      driveFolderName: u.driveFolderName,
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

