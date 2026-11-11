const path = require('path');
const db = require('../../config/database');
const driveService = require('../../services/drive.service');
const authService = require('../auth/auth.service');

function toGoogleDriveViewUrl(urlOrPath, fallbackFileId = null) {
  if (!urlOrPath && !fallbackFileId) return '';
  const val = String(urlOrPath || '').trim();
  if (val.startsWith('https://drive.google.com/')) return val;
  const match = val.match(/\/api\/drive\/files\/([^\/]+)/);
  const fid = (match && match[1]) || fallbackFileId;
  if (fid && !fid.startsWith('local_') && !fid.startsWith('gdrive_')) {
    return `https://drive.google.com/file/d/${fid}/view`;
  }
  return val;
}

function formatUploadDateTime(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(val.trim())) {
    return val.trim();
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);

  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

  return `${day}/${month}/${year}, ${strTime}`;
}

const INITIAL_DOCUMENTS = [
  { id: 1, name: "Photos", description: "Recent passport-size and profile photographs" },
  { id: 2, name: "Intro Videos", description: "Short self-introduction video presentation" },
  { id: 3, name: "10th", description: "Secondary School Certificate (10th Standard / Matriculation)" },
  { id: 4, name: "Plus Two", description: "Higher Secondary Certificate (12th / Plus Two)" },
  { id: 5, name: "Language Certificates", description: "Certified German / English language proficiency certificates" },
  { id: 6, name: "Letter of Recommendation", description: "Official recommendation or reference letters" },
  { id: 7, name: "Childcare Reference", description: "Verified childcare experience certificate and reference" },
  { id: 8, name: "German CV", description: "Standard Europass / German format tabular CV (Lebenslauf)" },
  { id: 9, name: "Motivation Letter", description: "Personal statement of motivation (Anschreiben)" },
  { id: 10, name: "PCC", description: "Police Clearance Certificate (Criminal background check)" },
  { id: 11, name: "Medical", description: "Medical fitness certificate and health examination report" }
];

function createDefaultDocuments() {
  return INITIAL_DOCUMENTS.map(doc => ({
    id: doc.id,
    name: doc.name,
    description: doc.description,
    uploadStatus: "Upload Pending",
    approvalStatus: "Pending",
    isLocked: false,
    currentVersion: 0,
    uploadDateTime: null,
    driveFileId: null,
    fileName: null,
    savedFileName: null,
    fileSize: null,
    mimeType: null,
    webViewLink: null,
    downloadUrl: null,
    storageType: 'google_drive_cloud',
    notes: "",
    adminFeedback: "",
    versions: []
  }));
}

let masterDocTemplates = null;
let knownMasterDocIds = new Set();

async function getMasterDocTemplates() {
  if (masterDocTemplates && masterDocTemplates.length === INITIAL_DOCUMENTS.length) {
    return masterDocTemplates;
  }
  masterDocTemplates = createDefaultDocuments();
  knownMasterDocIds = new Set(masterDocTemplates.map(d => d.id));
  return masterDocTemplates;
}

function calculatePermissions(doc) {
  const isUploaded = doc.uploadStatus === "Uploaded";
  const approval = doc.approvalStatus;
  const isLocked = doc.isLocked;

  let canUpload = false;
  let canView = false;
  let canEdit = false;
  let canDelete = false;
  let uploadLabel = "Upload";

  if (!isUploaded) {
    canUpload = true;
    canView = false;
    canEdit = false;
    canDelete = false;
    uploadLabel = "Upload";
  } else {
    canView = true;
    if (!isLocked) {
      canUpload = true;
      canEdit = true;
      canDelete = true;
      uploadLabel = "Re-upload";
    } else {
      if (approval === "Rejected") {
        canUpload = true;
        canEdit = false;
        canDelete = false;
        uploadLabel = "Upload New Version";
      } else if (approval === "Approved") {
        canUpload = false;
        canEdit = false;
        canDelete = false;
        uploadLabel = "Locked (Approved)";
      } else {
        canUpload = false;
        canEdit = false;
        canDelete = false;
        uploadLabel = "Locked";
      }
    }
  }

  return {
    canUpload,
    canView,
    canEdit,
    canDelete,
    uploadLabel
  };
}

function matchDocumentTo11List(userDocs, docId, docName) {
  if (!userDocs || userDocs.length === 0) return null;
  const clean = String(docName || '').trim().toLowerCase();

  if (clean) {
    if (clean.includes('photo')) return userDocs.find(d => d.id === 1);
    if (clean.includes('intro video') || clean.includes('intro_video') || clean.includes('self-introduction')) return userDocs.find(d => d.id === 2);
    if (clean.includes('10th') || clean.includes('sslc') || clean.includes('matriculation') || clean.includes('secondary school')) return userDocs.find(d => d.id === 3);
    if (clean.includes('plus two') || clean.includes('plus_two') || clean.includes('12th') || clean.includes('higher secondary')) return userDocs.find(d => d.id === 4);
    if (clean.includes('language') || clean.includes('german language') || clean.includes('english language') || clean.includes('goethe') || clean.includes('telc')) return userDocs.find(d => d.id === 5);
    if (clean.includes('recommendation') || clean.includes('lor')) return userDocs.find(d => d.id === 6);
    if (clean.includes('childcare') || clean.includes('child care')) return userDocs.find(d => d.id === 7);
    if (clean.includes('cv') || clean.includes('lebenslauf') || clean.includes('resume')) return userDocs.find(d => d.id === 8);
    if (clean.includes('motivation') || clean.includes('anschreiben') || clean.includes('sop') || clean.includes('statement of purpose')) return userDocs.find(d => d.id === 9);
    if (clean.includes('pcc') || clean.includes('police clearance') || clean.includes('criminal background')) return userDocs.find(d => d.id === 10);
    if (clean.includes('medical') || clean.includes('health') || clean.includes('fitness')) return userDocs.find(d => d.id === 11);
  }

  const numId = parseInt(docId, 10);
  if (!isNaN(numId) && numId >= 1 && numId <= 11) {
    const match = userDocs.find(d => d.id === numId);
    if (match) return match;
  }

  return null;
}

function populateDocWithRecords(docItem, activeRecords) {
  if (!docItem || !activeRecords || activeRecords.length === 0) return;

  const sortedAsc = [...activeRecords].sort((a, b) => (a.Student_Document_Id || 0) - (b.Student_Document_Id || 0));

  const versions = sortedAsc.map((r, idx) => {
    const verDriveUrl = toGoogleDriveViewUrl(r.Image);
    const verIdMatch = (verDriveUrl || '').match(/\/file\/d\/([^\/]+)/);
    let verVStatus = 0;
    let verAStatus = 'Pending';
    if (r.Verification_Status !== undefined && r.Verification_Status !== null) {
      verVStatus = Number(r.Verification_Status);
      if (verVStatus === 1) verAStatus = 'Approved';
      else if (verVStatus === 2) verAStatus = 'Rejected';
      else verAStatus = 'Pending';
    }
    return {
      versionNumber: idx + 1,
      studentDocumentId: r.Student_Document_Id,
      fileName: r.File_Name || (r.Image ? path.basename(r.Image) : docItem.name),
      webViewLink: verDriveUrl,
      downloadUrl: verDriveUrl,
      driveFileId: verIdMatch ? verIdMatch[1] : null,
      notes: r.Description || '',
      uploadDateTime: r.Entry_date ? formatUploadDateTime(r.Entry_date) : null,
      verificationStatus: verVStatus,
      approvalStatus: verAStatus,
      rejectionReason: r.rejection_reason || ''
    };
  });

  const firstActive = versions[0];
  const latestActive = versions[versions.length - 1];

  docItem.uploadStatus = "Uploaded";
  docItem.approvalStatus = firstActive.approvalStatus;
  docItem.verificationStatus = firstActive.verificationStatus;
  docItem.isLocked = (firstActive.verificationStatus === 1);
  docItem.currentVersion = versions.length;
  docItem.uploadDateTime = firstActive.uploadDateTime;
  docItem.driveFileId = firstActive.driveFileId;
  docItem.fileName = firstActive.fileName;
  docItem.webViewLink = firstActive.webViewLink;
  docItem.downloadUrl = firstActive.downloadUrl;
  docItem.notes = firstActive.notes;
  docItem.rejectionReason = firstActive.rejectionReason;
  docItem.adminFeedback = firstActive.verificationStatus === 2 
    ? (firstActive.rejectionReason || docItem.adminFeedback || '') 
    : (docItem.adminFeedback || '');
  docItem.versions = versions;
  docItem.assignedStaff = latestActive?.assignedStaff || docItem.assignedStaff || null;
  docItem.staffName = latestActive?.staffName || docItem.staffName || null;
}

function ensureStudentCode(user) {
  if (!user) return '';
  if (!user.studentCode) {
    user.studentCode = user.id ? String(user.id).replace(/^u-/, '').trim() : '';
  }
  return user.studentCode;
}

function getStudentFolderSlug(user) {
  const code = ensureStudentCode(user);
  const cleanName = (user?.name || 'Student')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return code ? `${code}_${cleanName}` : cleanName;
}

function setUserDriveFolder(userId, folderId, folderName) {
  const user = authService.findUserById(userId);
  if (user) {
    user.driveFolderId = folderId;
    user.driveFolderName = folderName;
    try {
      const studentCode = user.studentCode || String(userId).replace(/^u-/, '').trim();
      db.updateUserDriveFolder(studentCode, folderId, folderName).catch(() => {});
    } catch (_) {}
  }
  return user;
}

async function getOrLoadUserDocuments(userId) {
  const user = await authService.findOrLoadUser(userId);
  if (!user) return [];

  const strId = String(userId || '');
  const studentCode = user.studentCode || strId.replace(/^u-/, '').trim();
  const legacyNumId = /^\d+$/.test(studentCode) ? parseInt(studentCode, 10) : null;

  try {
    const templates = await getMasterDocTemplates();
    user.documents = JSON.parse(JSON.stringify(templates));

    const stuDocs = await db.getStudentUploadedDocuments(studentCode, legacyNumId);

    const recordsByDocId = new Map();
    const unmappedRecords = [];

    (stuDocs || []).forEach(r => {
      const rawDocId = parseInt(r.Document_Id, 10);
      if (!isNaN(rawDocId) && rawDocId >= 1 && rawDocId <= 11) {
        if (!recordsByDocId.has(rawDocId)) recordsByDocId.set(rawDocId, []);
        recordsByDocId.get(rawDocId).push(r);
      } else {
        unmappedRecords.push(r);
      }
    });

    user.documents.forEach(docItem => {
      const activeRecords = recordsByDocId.get(docItem.id) || [];
      populateDocWithRecords(docItem, activeRecords);
    });

    unmappedRecords.forEach(r => {
      const docName = r.Document_Name || (r.Image ? path.basename(r.Image) : '');
      const matched = matchDocumentTo11List(user.documents, r.Document_Id, docName);
      if (matched) {
        populateDocWithRecords(matched, [r]);
      }
    });

    user.documents.sort((a, b) => a.id - b.id);
  } catch (err) {
    console.warn('[DocumentService] Notice loading student documents from MySQL:', err.message);
  }

  return user.documents.map(doc => ({
    ...doc,
    permissions: calculatePermissions(doc)
  }));
}

function getUserDocuments(userId) {
  const user = authService.findUserById(userId);
  if (!user) return [];
  if (!user.documents || user.documents.length === 0) {
    user.documents = createDefaultDocuments();
  }
  return user.documents.map(doc => ({
    ...doc,
    permissions: calculatePermissions(doc)
  }));
}

function getDocumentById(userId, docId) {
  const docs = getUserDocuments(userId);
  const doc = docs.find(d => d.id === parseInt(docId, 10));
  if (!doc) return null;
  return {
    ...doc,
    permissions: calculatePermissions(doc)
  };
}

function getAllUsersWithDocuments() {
  const all = [];
  for (const u of authService.userCache.values()) {
    if (u.id && String(u.id).startsWith('u-')) {
      all.push({
        ...u,
        documents: (u.documents || []).map(doc => ({
          ...doc,
          permissions: calculatePermissions(doc)
        }))
      });
    }
  }
  return all;
}

async function syncSingleUploadToMysql(userId, doc, fileResult, userNotes = "") {
  try {
    const user = authService.findUserById(userId);
    const strId = String(userId || '');
    const studentCode = user?.studentCode || strId.replace(/^u-/, '').trim();
    const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

    if (!knownMasterDocIds || !knownMasterDocIds.has(doc.id)) {
      await db.ensureMasterDocument(doc.id, doc.name);
      if (knownMasterDocIds) knownMasterDocIds.add(doc.id);
    }

    if (studentCode) {
      let assignedStaff = user?.assignedStaff || null;
      if (!assignedStaff && db.getFollowupUserByStudentAndDept) {
        try {
          const followup = await db.getFollowupUserByStudentAndDept(studentCode, null);
          if (followup && followup.User_Id) assignedStaff = followup.User_Id;
        } catch (_) {}
      }

      const insertResult = await db.insertStudentDocument(
        studentCode,
        doc.id,
        directDriveLink,
        fileResult.fileName,
        userNotes,
        assignedStaff
      );
      return insertResult ? insertResult.insertId : null;
    }
  } catch (err) {
    console.warn('[DocumentService] syncSingleUploadToMysql notice:', err.message);
  }
  return null;
}

async function saveDocumentUpload(userId, docId, fileResult, userNotes = "", documentType = null) {
  let user = authService.findUserById(userId);
  if (!user) {
    user = await authService.findOrLoadUser(userId);
  }
  if (!user) throw new Error("User not found");

  if (!user.documents) {
    user.documents = [];
  }

  let docIndex = -1;
  if (docId !== null && docId !== undefined && !isNaN(parseInt(docId, 10))) {
    docIndex = user.documents.findIndex(d => d.id === parseInt(docId, 10));
  }
  if (docIndex === -1 && documentType) {
    docIndex = user.documents.findIndex(d => 
      (d.name || '').trim().toLowerCase() === documentType.trim().toLowerCase()
    );
  }

  const now = new Date();
  const formattedDate = formatUploadDateTime(now);
  const nowISO = now.toISOString();

  let targetDocId = docId;

  if (docIndex !== -1) {
    const currentDoc = user.documents[docIndex];
    targetDocId = currentDoc.id;
    const newVersionNum = (currentDoc.currentVersion || 0) + 1;
    const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

    const newVersionRecord = {
      versionNumber: newVersionNum,
      uploadDateTime: formattedDate,
      uploadTimestamp: nowISO,
      driveFileId: fileResult.driveFileId,
      fileName: fileResult.fileName,
      savedFileName: fileResult.savedFileName || null,
      fileSize: fileResult.fileSize,
      mimeType: fileResult.mimeType,
      webViewLink: directDriveLink,
      downloadUrl: directDriveLink,
      storageType: fileResult.storageType,
      notes: userNotes,
      approvalStatusAtUpload: "Pending"
    };

    const updatedVersions = [...(currentDoc.versions || []), newVersionRecord];

    user.documents[docIndex] = {
      ...currentDoc,
      name: documentType && documentType.trim() ? documentType.trim() : currentDoc.name,
      uploadStatus: "Uploaded",
      approvalStatus: "Pending",
      isLocked: false,
      currentVersion: newVersionNum,
      uploadDateTime: formattedDate,
      uploadTimestamp: nowISO,
      driveFileId: fileResult.driveFileId,
      fileName: fileResult.fileName,
      savedFileName: fileResult.savedFileName || null,
      fileSize: fileResult.fileSize,
      mimeType: fileResult.mimeType,
      webViewLink: directDriveLink,
      downloadUrl: directDriveLink,
      storageType: fileResult.storageType,
      notes: userNotes,
      adminFeedback: "",
      versions: updatedVersions
    };
  } else {
    targetDocId = user.documents.reduce((max, d) => Math.max(max, d.id || 0), 0) + 1;
    const docName = documentType && documentType.trim() ? documentType.trim() : `Document ${targetDocId}`;
    const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

    const newVersionRecord = {
      versionNumber: 1,
      uploadDateTime: formattedDate,
      uploadTimestamp: nowISO,
      driveFileId: fileResult.driveFileId,
      fileName: fileResult.fileName,
      savedFileName: fileResult.savedFileName || null,
      fileSize: fileResult.fileSize,
      mimeType: fileResult.mimeType,
      webViewLink: directDriveLink,
      downloadUrl: directDriveLink,
      storageType: fileResult.storageType,
      notes: userNotes,
      approvalStatusAtUpload: "Pending"
    };

    const newDoc = {
      id: targetDocId,
      name: docName,
      description: `Uploaded ${docName}`,
      uploadStatus: "Uploaded",
      approvalStatus: "Pending",
      isLocked: false,
      currentVersion: 1,
      uploadDateTime: formattedDate,
      uploadTimestamp: nowISO,
      driveFileId: fileResult.driveFileId,
      fileName: fileResult.fileName,
      savedFileName: fileResult.savedFileName || null,
      fileSize: fileResult.fileSize,
      mimeType: fileResult.mimeType,
      webViewLink: directDriveLink,
      downloadUrl: directDriveLink,
      storageType: fileResult.storageType,
      notes: userNotes,
      adminFeedback: "",
      versions: [newVersionRecord]
    };

    user.documents.push(newDoc);
  }

  const finalDoc = getDocumentById(userId, targetDocId);
  const newStudentDocId = await syncSingleUploadToMysql(userId, finalDoc, fileResult, userNotes);
  if (newStudentDocId && finalDoc && finalDoc.versions && finalDoc.versions.length > 0) {
    finalDoc.versions[finalDoc.versions.length - 1].studentDocumentId = newStudentDocId;
  }
  return finalDoc;
}

function updateDocumentMetadata(userId, docId, updates) {
  const user = authService.findUserById(userId);
  if (!user) throw new Error("User not found");

  const doc = (user.documents || []).find(d => d.id === parseInt(docId, 10));
  if (!doc) throw new Error("Document not found");

  const permissions = calculatePermissions(doc);
  if (!permissions.canEdit) {
    throw new Error("This document is locked and cannot be edited.");
  }

  if (updates.notes !== undefined) doc.notes = updates.notes;
  if (updates.fileName !== undefined && updates.fileName.trim()) {
    doc.fileName = updates.fileName.trim();
  }

  return getDocumentById(userId, docId);
}

async function deleteDocument(userId, docId, versionNumber) {
  const numericDocId = parseInt(docId, 10);
  const user = authService.findUserById(userId);
  if (!user) throw new Error("User not found");

  const strId = String(userId || '');
  const studentCode = user.studentCode || strId.replace(/^u-/, '').trim();
  const legacyNumId = /^\d+$/.test(studentCode) ? parseInt(studentCode, 10) : null;

  const docIndex = (user.documents || []).findIndex(d => d.id === numericDocId);
  if (docIndex === -1) throw new Error("Document not found");

  const doc = user.documents[docIndex];
  if (doc.isLocked && doc.approvalStatus !== 'Rejected') {
    throw new Error("This document is locked by administrator and cannot be deleted.");
  }

  let fileIdToDelete = null;

  if (versionNumber !== undefined && versionNumber !== null && !isNaN(parseInt(versionNumber, 10))) {
    const vNum = parseInt(versionNumber, 10);
    const verIndex = (doc.versions || []).findIndex(v => v.versionNumber === vNum);
    let targetStudentDocId = null;

    if (verIndex !== -1) {
      const verRecord = doc.versions[verIndex];
      fileIdToDelete = verRecord.driveFileId;
      targetStudentDocId = verRecord.studentDocumentId;
    }

    if (!targetStudentDocId) {
      try {
        const activeRows = await db.getActiveStudentDocumentIds(studentCode, legacyNumId, numericDocId);
        if (activeRows && activeRows[vNum - 1]) {
          targetStudentDocId = activeRows[vNum - 1].Student_Document_Id;
        }
      } catch (e) {
        console.error('[MySQL Delete Lookup Error]:', e.message);
      }
    }

    if (targetStudentDocId) {
      try {
        await db.softDeleteStudentDocumentById(targetStudentDocId);
      } catch (err) {
        console.error('[MySQL Single Row Soft-Delete Error]:', err.message);
      }
    }

    if (verIndex !== -1) {
      doc.versions.splice(verIndex, 1);
    }

    if (doc.versions && doc.versions.length > 0) {
      doc.versions.forEach((v, idx) => {
        v.versionNumber = idx + 1;
      });
      const latestVer = doc.versions[doc.versions.length - 1];
      doc.uploadStatus = "Uploaded";
      doc.currentVersion = doc.versions.length;
      doc.fileName = latestVer.fileName;
      doc.savedFileName = latestVer.savedFileName || null;
      doc.fileSize = latestVer.fileSize;
      doc.mimeType = latestVer.mimeType;
      doc.uploadDateTime = latestVer.uploadDateTime;
      doc.webViewLink = latestVer.webViewLink;
      doc.downloadUrl = latestVer.downloadUrl;
      doc.notes = latestVer.notes || '';
      doc.storageType = latestVer.storageType;
      doc.driveFileId = latestVer.driveFileId;
    } else {
      doc.uploadStatus = "Upload Pending";
      doc.approvalStatus = "Pending";
      doc.isLocked = false;
      doc.currentVersion = 0;
      doc.uploadDateTime = null;
      doc.driveFileId = null;
      doc.fileName = null;
      doc.savedFileName = null;
      doc.fileSize = null;
      doc.mimeType = null;
      doc.webViewLink = null;
      doc.downloadUrl = null;
      doc.storageType = null;
      doc.notes = "";
      doc.adminFeedback = "";
      doc.versions = [];
    }
  } else {
    fileIdToDelete = doc.driveFileId;
    try {
      await db.softDeleteAllStudentDocuments(studentCode, legacyNumId, numericDocId);
    } catch (err) {
      console.error('[MySQL Full Delete Error]:', err.message);
    }
    doc.uploadStatus = "Upload Pending";
    doc.approvalStatus = "Pending";
    doc.isLocked = false;
    doc.currentVersion = 0;
    doc.uploadDateTime = null;
    doc.driveFileId = null;
    doc.fileName = null;
    doc.savedFileName = null;
    doc.fileSize = null;
    doc.mimeType = null;
    doc.webViewLink = null;
    doc.downloadUrl = null;
    doc.storageType = null;
    doc.notes = "";
    doc.adminFeedback = "";
    doc.versions = [];
  }

  if (fileIdToDelete && !fileIdToDelete.startsWith('local_') && !fileIdToDelete.startsWith('gdrive_')) {
    try {
      driveService.deleteFile(fileIdToDelete).catch(() => {});
    } catch (_) {}
  }

  return getDocumentById(userId, numericDocId);
}

function adminReviewDocument(userId, docId, { approvalStatus, verificationStatus, rejectionReason, isLocked, adminFeedback, versionNumber, studentDocumentId } = {}) {
  const user = authService.findUserById(userId);
  if (!user) throw new Error("User not found");

  const doc = (user.documents || []).find(d => d.id === parseInt(docId, 10));
  if (!doc) throw new Error("Document not found");

  let vStatus = verificationStatus !== undefined && verificationStatus !== null ? Number(verificationStatus) : null;
  if (vStatus !== null) {
    if (vStatus === 1) doc.approvalStatus = 'Approved';
    else if (vStatus === 2) doc.approvalStatus = 'Rejected';
    else doc.approvalStatus = 'Pending';
    doc.verificationStatus = vStatus;
  } else if (approvalStatus) {
    if (!["Pending", "Approved", "Rejected"].includes(approvalStatus)) {
      throw new Error("Invalid approval status");
    }
    doc.approvalStatus = approvalStatus;
    doc.verificationStatus = (approvalStatus === 'Approved' ? 1 : (approvalStatus === 'Rejected' ? 2 : 0));
    vStatus = doc.verificationStatus;
  }

  const finalReason = rejectionReason !== undefined ? rejectionReason : (adminFeedback !== undefined ? adminFeedback : (vStatus === 2 ? doc.rejectionReason : ''));

  if (doc.versions && doc.versions.length > 0) {
    let targetVer = null;
    if (studentDocumentId) {
      targetVer = doc.versions.find(v => v.studentDocumentId === Number(studentDocumentId));
    } else if (versionNumber) {
      targetVer = doc.versions.find(v => v.versionNumber === Number(versionNumber));
    } else {
      targetVer = doc.versions[0];
    }

    if (targetVer) {
      targetVer.verificationStatus = vStatus;
      targetVer.approvalStatus = (vStatus === 1 ? 'Approved' : (vStatus === 2 ? 'Rejected' : 'Pending'));
      targetVer.rejectionReason = vStatus === 2 ? (finalReason || '') : '';
    }
  }

  if (vStatus !== null) {
    try {
      const cleanCode = user.studentCode || String(userId).replace(/^u-/, '');
      if (vStatus === 2) {
        doc.rejectionReason = finalReason || '';
        doc.adminFeedback = doc.rejectionReason;
      } else if (vStatus === 1 || vStatus === 0) {
        doc.rejectionReason = '';
      }
      db.updateStudentDocumentVerificationStatus(cleanCode, doc.id, vStatus, doc.rejectionReason, studentDocumentId);
    } catch (dbErr) {
      console.warn('[DocumentService] Error updating Verification_Status in MySQL:', dbErr.message);
    }
  }

  if (typeof isLocked === 'boolean') {
    doc.isLocked = isLocked;
  } else if (vStatus === 1) {
    doc.isLocked = true;
  }

  if (adminFeedback !== undefined) {
    doc.adminFeedback = adminFeedback;
  }

  return getDocumentById(userId, docId);
}

function syncGoogleDriveFiles(userId, driveFiles = []) {
  const user = authService.findUserById(userId);
  if (!user) throw new Error("User not found");

  if (!user.documents || user.documents.length === 0) {
    user.documents = createDefaultDocuments();
  }

  let syncedCount = 0;
  const now = new Date();
  const formattedDate = formatUploadDateTime(now);

  for (const file of driveFiles) {
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;

    const alreadyLinked = user.documents.some(d => 
      d.driveFileId === file.driveFileId || 
      (d.versions && d.versions.some(v => v.driveFileId === file.driveFileId))
    );

    if (alreadyLinked) continue;

    let targetDoc = user.documents.find(d => d.uploadStatus === "Upload Pending");

    if (!targetDoc) {
      const nextId = user.documents.length > 0 
        ? Math.max(...user.documents.map(d => d.id)) + 1 
        : 1;
      targetDoc = {
        id: nextId,
        name: file.fileName.replace(/\.[^/.]+$/, ''),
        description: `Imported from Google Drive (${file.fileName})`,
        uploadStatus: "Upload Pending",
        approvalStatus: "Pending",
        isLocked: false,
        currentVersion: 0,
        versions: []
      };
      user.documents.push(targetDoc);
    }

    const newVersionNum = (targetDoc.currentVersion || 0) + 1;
    const fileRecord = {
      versionNumber: newVersionNum,
      uploadDateTime: formattedDate,
      uploadTimestamp: file.createdTime || now.toISOString(),
      driveFileId: file.driveFileId,
      fileName: file.fileName,
      savedFileName: file.savedFileName || null,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || `/api/drive/files/${file.driveFileId}/view`,
      driveWebViewLink: file.driveWebViewLink || file.webViewLink,
      downloadUrl: file.downloadUrl,
      storageType: file.storageType || 'google_drive_cloud',
      notes: 'Synchronized directly from Google Drive',
      approvalStatusAtUpload: 'Pending'
    };

    targetDoc.uploadStatus = "Uploaded";
    targetDoc.approvalStatus = "Pending";
    targetDoc.isLocked = false;
    targetDoc.currentVersion = newVersionNum;
    targetDoc.uploadDateTime = formattedDate;
    targetDoc.driveFileId = file.driveFileId;
    targetDoc.fileName = file.fileName;
    targetDoc.savedFileName = file.savedFileName || null;
    targetDoc.fileSize = file.fileSize;
    targetDoc.mimeType = file.mimeType;
    targetDoc.webViewLink = file.webViewLink || `/api/drive/files/${file.driveFileId}/view`;
    targetDoc.driveWebViewLink = file.driveWebViewLink || file.webViewLink;
    targetDoc.downloadUrl = file.downloadUrl;
    targetDoc.storageType = file.storageType || 'google_drive_cloud';
    targetDoc.notes = 'Synchronized directly from Google Drive';

    if (!targetDoc.versions) targetDoc.versions = [];
    const alreadyHasVer = targetDoc.versions.some(v => v.driveFileId === file.driveFileId);
    if (!alreadyHasVer) {
      targetDoc.versions.push(fileRecord);
    }

    syncedCount++;
  }

  return {
    syncedCount,
    totalDocuments: user.documents.length
  };
}

function findDocumentByDriveFileId(fileId) {
  for (const user of authService.userCache.values()) {
    for (const doc of (user.documents || [])) {
      if (doc.driveFileId === fileId) {
        return {
          foundSavedFileName: doc.savedFileName,
          mimeType: doc.mimeType || 'application/octet-stream',
          originalName: doc.fileName || 'document'
        };
      }
      if (doc.versions) {
        const match = doc.versions.find(v => v.driveFileId === fileId);
        if (match) {
          return {
            foundSavedFileName: match.savedFileName,
            mimeType: match.mimeType || 'application/octet-stream',
            originalName: match.fileName || 'document'
          };
        }
      }
    }
  }
  return null;
}

function generateFilenameFromDocType(documentType, originalname) {
  const extension = path.extname(originalname || '') || '';
  if (!documentType || typeof documentType !== 'string' || !documentType.trim()) {
    return originalname || `Document${extension}`;
  }

  let cleanType = documentType.trim()
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!cleanType) {
    cleanType = 'Document';
  }

  const cleanExt = extension.startsWith('.') ? extension : (extension ? `.${extension}` : '');
  return `${cleanType}${cleanExt}`;
}

async function ensureUserDriveFolder(user) {
  if (!user || user.role === 'admin') {
    return { folderId: null, folderName: null };
  }

  ensureStudentCode(user);
  const expectedFolderName = getStudentFolderSlug(user);

  let folderId = user.driveFolderId;
  let folderName = user.driveFolderName || expectedFolderName;

  if (user.driveFolderVerified && folderId && !folderId.startsWith('gdrive_') && !folderId.startsWith('local_')) {
    return { folderId, folderName };
  }

  let needsCreation = false;

  if (!folderId || folderId.startsWith('gdrive_') || folderId.startsWith('local_')) {
    needsCreation = true;
  } else {
    let isShared = false;
    for (const u of authService.userCache.values()) {
      if (u.id !== user.id && u.driveFolderId === folderId) {
        isShared = true;
        break;
      }
    }
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
      setUserDriveFolder(user.id, folderId, folderName);
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
      const fRecord = await db.getFollowupUserByStudentAndDept(lookupStudent, deptIdParam);
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
        syncGoogleDriveFiles(targetUserId, driveList.files);
      }
    } catch (syncErr) {
      console.warn('[Sync Notice]:', syncErr.message);
    }
  }

  const documents = await getOrLoadUserDocuments(targetUserId);

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
  const followupRecord = await db.getFollowupUserByStudentAndDept(cleanStudentCode, deptId);

  const associatedUserId = followupRecord ? followupRecord.User_Id : null;
  const associatedUserName = followupRecord ? followupRecord.UserName : null;

  if (associatedUserId && db.updateStudentDocumentStaff) {
    try {
      await db.updateStudentDocumentStaff(cleanStudentCode, associatedUserId);
    } catch (_) {}
  }

  const targetUserId = `u-${cleanStudentCode}`;
  const documents = await getOrLoadUserDocuments(targetUserId);

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
  return getAllUsersWithDocuments();
}

async function processDocumentUpload({ rawDocId, targetUserId, userNotes, requestedDocType, file }) {
  const user = await authService.findOrLoadUser(targetUserId);
  if (!user) {
    return { error: 'User account not found', status: 404 };
  }

  if (!user.documents || user.documents.length === 0) {
    await getOrLoadUserDocuments(targetUserId);
  }

  let existingDoc = null;
  if (rawDocId && !isNaN(rawDocId)) {
    existingDoc = getDocumentById(targetUserId, rawDocId);
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

  const studentFolderName = getStudentFolderSlug(user);

  let folderIdToUse = user.driveFolderId;
  if (!folderIdToUse || folderIdToUse.startsWith('gdrive_') || folderIdToUse.startsWith('local_')) {
    const driveFolderInfo = await ensureUserDriveFolder(user);
    folderIdToUse = driveFolderInfo.folderId;
  }

  const originalDocFilename = generateFilenameFromDocType(effectiveDocType, file.originalname);

  const driveResult = await driveService.uploadFile(
    file,
    studentFolderName,
    originalDocFilename,
    userNotes,
    folderIdToUse
  );

  if (driveResult && driveResult.folderId) {
    user.driveFolderId = driveResult.folderId;
    user.driveFolderName = studentFolderName;
    setUserDriveFolder(targetUserId, driveResult.folderId, studentFolderName);
  }

  const updatedDoc = await saveDocumentUpload(
    targetUserId,
    rawDocId,
    driveResult,
    userNotes,
    effectiveDocType
  );

  // Trigger notification to the assigned staff member after successful database save
  try {
    const notificationService = require('../notifications/notification.service');
    const studentCode = user.studentCode || String(targetUserId).replace(/^u-/, '').trim();
    await notificationService.notifyAssignedUserOnDocumentUpload({
      studentId: studentCode,
      studentName: user.name || 'Student',
      docName: updatedDoc?.name || effectiveDocType,
      uploadDateTime: updatedDoc?.uploadDateTime || new Date()
    });
  } catch (notifErr) {
    console.warn('[Notification Notice]:', notifErr.message);
  }

  return {
    success: true,
    message: `Document "${effectiveDocType}" uploaded successfully.`,
    document: updatedDoc,
    driveFolder: studentFolderName,
    storageType: driveResult.storageType,
    webViewLink: updatedDoc.webViewLink,
    downloadUrl: updatedDoc.downloadUrl
  };
}

module.exports = {
  INITIAL_DOCUMENTS,
  getMasterDocTemplates,
  calculatePermissions,
  ensureStudentCode,
  getStudentFolderSlug,
  setUserDriveFolder,
  getOrLoadUserDocuments,
  getUserDocuments,
  getDocumentById,
  getAllUsersWithDocuments,
  getAllDocuments,
  saveDocumentUpload,
  updateDocumentMetadata,
  adminReviewDocument,
  deleteDocument,
  syncGoogleDriveFiles,
  findDocumentByDriveFileId,
  generateFilenameFromDocType,
  ensureUserDriveFolder,
  getChecklist,
  getFollowupDocuments,
  processDocumentUpload
};
