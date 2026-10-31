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
  { id: 11, name: "Medical", description: "Medical fitness certificate and health examination report" },
  { id: 12, name: "Aadhaar Card", description: "Uploaded Aadhaar Card" },
  { id: 13, name: "PAN Card", description: "Uploaded PAN Card" },
  { id: 14, name: "Resume", description: "Uploaded Resume" },
  { id: 15, name: "Degree Certificate", description: "Uploaded Degree Certificate" },
  { id: 16, name: "Special / Document : Test *", description: "Uploaded Special / Document : Test *" }
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
        id: "u-1",
        email: "john.doe@example.com",
        username: "johndoe",
        name: "Johnathan Doe",
        studentCode: "STU001",
        driveFolderId: null,
        driveFolderName: null,
        password: "password123",
        role: "user",
        department: "Engineering & Architecture",
        documents: createDefaultDocuments()
      },
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
    this.syncToMysql(this.data).catch(() => {});
  }

  async syncToMysql(dataToSave) {
    const data = dataToSave || this.data;
    try {
      const db = require('./db');

      for (const user of (data.users || [])) {
        if (user.role !== 'admin') {
          try {
            const studentCode = user.studentCode || (user.id && user.id.includes('STU') ? user.id.replace(/^u-/, '') : `STU${String((user.id || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
            await db.upsertStudent(studentCode, user.name, user.email, user.username, user.password);
          } catch (_) {}
        }

        if (user.documents && Array.isArray(user.documents)) {
          for (const doc of user.documents) {
            try {
              await db.ensureMasterDocument(doc.id, doc.name);
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      // Graceful fallback
    }
  }

  async loadFromMysql() {
    try {
      const db = require('./db');

      // 1. Load active students from MySQL student table via stored query in db.js
      const students = await db.loadActiveStudents();
      if (!students || students.length === 0) return null;

      // 2. Load master checklist template from document table via stored query in db.js
      let masterDocs = await db.loadMasterDocuments();
      if (!masterDocs || masterDocs.length === 0) {
        masterDocs = INITIAL_DOCUMENTS.map(d => ({ Document_Id: d.id, Document_Name: d.name }));
      }

      const defaultDocTemplates = masterDocs.map(d => ({
        id: d.Document_Id,
        name: d.Document_Name,
        description: `Uploaded ${d.Document_Name}`,
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

      // Preserve admin user from local memory/file
      const loadedUsers = (this.data && this.data.users ? this.data.users.filter(u => u.role === 'admin') : []);
      if (loadedUsers.length === 0) {
        loadedUsers.push({
          id: "u-admin",
          email: "admin@example.com",
          username: "admin",
          name: "Sarah Jenkins (Compliance Admin)",
          password: "adminpassword",
          role: "admin",
          department: "Compliance & HR Audit",
          documents: []
        });
      }

      // 3. For each student, map their checklist and uploaded files from student_document
      for (const s of students) {
        const studentCode = s.Student_Id || s.Unique_Id;
        const sid = `u-${studentCode}`;
        const userDocs = JSON.parse(JSON.stringify(defaultDocTemplates));

        const numPart = (studentCode || '').replace(/\D/g, '');
        const legacyNumId = numPart ? parseInt(numPart, 10) : null;

        // Get this student's uploaded documents via stored query in db.js
        const stuDocs = await db.getStudentUploadedDocuments(studentCode, legacyNumId);

        // Group student_document rows by Document_Id to support all re-uploaded files / versions
        const docsByDocId = new Map();
        for (const sd of (stuDocs || [])) {
          if (!docsByDocId.has(sd.Document_Id)) {
            docsByDocId.set(sd.Document_Id, []);
          }
          docsByDocId.get(sd.Document_Id).push(sd);
        }

        for (const [docId, records] of docsByDocId.entries()) {
          const docItem = userDocs.find(d => d.id === docId);
          const activeRecords = records.filter(r => r.DeleteStatus === 0 && r.File_Name);

          if (docItem) {
            if (activeRecords.length > 0) {
              const latestActive = activeRecords[activeRecords.length - 1];
              const latestDriveUrl = toGoogleDriveViewUrl(latestActive.Image);
              const driveFileIdMatch = (latestDriveUrl || '').match(/\/file\/d\/([^\/]+)/);
              const latestDriveId = driveFileIdMatch ? driveFileIdMatch[1] : null;

              docItem.uploadStatus = 'Uploaded';
              docItem.fileName = latestActive.File_Name;
              docItem.webViewLink = latestDriveUrl;
              docItem.downloadUrl = latestDriveUrl;
              docItem.driveFileId = latestDriveId || docItem.driveFileId;
              docItem.notes = latestActive.Description || '';
              docItem.currentVersion = activeRecords.length;
              docItem.uploadDateTime = latestActive.Entry_date ? new Date(latestActive.Entry_date).toLocaleDateString() : null;
              docItem.versions = activeRecords.map((r, idx) => {
                const verDriveUrl = toGoogleDriveViewUrl(r.Image);
                const verIdMatch = (verDriveUrl || '').match(/\/file\/d\/([^\/]+)/);
                return {
                  versionNumber: idx + 1,
                  fileName: r.File_Name,
                  webViewLink: verDriveUrl,
                  downloadUrl: verDriveUrl,
                  driveFileId: verIdMatch ? verIdMatch[1] : null,
                  notes: r.Description || '',
                  uploadDateTime: r.Entry_date ? new Date(r.Entry_date).toLocaleDateString() : null,
                  studentDocumentId: r.Student_Document_Id
                };
              });
            } else {
              docItem.uploadStatus = 'Upload Pending';
              docItem.fileName = null;
              docItem.webViewLink = null;
              docItem.currentVersion = 0;
              docItem.versions = [];
            }
          } else if (activeRecords.length > 0) {
            // Custom document added in student_document
            const latestActive = activeRecords[activeRecords.length - 1];
            const latestDriveUrl = toGoogleDriveViewUrl(latestActive.Image);
            const driveFileIdMatch = (latestDriveUrl || '').match(/\/file\/d\/([^\/]+)/);
            const latestDriveId = driveFileIdMatch ? driveFileIdMatch[1] : null;

            userDocs.push({
              id: docId,
              name: latestActive.Document_Name || `Document ${docId}`,
              description: latestActive.Description || 'Uploaded document',
              uploadStatus: 'Uploaded',
              approvalStatus: 'Pending',
              isLocked: false,
              currentVersion: activeRecords.length,
              uploadDateTime: latestActive.Entry_date ? new Date(latestActive.Entry_date).toLocaleDateString() : null,
              fileName: latestActive.File_Name,
              webViewLink: latestDriveUrl,
              downloadUrl: latestDriveUrl,
              driveFileId: latestDriveId,
              notes: latestActive.Description || '',
              adminFeedback: '',
              versions: activeRecords.map((r, idx) => {
                const verDriveUrl = toGoogleDriveViewUrl(r.Image);
                const verIdMatch = (verDriveUrl || '').match(/\/file\/d\/([^\/]+)/);
                return {
                  versionNumber: idx + 1,
                  fileName: r.File_Name,
                  webViewLink: verDriveUrl,
                  downloadUrl: verDriveUrl,
                  driveFileId: verIdMatch ? verIdMatch[1] : null,
                  notes: r.Description || '',
                  uploadDateTime: r.Entry_date ? new Date(r.Entry_date).toLocaleDateString() : null,
                  studentDocumentId: r.Student_Document_Id
                };
              })
            });
          }
        }

        // Preserve driveFolder info from existing in-memory user if available
        const existingMemUser = (this.data && this.data.users) ? this.findUserById(sid) : null;

        loadedUsers.push({
          id: sid,
          email: s.Email,
          username: s.Username || (s.Email ? s.Email.split('@')[0] : `student_${studentCode}`),
          name: s.Student_Name,
          password: s.Password || 'Password123',
          role: 'user',
          department: s.Proceeding_Course_Name || 'General Operations',
          studentCode: studentCode,
          driveFolderId: existingMemUser ? existingMemUser.driveFolderId : null,
          driveFolderName: existingMemUser ? existingMemUser.driveFolderName : null,
          documents: userDocs
        });
      }

      this.data.users = loadedUsers;
      return this.data;
    } catch (err) {
      console.error('[MySQL Load Notice]:', err.message);
      return null;
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
    const cleanId = identifier.trim();
    const cleanLower = cleanId.toLowerCase();

    // 1. Strict check against MySQL database if connected
    try {
      const db = require('./db');
      const pool = db.getPool();
      if (pool) {
        // Sync memory and database.json with current MySQL users (so deleted users vanish)
        await this.loadFromMysql();

        // 1a. Check student table first for student logins (Matches MySQL Workbench)
        const [stuRows] = await pool.query(
          'SELECT * FROM student WHERE (LOWER(TRIM(Username)) = ? OR LOWER(TRIM(Email)) = ? OR Student_Id = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [cleanLower, cleanLower, cleanId]
        );
        if (stuRows && stuRows.length > 0) {
          const s = stuRows[0];
          const expectedPass = s.Password ? String(s.Password).trim() : 'Password123';
          const match = expectedPass === String(password).trim();
          if (!match) {
            return { error: 'Incorrect password.' };
          }
          return this.findUserById(`u-${s.Student_Id}`) || {
            id: `u-${s.Student_Id}`,
            email: s.Email,
            username: s.Username || s.Email,
            name: s.Student_Name,
            role: 'user',
            department: s.Proceeding_Course_Name || 'General Operations'
          };
        }

        // 1b. Check administrator login
        const adminUser = (this.data.users || []).find(u => u.role === 'admin' && (u.username.toLowerCase() === cleanLower || u.email.toLowerCase() === cleanLower));
        if (adminUser) {
          const expectedPass = adminUser.password ? String(adminUser.password).trim() : 'adminpassword';
          const match = expectedPass === String(password).trim();
          if (!match) {
            return { error: 'Incorrect password.' };
          }
          return adminUser;
        }

        return { error: 'Account not found. Only registered users in the database can log in.' };
      }
    } catch (err) {
      console.warn('[DataStore] Notice querying MySQL for login:', err.message);
    }

    // 2. Fallback to local dataStore only if MySQL is not available
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

  ensureStudentCode(user, userList = null) {
    if (!user || user.role === 'admin') return null;
    if (user.studentCode && typeof user.studentCode === 'string' && user.studentCode.startsWith('STU')) return user.studentCode;

    // Fixed mappings for default known users
    if (user.id === 'u-1' || user.email === 'john.doe@example.com' || user.username === 'johndoe') {
      user.studentCode = 'STU001';
      return user.studentCode;
    }
    if (user.id === 'u-2' || user.email === 'demo@example.com' || user.username === 'demo') {
      user.studentCode = 'STU002';
      return user.studentCode;
    }
    if (user.id === 'u-3' || user.username === 'manu' || (user.email && user.email.toLowerCase().includes('manasan'))) {
      user.studentCode = 'STU003';
      return user.studentCode;
    }

    const allUsers = userList || (this.data && this.data.users) || [];
    const usedNumbers = new Set();
    for (const u of allUsers) {
      if (u !== user && u.studentCode && typeof u.studentCode === 'string' && u.studentCode.startsWith('STU')) {
        const num = parseInt(u.studentCode.substring(3), 10);
        if (!isNaN(num)) usedNumbers.add(num);
      }
    }
    let nextNum = 1;
    while (usedNumbers.has(nextNum)) {
      nextNum++;
    }
    user.studentCode = `STU${String(nextNum).padStart(3, '0')}`;
    return user.studentCode;
  }

  getStudentFolderSlug(user) {
    const code = this.ensureStudentCode(user) || 'STU001';
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
    const cleanId = String(userId).trim();
    const numPart = cleanId.replace(/\D/g, '');
    let user = this.data.users.find(u => {
      if (u.id === cleanId) return true;
      if (u.studentCode && (u.studentCode === cleanId || `u-${u.studentCode}` === cleanId)) return true;
      if (numPart && u.studentCode === `STU${String(numPart).padStart(3, '0')}`) return true;
      if (numPart && (u.id || '').replace(/\D/g, '') === numPart) return true;
      return false;
    });
    if (!user) {
      if (cleanId === 'u-1792558150978-147' || cleanId === 'u-2') {
        user = this.data.users.find(u => u.id === 'u-2' || u.id === 'u-1792558150978-147' || u.email === 'demo@example.com');
      } else if (cleanId === 'u-1792558257163-754' || cleanId === 'u-3') {
        user = this.data.users.find(u => u.id === 'u-3' || u.id === 'u-1792558257163-754' || u.email === 'user@demo');
      }
    }
    return user;
  }

  getUserDocuments(userId) {
    const user = this.findUserById(userId);
    if (!user) return [];
    if (!user.documents || user.documents.length === 0) {
      user.documents = createDefaultDocuments();
      this.save();
    } else {
      let changed = false;
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
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleString('en-US', { month: 'short' });
    const year = now.getFullYear();
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formattedDate = `${day} ${month} ${year}, ${time}`;
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
      const db = require('./db');

      const user = this.findUserById(userId);
      const studentCode = user?.studentCode || (userId && userId.includes('STU') ? userId.replace(/^u-/, '') : `STU${String((userId || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
      const directDriveLink = toGoogleDriveViewUrl(fileResult.driveWebViewLink || fileResult.webViewLink, fileResult.driveFileId);

      // 1. Ensure master document catalog has this document via stored query in db.js
      await db.ensureMasterDocument(doc.id, doc.name);

      // 2. Direct insert into student_document table via stored query in db.js
      if (studentCode) {
        return await db.insertStudentDocument(
          studentCode,
          fileResult.fileName || doc.fileName || doc.name,
          doc.id,
          doc.name,
          directDriveLink,
          userNotes || doc.notes || ''
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
    const db = require('./db');
    const pool = db.getPool();
    const numericDocId = parseInt(docId, 10);

    // 1. Always refresh from MySQL first so we operate on real database state
    if (pool) {
      try {
        await this.loadFromMysql();
      } catch (_) {}
    }

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
          const driveService = require('./driveService');
          driveService.deleteFile(fileIdToDelete).catch(() => {});
        } catch (_) {}
      }
    }

    // Finally re-sync with MySQL so in-memory representation matches MySQL 100%
    if (pool) {
      try {
        await this.loadFromMysql();
      } catch (_) {}
    }

    return this.getDocumentById(userId, numericDocId);
  }

  // Admin Review and Lock Methods
  adminReviewDocument(userId, docId, { approvalStatus, isLocked, adminFeedback }) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const doc = user.documents.find(d => d.id === parseInt(docId, 10));
    if (!doc) throw new Error("Document not found");

    if (approvalStatus) {
      if (!["Pending", "Approved", "Rejected"].includes(approvalStatus)) {
        throw new Error("Invalid approval status");
      }
      doc.approvalStatus = approvalStatus;
    }

    if (typeof isLocked === 'boolean') {
      doc.isLocked = isLocked;
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
      const db = require('./db');
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

    // Reload from MySQL so in-memory user objects reflect the new password
    try {
      await this.loadFromMysql();
    } catch (_) {}

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
      const db = require('./db');
      const studentCode = user.studentCode || (String(userId).includes('STU') ? String(userId).replace(/^u-/, '') : null);
      const cleanEmail = (user.email || '').toLowerCase().trim();
      const cleanUsername = (user.username || '').toLowerCase().trim();

      const updated = await db.updateUserPassword(studentCode, cleanEmail, cleanUsername, newPassword);
      console.log(`[DataStore] updateUserPassword: MySQL student table updated: studentCode=${studentCode}, success=${updated}`);
    } catch (err) {
      console.warn('[MySQL] Error updating password in student table:', err.message);
    }

    this.save();
    try {
      await this.loadFromMysql();
    } catch (_) {}

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
