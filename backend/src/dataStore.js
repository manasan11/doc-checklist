const path = require('path');
const db = require('./config/database');

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

function getInitialData() {
  return {
    users: [],
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

  async getMasterDocTemplates() {
    if (this.masterDocTemplates && this.masterDocTemplates.length === INITIAL_DOCUMENTS.length) {
      return this.masterDocTemplates;
    }
    this.masterDocTemplates = createDefaultDocuments();
    this.knownMasterDocIds = new Set(this.masterDocTemplates.map(d => d.id));
    return this.masterDocTemplates;
  }

  async getStudentList() {
    if (this.cachedStudentList && this.cachedStudentList.length > 0) {
      return this.cachedStudentList;
    }
    try {
      const students = await db.loadActiveStudents();
      this.cachedStudentList = (students || []).map(s => {
        const studentCode = String(s.Student_Id || s.Unique_Id || '').trim();
        return {
          id: `u-${studentCode}`,
          studentCode: studentCode,
          name: s.Student_Name || s.name || `Student ${studentCode}`,
          email: s.Email || s.email || '',
          username: s.Email || s.email || `student_${studentCode}`,
          role: 'user',
          department: s.Department_Name || s.department || 'General Operations',
          assignedStaff: s.Assigned_Staff || null,
          staffName: s.Staff_Name || null,
          staffEmail: s.Staff_Email || null,
          documents: []
        };
      });
      return this.cachedStudentList;
    } catch (err) {
      console.warn('[DataStore] Notice loading student list from MySQL:', err.message);
      return [];
    }
  }

  updateStudentInCache(studentId, updates = {}) {
    const cleanId = String(studentId).replace(/^u-/, '').trim().toLowerCase();
    if (this.cachedStudentList && Array.isArray(this.cachedStudentList)) {
      const idx = this.cachedStudentList.findIndex(s => {
        const code = String(s.studentCode || s.id || '').replace(/^u-/, '').trim().toLowerCase();
        return code === cleanId;
      });
      if (idx !== -1) {
        this.cachedStudentList[idx] = { ...this.cachedStudentList[idx], ...updates };
      }
    }
    const user = this.findUserById(studentId);
    if (user) {
      Object.assign(user, updates);
    }
  }

  matchDocumentTo11List(userDocs, docId, docName) {
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

  async loadFromMysql() {
    try {
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
      if (String(userId).startsWith('admin-')) {
        const staff = await db.findStaffOrAdminUser(String(userId).replace(/^admin-/, ''));
        if (staff) {
          const newAdmin = {
            id: staff.id,
            email: staff.email || '',
            username: staff.username || staff.name,
            name: staff.name,
            password: staff.password,
            role: staff.role,
            department: staff.department,
            documents: []
          };
          this.data.users.push(newAdmin);
          return newAdmin;
        }
      }

      const rawId = String(userId).replace(/^u-/, '').trim();
      const s = await db.findUserByIdentifier(rawId);
      if (s) {
        const studentCode = String(s.studentCode || rawId).trim();
        const newUser = {
          id: s.id || `u-${studentCode}`,
          email: s.email || '',
          username: s.username || s.email || `student_${studentCode}`,
          name: s.name || `Student ${studentCode}`,
          password: s.password || '',
          role: s.role || 'user',
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

  async getOrLoadUserDocuments(userId) {
    const user = await this.findOrLoadUser(userId);
    if (!user) return [];

    const strId = String(userId || '');
    const studentCode = user.studentCode || strId.replace(/^u-/, '').trim();
    const legacyNumId = /^\d+$/.test(studentCode) ? parseInt(studentCode, 10) : null;

    try {
      const templates = await this.getMasterDocTemplates();
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
        this.populateDocWithRecords(docItem, activeRecords);
      });

      unmappedRecords.forEach(r => {
        const docName = r.Document_Name || (r.Image ? path.basename(r.Image) : '');
        const matched = this.matchDocumentTo11List(user.documents, r.Document_Id, docName);
        if (matched) {
          this.populateDocWithRecords(matched, [r]);
        }
      });

      user.documents.sort((a, b) => a.id - b.id);
      this.save();
    } catch (err) {
      console.warn('[DataStore] Notice loading student documents from MySQL:', err.message);
    }

    return user.documents.map(doc => ({
      ...doc,
      permissions: this.calculatePermissions(doc)
    }));
  }

  findUserByEmailOrUsername(identifier) {
    if (!identifier) return null;
    this.data = this.load();
    const lower = identifier.toLowerCase().trim();
    return (this.data.users || []).find(u => {
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      return uEmail === lower || uUser === lower;
    });
  }

  async authenticateUser(identifier, password) {
    if (!identifier || !password) return null;
    const cleanId = String(identifier).trim();
    const cleanLower = cleanId.toLowerCase();
    const passTrim = String(password).trim();
    let accountExists = false;

    // 1. Check MySQL user_details table (Admin and Staff authentication)
    try {
      const staffUser = await db.findStaffOrAdminUser(cleanId);
      if (staffUser) {
        accountExists = true;
        const expectedPass = staffUser.password ? String(staffUser.password).trim() : null;
        if (expectedPass && expectedPass === passTrim) {
          let user = this.findUserById(staffUser.id);
          if (!user) {
            user = {
              id: staffUser.id,
              email: staffUser.email,
              username: staffUser.username,
              name: staffUser.name,
              password: staffUser.password,
              role: staffUser.role,
              department: staffUser.department,
              documents: []
            };
            this.data.users.push(user);
          } else {
            user.password = staffUser.password;
            user.role = staffUser.role;
          }
          return user;
        }
      }
    } catch (err) {
      console.warn('[DataStore] Notice querying user_details for login:', err.message);
    }

    // 2. Optional Environment Admin fallback (only if BOTH ADMIN_USERNAME and ADMIN_PASSWORD are explicitly configured)
    if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
      const envAdmin = process.env.ADMIN_USERNAME.trim().toLowerCase();
      if (cleanLower === envAdmin) {
        accountExists = true;
        if (passTrim === process.env.ADMIN_PASSWORD.trim()) {
          let user = this.findUserById('u-admin');
          if (!user) {
            user = {
              id: 'u-admin',
              email: process.env.SMTP_USER || '',
              username: process.env.ADMIN_USERNAME,
              name: 'Administrator',
              password: process.env.ADMIN_PASSWORD,
              role: 'admin',
              department: 'Operations & Compliance',
              documents: []
            };
            this.data.users.push(user);
          }
          return user;
        }
      }
    }

    // 3. Query MySQL student table
    try {
      const stu = await db.findUserByIdentifier(cleanId);
      if (stu) {
        accountExists = true;
        const expectedPass = stu.password ? String(stu.password).trim() : null;
        if (expectedPass && expectedPass === passTrim) {
          const user = await this.findOrLoadUser(stu.id);
          if (user) {
            user.password = expectedPass;
          }
          return user || stu;
        }
      }
    } catch (err) {
      console.warn('[DataStore] Notice querying MySQL for student login:', err.message);
    }

    // 4. Memory check for existing cached user
    this.data = this.load();
    const user = this.findUserByEmailOrUsername(cleanLower);
    if (user) {
      accountExists = true;
      if (user.password && String(user.password).trim() === passTrim) {
        return user;
      }
    }

    if (accountExists) {
      return { error: 'Incorrect password.' };
    }

    return { error: 'Account not found. Only registered users in the database can log in.' };
  }

  ensureStudentCode(user) {
    if (!user) return '';
    if (!user.studentCode) {
      user.studentCode = user.id ? String(user.id).replace(/^u-/, '').trim() : '';
    }
    return user.studentCode;
  }

  getStudentFolderSlug(user) {
    const code = this.ensureStudentCode(user);
    const cleanName = (user.name || 'Student')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    return code ? `${code}_${cleanName}` : cleanName;
  }

  setUserDriveFolder(userId, folderId, folderName) {
    const user = this.findUserById(userId);
    if (user) {
      user.driveFolderId = folderId;
      user.driveFolderName = folderName;
      this.save();
    }
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
            storageType: 'google_drive_cloud',
            notes: "",
            adminFeedback: "",
            versions: []
          });
          changed = true;
        } else if (existing.name !== initDoc.name || existing.description !== initDoc.description) {
          existing.name = initDoc.name;
          existing.description = initDoc.description;
          changed = true;
        }
      });
      user.documents.sort((a, b) => a.id - b.id);
      if (changed) this.save();
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

  calculatePermissions(doc) {
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

  async saveDocumentUpload(userId, docId, fileResult, userNotes = "", documentType = null) {
    const user = this.findUserById(userId);
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
      const user = this.findUserById(userId);
      const strId = String(userId || '');
      const studentCode = user?.studentCode || strId.replace(/^u-/, '').trim();
      const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

      if (!this.knownMasterDocIds || !this.knownMasterDocIds.has(doc.id)) {
        await db.ensureMasterDocument(doc.id, doc.name);
        if (this.knownMasterDocIds) this.knownMasterDocIds.add(doc.id);
      }

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
    const numericDocId = parseInt(docId, 10);
    const user = this.findUserById(userId);
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

    this.save();

    if (fileIdToDelete && !fileIdToDelete.startsWith('local_') && !fileIdToDelete.startsWith('gdrive_')) {
      const isReferencedByOther = (this.data.users || []).some(u => 
        u.id !== userId && (u.documents || []).some(d => 
          d.driveFileId === fileIdToDelete || 
          (d.versions && d.versions.some(v => v.driveFileId === fileIdToDelete))
        )
      );
      if (!isReferencedByOther) {
        try {
          const driveService = require('./services/drive.service');
          driveService.deleteFile(fileIdToDelete).catch(() => {});
        } catch (_) {}
      }
    }

    return this.getDocumentById(userId, numericDocId);
  }

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

  createResetToken(email, user = null) {
    this.data = this.load();
    if (!this.data.resetTokens) {
      this.data.resetTokens = {};
    }
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
      expiresAt: Date.now() + 3600000
    };
    this.save();
    return token;
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

    let mysqlUpdated = false;
    try {
      mysqlUpdated = await db.updateUserPassword(studentCode, targetEmail, targetUsername || targetEmail, newPassword);
    } catch (err) {
      console.warn('[DataStore] MySQL update error during password reset:', err.message);
    }

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

    delete this.data.resetTokens[token];
    return { success: true, email: targetEmail };
  }

  async updateUserPassword(userId, newPassword) {
    this.data = this.load();
    let user = this.findUserById(userId);
    if (!user) {
      user = await this.findOrLoadUser(userId);
    }
    if (!user) {
      return { success: false, message: "User account not found." };
    }

    user.password = newPassword;

    try {
      const studentCode = user.studentCode || String(userId || '').replace(/^u-/, '').trim();
      const cleanEmail = (user.email || '').toLowerCase().trim();
      const cleanUsername = (user.username || '').toLowerCase().trim();
      await db.updateUserPassword(studentCode, cleanEmail, cleanUsername, newPassword);
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
