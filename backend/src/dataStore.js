const fs = require('fs');
const path = require('path');

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

function createDefaultDocuments() {
  return INITIAL_DOCUMENTS.map(doc => ({
    id: doc.id,
    name: doc.name,
    description: doc.description,
    uploadStatus: "Upload Pending", // "Upload Pending" | "Uploaded"
    approvalStatus: "Pending",     // "Pending" | "Approved" | "Rejected"
    isLocked: false,
    currentVersion: 0,
    uploadDateTime: null,
    driveFileId: null,
    fileName: null,
    savedFileName: null,
    fileSize: null,
    mimeType: null,
    webViewLink: null,
    storageType: null,
    notes: "",
    adminFeedback: "",
    versions: [] // Array of past/current versions
  }));
}

function getInitialData() {
  return {
    users: [
      {
        id: "u-admin",
        email: "admin@example.com",
        username: "admin",
        name: "Sarah Jenkins (Compliance Admin)",
        password: "adminpassword",
        role: "admin",
        department: "Compliance & HR Audit",
        documents: []
      }
    ],
    resetTokens: {}
  };
}

class DataStore {
  constructor() {
    this.data = getInitialData();
    this.cachedStudentList = null;
    this.masterDocTemplates = null;
    this.knownMasterDocIds = new Set();
  }

  load() {
    if (!this.data) {
      this.data = getInitialData();
    }
    return this.data;
  }

  save(dataToSave) {
    if (dataToSave) {
      this.data = dataToSave;
    }
  }

  async syncToMysql(dataToSave) {
    // No-op in live MySQL mode: document uploads are synced directly per-upload via syncSingleUploadToMysql
    return;
  }

  async getMasterDocTemplates() {
    if (this.masterDocTemplates && this.masterDocTemplates.length === INITIAL_DOCUMENTS.length) {
      return this.masterDocTemplates;
    }
    // Strictly generate templates for the 11 required checklist documents (numbered 1 to 11)
    this.masterDocTemplates = INITIAL_DOCUMENTS.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
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
    this.knownMasterDocIds = new Set(this.masterDocTemplates.map(d => d.id));
    return this.masterDocTemplates;
  }

  async getStudentList() {
    if (this.cachedStudentList && this.cachedStudentList.length > 0) {
      return this.cachedStudentList;
    }
    try {
      const db = require('../db');
      const students = await db.loadActiveStudents();
      this.cachedStudentList = (students || []).map(s => {
        const studentCode = String(s.Student_Id || s.Unique_Id || '').trim();
        return {
          id: `u-${studentCode}`,
          studentCode: studentCode,
          name: s.Student_Name || s.Username || `Student ${studentCode}`,
          email: s.Email || '',
          username: s.Username || '',
          department: s.Proceeding_Course_Name || 'General Operations',
          documentsCount: 11,
          uploadedCount: 0
        };
      });
    } catch (err) {
      console.warn('[DataStore] Error loading student list:', err.message);
      this.cachedStudentList = [];
    }
    return this.cachedStudentList;
  }

  updateStudentInCache(studentId, updates = {}) {
    const cleanId = String(studentId).replace(/^u-/, '').trim();
    if (this.cachedStudentList && Array.isArray(this.cachedStudentList)) {
      const idx = this.cachedStudentList.findIndex(s => s.studentCode === cleanId || s.id === 'u-' + cleanId);
      if (idx !== -1) {
        this.cachedStudentList[idx] = {
          ...this.cachedStudentList[idx],
          ...updates
        };
      }
    }
    const user = this.data.users ? this.data.users.find(u => u.studentCode === cleanId || u.id === 'u-' + cleanId) : null;
    if (user) {
      Object.assign(user, updates);
    }
  }

  matchDocumentTo11List(userDocs, docId, docName) {
    const clean = String(docName || '').toLowerCase().trim();

    // 1. Prioritize matching by Document_Name keyword to strictly one of the 11 documents
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

    // 2. Match by exact Document_Id 1 to 11 if docName was not specific
    const numId = parseInt(docId, 10);
    if (!isNaN(numId) && numId >= 1 && numId <= 11) {
      const match = userDocs.find(d => d.id === numId);
      if (match) return match;
    }

    return null;
  }

  async loadFromMysql() {
    try {
      // Pre-warm master templates and student list in background
      await Promise.all([
        this.getMasterDocTemplates(),
        this.getStudentList()
      ]);
      return this.data;
    } catch (err) {
      console.warn('[DataStore] loadFromMysql notice:', err.message);
      return this.data;
    }
  }

  async findOrLoadUser(userId) {
    if (!userId) return null;
    const existing = this.findUserById(userId);
    if (existing) return existing;

    try {
      const db = require('../db');
      const rawId = String(userId).replace(/^u-/, '').trim();
      const s = await db.findUserByIdentifier(rawId);
      if (s) {
        const studentCode = String(s.studentCode || rawId).trim();
        const newUser = {
          id: `u-${studentCode}`,
          email: s.email || '',
          username: s.username || s.email || `student_${studentCode}`,
          name: s.name || `Student ${studentCode}`,
          password: s.password || 'Password123',
          role: 'user',
          department: s.department || 'General Operations',
          studentCode: studentCode,
          driveFolderId: null,
          driveFolderName: null,
          documents: []
        };
        this.data.users.push(newUser);
        return newUser;
      }
    } catch (err) {
      console.warn('[DataStore] findOrLoadUser error:', err.message);
    }
    return null;
  }

  populateDocWithRecords(docItem, activeRecords) {
    if (!docItem || !activeRecords || activeRecords.length === 0) return;

    // Sort activeRecords ASC by primary key to preserve version sequence 1, 2, 3...
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

    // Chronological order: first uploaded first, re-uploads below
    const firstActive = versions[0];

    docItem.uploadStatus = 'Uploaded';
    docItem.verificationStatus = firstActive.verificationStatus;
    docItem.approvalStatus = firstActive.approvalStatus;
    docItem.rejectionReason = (firstActive.verificationStatus === 2 && firstActive.rejectionReason)
      ? String(firstActive.rejectionReason)
      : (docItem.adminFeedback || '');
    docItem.isLocked = (firstActive.verificationStatus === 1 || firstActive.approvalStatus === 'Approved');
    docItem.fileName = firstActive.fileName;
    docItem.webViewLink = firstActive.webViewLink;
    docItem.downloadUrl = firstActive.downloadUrl;
    docItem.driveFileId = firstActive.driveFileId || docItem.driveFileId;
    docItem.notes = firstActive.notes || docItem.notes || '';
    docItem.currentVersion = activeRecords.length;
    docItem.uploadDateTime = firstActive.uploadDateTime || null;
    docItem.versions = versions;
  }

  async getOrLoadUserDocuments(userId) {
    const user = await this.findOrLoadUser(userId);
    if (!user) return [];
    if (user.role === 'admin') return [];

    try {
      const db = require('../db');
      const defaultDocTemplates = await this.getMasterDocTemplates();
      const userDocs = JSON.parse(JSON.stringify(defaultDocTemplates));

      const studentCode = this.ensureStudentCode(user);
      const numPart = studentCode ? studentCode.replace(/\D/g, '') : null;
      const legacyNumId = numPart ? parseInt(numPart, 10) : null;

      const stuDocs = await db.getStudentUploadedDocuments(studentCode, legacyNumId);

      // Group active records by target document ID (strictly matching 1..11)
      const matchedMap = new Map();

      for (const sd of stuDocs) {
        if (sd.DeleteStatus === 1) continue;
        if (!sd.File_Name && !sd.Image && !sd.Document_Name) continue;

        const matched = this.matchDocumentTo11List(userDocs, sd.Document_Id, sd.Document_Name);
        if (matched) {
          if (!matchedMap.has(matched.id)) {
            matchedMap.set(matched.id, []);
          }
          matchedMap.get(matched.id).push(sd);
        }
      }

      // Populate matched standard documents
      for (const [targetDocId, activeRecords] of matchedMap.entries()) {
        const docItem = userDocs.find(d => d.id === targetDocId);
        if (docItem && activeRecords.length > 0) {
          this.populateDocWithRecords(docItem, activeRecords);
        }
      }

      // Strictly enforce ONLY the first 11 documents (numbered 1 to 11)
      user.documents = userDocs
        .filter(d => d.id >= 1 && d.id <= 11)
        .sort((a, b) => a.id - b.id);

      return user.documents.map(doc => ({
        ...doc,
        permissions: this.calculatePermissions(doc)
      }));
    } catch (err) {
      console.warn('[DataStore] getOrLoadUserDocuments error:', err.message);
      return (user.documents || [])
        .map(doc => ({
          ...doc,
          permissions: this.calculatePermissions(doc)
        }));
    }
  }

  findUserByEmailOrUsername(identifier) {
    if (!identifier) return null;
    const lower = identifier.toLowerCase().trim();
    this.data = this.load();
    return this.data.users.find(u => {
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      return uEmail === lower || uUser === lower;
    });
  }

  async authenticateUser(identifier, password) {
    if (!identifier || !password) return null;
    const cleanId = String(identifier).trim();
    const cleanLower = cleanId.toLowerCase();

    // 1. Instant check for Administrator in memory (0ms)
    const adminUser = (this.data.users || []).find(u => 
      u.role === 'admin' && 
      ((u.username && u.username.toLowerCase() === cleanLower) || 
       (u.email && u.email.toLowerCase() === cleanLower))
    );
    if (adminUser) {
      const expectedPass = adminUser.password ? String(adminUser.password).trim() : 'adminpassword';
      const match = expectedPass === String(password).trim();
      if (!match) {
        return { error: 'Incorrect password.' };
      }
      return adminUser;
    }

    // 2. Fast indexed check against MySQL student table (~30ms)
    try {
      const db = require('../db');
      const stu = await db.findUserByIdentifier(cleanId);
      if (stu) {
        const expectedPass = stu.password ? String(stu.password).trim() : 'Password123';
        const match = expectedPass === String(password).trim();
        if (!match) {
          return { error: 'Incorrect password.' };
        }
        const user = await this.findOrLoadUser(stu.id);
        return user || stu;
      }
    } catch (err) {
      console.warn('[DataStore] Notice querying MySQL for login:', err.message);
    }

    // 3. Fallback to local dataStore only if MySQL is not available
    this.data = this.load();
    const user = this.findUserByEmailOrUsername(cleanLower);
    if (!user) {
      return { error: 'Account not found. Only registered users in the database can log in.' };
    }

    const match = user.password === String(password).trim();
    if (!match) {
      return { error: 'Incorrect password.' };
    }

    return user;
  }

  // Alias for backward compatibility
  authenticateOrProvisionUser(identifier, password) {
    return this.authenticateUser(identifier, password);
  }

  ensureStudentCode(user) {
    if (!user || user.role === 'admin') return null;
    if (user.studentCode) return String(user.studentCode).trim();
    if (user.id) {
      const code = String(user.id).replace(/^u-/, '').trim();
      user.studentCode = code;
      return code;
    }
    return 'Student';
  }

  getStudentFolderSlug(user) {
    const code = this.ensureStudentCode(user) || 'Student';
    const rawName = user.name || user.username || 'Student';
    const cleanName = rawName
      .trim()
      .replace(/[\s\./\\]+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return `${code}_${cleanName || 'Student'}`;
  }

  setUserDriveFolder(userId, folderId, folderName) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");
    user.driveFolderId = folderId;
    user.driveFolderName = folderName;
    this.save();
    return user;
  }

  findUserById(userId) {
    if (!userId) return null;
    this.data = this.load();
    const cleanId = String(userId).trim().toLowerCase();
    return (this.data.users || []).find(u => {
      const uId = String(u.id || '').trim().toLowerCase();
      const uCode = String(u.studentCode || '').trim().toLowerCase();
      const uEmail = String(u.email || '').trim().toLowerCase();
      const uUser = String(u.username || '').trim().toLowerCase();
      return (
        uId === cleanId ||
        uCode === cleanId ||
        `u-${uCode}` === cleanId ||
        uId === `u-${cleanId}` ||
        uEmail === cleanId ||
        uUser === cleanId
      );
    }) || null;
  }

  getUserDocuments(userId) {
    const user = this.findUserById(userId);
    if (!user) return [];
    if (!user.documents || user.documents.length === 0) {
      user.documents = createDefaultDocuments();
      this.save();
    } else {
      let changed = false;
      const filtered = user.documents.filter(d => INITIAL_DOCUMENTS.some(init => init.id === d.id));
      if (filtered.length !== user.documents.length) {
        user.documents = filtered;
        changed = true;
      }
      INITIAL_DOCUMENTS.forEach(initDoc => {
        let existing = user.documents.find(d => d.id === initDoc.id);
        if (!existing) {
          user.documents.push({
            id: initDoc.id,
            name: initDoc.name,
            description: initDoc.description,
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
            storageType: null,
            notes: "",
            adminFeedback: "",
            versions: []
          });
          changed = true;
        } else {
          if (existing.name !== initDoc.name || existing.description !== initDoc.description) {
            existing.name = initDoc.name;
            existing.description = initDoc.description;
            changed = true;
          }
        }
      });
      user.documents.sort((a, b) => a.id - b.id);
      if (changed) {
        this.save();
      }
    }
    return user.documents.map(doc => ({
      ...doc,
      permissions: this.calculatePermissions(doc)
    }));
  }

  getDocumentById(userId, docId) {
    const docs = this.getUserDocuments(userId);
    const doc = docs.find(d => d.id === parseInt(docId, 10));
    if (!doc) return null;
    return {
      ...doc,
      permissions: this.calculatePermissions(doc)
    };
  }

  /**
   * Permission Matrix strictly following the requirement:
   * 
   * | Status               | Upload/Re-upload | View | Edit | Delete |
   * | Upload Pending       | ✅               | ❌   | ❌   | ❌     |
   * | Uploaded + Unlocked  | ✅               | ✅   | ✅   | ✅     |
   * | Uploaded + Locked    | ❌               | ✅   | ❌   | ❌     |
   * | Rejected + Unlocked  | ✅               | ✅   | ✅   | ✅     |
   * | Rejected + Locked    | ✅ New Version   | ✅   | ❌   | ❌     |
   * | Approved + Locked    | ❌               | ✅   | ❌   | ❌     |
   */
  calculatePermissions(doc) {
    const isPendingUpload = doc.uploadStatus === "Upload Pending";
    const isUploaded = doc.uploadStatus === "Uploaded";
    const isLocked = Boolean(doc.isLocked);
    const approval = doc.approvalStatus; // "Pending" | "Approved" | "Rejected"

    let canUpload = false;
    let canView = false;
    let canEdit = false;
    let canDelete = false;
    let uploadLabel = "Upload";

    if (isPendingUpload) {
      canUpload = true;
      canView = false;
      canEdit = false;
      canDelete = false;
      uploadLabel = "Upload";
    } else if (isUploaded) {
      canView = true;

      if (!isLocked) {
        // Uploaded + Unlocked OR Rejected + Unlocked
        canUpload = true;
        canEdit = true;
        canDelete = true;
        uploadLabel = "Re-upload";
      } else {
        // Document is Locked
        if (approval === "Rejected") {
          // Rejected + Locked: Special case: ✅ New Version permitted!
          canUpload = true;
          canEdit = false;
          canDelete = false;
          uploadLabel = "Upload New Version";
        } else if (approval === "Approved") {
          // Approved + Locked: ❌ Upload/Re-upload, View only
          canUpload = false;
          canEdit = false;
          canDelete = false;
          uploadLabel = "Locked (Approved)";
        } else {
          // Uploaded + Locked (Pending approval): ❌ Upload/Re-upload, View only
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

  async saveDocumentUpload(userId, docId, fileResult, userNotes = "", documentType = null) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    if (!user.documents) {
      user.documents = [];
    }

    // Try finding existing document by ID
    let docIndex = -1;
    if (docId !== null && docId !== undefined && !isNaN(parseInt(docId, 10))) {
      docIndex = user.documents.findIndex(d => d.id === parseInt(docId, 10));
    }
    // If not found by ID, try finding by document type name (Requirement 8)
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
        approvalStatus: "Pending", // Reset to Pending for review on fresh upload
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
      // Create new dynamic document type (Requirement 1, 4, 8)
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

    const finalDoc = this.getDocumentById(userId, targetDocId);
    const newStudentDocId = await this.syncSingleUploadToMysql(userId, finalDoc, fileResult, userNotes);
    if (newStudentDocId && finalDoc && finalDoc.versions && finalDoc.versions.length > 0) {
      finalDoc.versions[finalDoc.versions.length - 1].studentDocumentId = newStudentDocId;
    }
    this.save();
    return finalDoc;
  }

  async syncSingleUploadToMysql(userId, doc, fileResult, userNotes = "") {
    try {
      const db = require('../db');

      const user = this.findUserById(userId);
      const studentCode = user?.studentCode || (userId && userId.includes('STU') ? userId.replace(/^u-/, '') : `STU${String((userId || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
      const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

      // 1. Ensure master document catalog has this document via stored query in db.js (cached check)
      if (!this.knownMasterDocIds || !this.knownMasterDocIds.has(doc.id)) {
        await db.ensureMasterDocument(doc.id, doc.name);
        if (this.knownMasterDocIds) this.knownMasterDocIds.add(doc.id);
      }

      // 2. Direct insert into student_document table via stored query in db.js
      if (studentCode) {
        let assignedStaff = user?.assignedStaff || null;
        if (!assignedStaff && db.getFollowupUserByStudentAndDept) {
          try {
            const followup = await db.getFollowupUserByStudentAndDept(studentCode);
            if (followup && followup.User_Id) assignedStaff = followup.User_Id;
          } catch (_) {}
        }
        return await db.insertStudentDocument(
          studentCode,
          fileResult.fileName || doc.fileName || doc.name,
          doc.id,
          doc.name,
          directDriveLink,
          userNotes || doc.notes || '',
          assignedStaff
        );
      }
      return null;
    } catch (err) {
      console.error('[MySQL Direct Upload Sync Error]:', err.message);
      return null;
    }
  }

  updateDocumentMetadata(userId, docId, updates) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const doc = user.documents.find(d => d.id === parseInt(docId, 10));
    if (!doc) throw new Error("Document not found");

    const permissions = this.calculatePermissions(doc);
    if (!permissions.canEdit) {
      throw new Error("This document is locked and cannot be edited.");
    }

    if (updates.notes !== undefined) doc.notes = updates.notes;
    if (updates.fileName !== undefined && updates.fileName.trim()) {
      doc.fileName = updates.fileName.trim();
    }

    this.save();
    return this.getDocumentById(userId, docId);
  }

  async deleteDocument(userId, docId, versionNumber) {
    const db = require('../db');
    const numericDocId = parseInt(docId, 10);

    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const studentCode = user.studentCode || (userId && userId.includes('STU') ? userId.replace(/^u-/, '') : `STU${String((userId || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
    const legacyNumId = parseInt((userId || '').replace(/\D/g, ''), 10) || null;

    const docIndex = (user.documents || []).findIndex(d => d.id === numericDocId);
    if (docIndex === -1) throw new Error("Document not found");

    const doc = user.documents[docIndex];
    if (doc.isLocked && doc.approvalStatus !== 'Rejected') {
      throw new Error("This document is locked by administrator and cannot be deleted.");
    }

    let fileIdToDelete = null;

    // 2. If a specific version is targeted for deletion (even when only 1 version exists)
    if (versionNumber !== undefined && versionNumber !== null && !isNaN(parseInt(versionNumber, 10))) {
      const vNum = parseInt(versionNumber, 10);
      const verIndex = (doc.versions || []).findIndex(v => v.versionNumber === vNum);
      let targetStudentDocId = null;

      if (verIndex !== -1) {
        const verRecord = doc.versions[verIndex];
        fileIdToDelete = verRecord.driveFileId;
        targetStudentDocId = verRecord.studentDocumentId;
      }

      // If studentDocumentId is not mapped in memory, lookup the exact active row in MySQL via stored query
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

      // SOFT-DELETE ONLY THAT ONE SPECIFIC ROW IN MySQL (DeleteStatus = 1) via stored query
      if (targetStudentDocId) {
        try {
          await db.softDeleteStudentDocumentById(targetStudentDocId);
        } catch (err) {
          console.error('[MySQL Single Row Soft-Delete Error]:', err.message);
        }
      }

      // Remove from memory
      if (verIndex !== -1) {
        doc.versions.splice(verIndex, 1);
      }

      // If remaining active versions exist
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
        // Only if ALL versions are gone, reset this single document to Upload Pending
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
      // 3. Full document deletion (no version specified) via stored query in db.js
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

    this.save();

    // Attempt deleting cloud file from Drive ONLY IF not referenced by any other user
    if (fileIdToDelete && !fileIdToDelete.startsWith('local_') && !fileIdToDelete.startsWith('gdrive_')) {
      const isReferencedByOther = (this.data.users || []).some(u => 
        u.id !== userId && (u.documents || []).some(d => 
          d.driveFileId === fileIdToDelete || 
          (d.versions && d.versions.some(v => v.driveFileId === fileIdToDelete))
        )
      );
      if (!isReferencedByOther) {
        try {
          const driveService = require('./services/drive/drive.service');
          driveService.deleteFile(fileIdToDelete).catch(() => {});
        } catch (_) {}
      }
    }

    return this.getDocumentById(userId, numericDocId);
  }

  // Admin Review and Lock Methods
  adminReviewDocument(userId, docId, { approvalStatus, verificationStatus, rejectionReason, isLocked, adminFeedback, versionNumber, studentDocumentId } = {}) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const doc = user.documents.find(d => d.id === parseInt(docId, 10));
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

    // Update specific version in versions array if targeted
    if (doc.versions && doc.versions.length > 0) {
      let targetVer = null;
      if (studentDocumentId) {
        targetVer = doc.versions.find(v => v.studentDocumentId === Number(studentDocumentId));
      } else if (versionNumber) {
        targetVer = doc.versions.find(v => v.versionNumber === Number(versionNumber));
      } else {
        targetVer = doc.versions[0]; // latest version
      }

      if (targetVer) {
        targetVer.verificationStatus = vStatus;
        targetVer.approvalStatus = (vStatus === 1 ? 'Approved' : (vStatus === 2 ? 'Rejected' : 'Pending'));
        targetVer.rejectionReason = vStatus === 2 ? (finalReason || '') : '';
      }
    }

    if (vStatus !== null) {
      try {
        const db = require('../db');
        const cleanCode = user.studentCode || String(userId).replace(/^u-/, '');
        if (vStatus === 2) {
          doc.rejectionReason = finalReason || '';
          doc.adminFeedback = doc.rejectionReason;
        } else if (vStatus === 1 || vStatus === 0) {
          doc.rejectionReason = '';
        }
        db.updateStudentDocumentVerificationStatus(cleanCode, doc.id, vStatus, doc.rejectionReason, studentDocumentId);
      } catch (dbErr) {
        console.warn('[DataStore] Error updating Verification_Status in MySQL:', dbErr.message);
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

    this.save();
    return this.getDocumentById(userId, docId);
  }

  // Password reset helper
  createResetToken(email, user = null) {
    this.data = this.load();
    if (!this.data.resetTokens) {
      this.data.resetTokens = {};
    }
    // Clean up expired tokens to keep database.json lean
    const now = Date.now();
    for (const key of Object.keys(this.data.resetTokens)) {
      if (!this.data.resetTokens[key]?.expiresAt || this.data.resetTokens[key].expiresAt < now) {
        delete this.data.resetTokens[key];
      }
    }
    const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    this.data.resetTokens[token] = {
      email,
      username: user?.username || null,
      studentCode: user?.studentCode || (user?.id ? String(user.id).replace(/^u-/, '') : null),
      userId: user?.id || null,
      expiresAt: Date.now() + 3600000 // 1 hour
    };
    this.save();
    return token;
  }

  getResetToken(token) {
    this.data = this.load();
    if (!this.data.resetTokens) return null;
    return this.data.resetTokens[token] || null;
  }

  async verifyAndResetPassword(token, newPassword) {
    this.data = this.load();
    if (!this.data.resetTokens) {
      return { success: false, message: "Reset token is invalid or has expired." };
    }
    const record = this.data.resetTokens[token];
    if (!record || record.expiresAt < Date.now()) {
      return { success: false, message: "Reset link has expired or is invalid. Please request a new one." };
    }

    const targetEmail = (record.email || '').toLowerCase().trim();
    const targetUsername = (record.username || '').toLowerCase().trim();
    const studentCode = record.studentCode || (record.userId ? String(record.userId).replace(/^u-/, '') : null);

    // 1. Update in MySQL student table and users table via stored query in db.js
    let mysqlUpdated = false;
    try {
      const db = require('../db');
      mysqlUpdated = await db.updateUserPassword(studentCode, targetEmail, targetUsername || targetEmail, newPassword);
      console.log(`[DataStore] MySQL student password updated: studentCode=${studentCode}, email=${targetEmail}, updated=${mysqlUpdated}`);
    } catch (err) {
      console.warn('[DataStore] MySQL update error during password reset:', err.message);
    }

    // 2. Also update all matching user records in local dataStore
    let foundLocal = false;
    for (const u of (this.data.users || [])) {
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      const uCode = u.studentCode || (u.id ? String(u.id).replace(/^u-/, '') : null);
      if (
        (targetEmail && uEmail === targetEmail) ||
        (targetUsername && uUser === targetUsername) ||
        (studentCode && uCode === studentCode)
      ) {
        u.password = newPassword;
        foundLocal = true;
      }
    }

    if (!foundLocal && !mysqlUpdated) {
      return { success: false, message: "User account not found." };
    }

    // Invalidate token so it cannot be used again
    delete this.data.resetTokens[token];

    return { success: true, email: targetEmail };
  }

  async updateUserPassword(userId, newPassword) {
    this.data = this.load();
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: "User account not found." };
    }

    user.password = newPassword;

    // Update in MySQL student table via stored query in db.js
    try {
      const db = require('../db');
      const studentCode = user.studentCode || (String(userId).includes('STU') ? String(userId).replace(/^u-/, '') : null);
      const cleanEmail = (user.email || '').toLowerCase().trim();
      const cleanUsername = (user.username || '').toLowerCase().trim();

      const updated = await db.updateUserPassword(studentCode, cleanEmail, cleanUsername, newPassword);
      console.log(`[DataStore] updateUserPassword: MySQL student table updated: studentCode=${studentCode}, success=${updated}`);
    } catch (err) {
      console.warn('[MySQL] Error updating password in student table:', err.message);
    }

    this.save();
    return { success: true, email: user.email };
  }

  syncGoogleDriveFiles(userId, driveFiles = []) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    if (!user.documents || user.documents.length === 0) {
      user.documents = createDefaultDocuments();
    }

    let syncedCount = 0;
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleString('en-US', { month: 'short' });
    const year = now.getFullYear();
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formattedDate = `${day} ${month} ${year}, ${time}`;

    for (const file of driveFiles) {
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;

      // Check if file is already linked
      const alreadyLinked = user.documents.some(d => 
        d.driveFileId === file.driveFileId || 
        (d.versions && d.versions.some(v => v.driveFileId === file.driveFileId))
      );

      if (alreadyLinked) continue;

      // Look for first pending checklist item
      let targetDoc = user.documents.find(d => d.uploadStatus === "Upload Pending");

      // If no pending document exists, add a new one to the checklist
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
      targetDoc.uploadTimestamp = file.createdTime || now.toISOString();
      targetDoc.driveFileId = file.driveFileId;
      targetDoc.fileName = file.fileName;
      targetDoc.savedFileName = file.savedFileName || null;
      targetDoc.fileSize = file.fileSize;
      targetDoc.mimeType = file.mimeType;
      targetDoc.webViewLink = file.webViewLink || `/api/drive/files/${file.driveFileId}/view`;
      targetDoc.driveWebViewLink = file.driveWebViewLink || file.webViewLink;
      targetDoc.downloadUrl = file.downloadUrl;
      targetDoc.storageType = file.storageType || 'google_drive_cloud';
      targetDoc.versions = targetDoc.versions || [];
      const alreadyHasVer = targetDoc.versions.some(v => v.driveFileId === file.driveFileId);
      if (!alreadyHasVer) {
        targetDoc.versions.push(fileRecord);
      }
      targetDoc.currentVersion = Math.max(1, targetDoc.versions.length);
    }

    if (syncedCount > 0) {
      this.save();
    }

    return {
      syncedCount,
      documents: this.getUserDocuments(userId)
    };
  }

  getAllUsersWithDocuments() {
    this.data = this.load();
    return this.data.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department,
      documentsCount: (u.documents || []).length,
      uploadedCount: (u.documents || []).filter(d => d.uploadStatus === 'Uploaded').length,
      approvedCount: (u.documents || []).filter(d => d.approvalStatus === 'Approved').length,
      documents: (u.documents || []).map(d => ({
        ...d,
        permissions: this.calculatePermissions(d)
      }))
    }));
  }
}

module.exports = new DataStore();
