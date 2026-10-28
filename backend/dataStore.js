const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

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
    this.data = this.load();
  }

  load() {
    let loadedData = null;
    if (fs.existsSync(DB_FILE)) {
      try {
        const content = fs.readFileSync(DB_FILE, 'utf8');
        loadedData = JSON.parse(content);
      } catch (e) {
        console.error('Error reading db, using defaults:', e);
      }
    }
    if (!loadedData) {
      loadedData = getInitialData();
    }

    // Ensure student codes are assigned for all non-admin students
    let modified = false;
    if (loadedData && loadedData.users) {
      for (const u of loadedData.users) {
        if (u.role !== 'admin' && !u.studentCode) {
          this.ensureStudentCode(u, loadedData.users);
          modified = true;
        }
      }
    }
    if (modified) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(loadedData, null, 2), 'utf8');
      } catch (_) {}
    }
    return loadedData;
  }

  save(dataToSave) {
    const data = dataToSave || this.data;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving db:', e);
    }
    this.syncToMysql(data).catch(() => {});
  }

  async syncToMysql(dataToSave) {
    const data = dataToSave || this.data;
    try {
      const db = require('./db');
      const pool = db.getPool();
      if (!pool) return;

      for (const user of (data.users || [])) {
        if (user.role !== 'admin') {
          try {
            const studentCode = user.studentCode || (user.id && user.id.includes('STU') ? user.id.replace(/^u-/, '') : `STU${String((user.id || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
            await pool.query(`
              INSERT INTO student (Student_Id, Student_Name, Email, Username, Password, Unique_Id, Entry_date, DeleteStatus, Is_Registered)
              VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 1)
              ON DUPLICATE KEY UPDATE
                Student_Name=VALUES(Student_Name),
                Email=VALUES(Email),
                Username=VALUES(Username),
                Password=VALUES(Password),
                Unique_Id=VALUES(Unique_Id),
                DeleteStatus=0,
                Is_Registered=1
            `, [
              studentCode, user.name, user.email, user.username, user.password, studentCode
            ]);
          } catch (_) {}
        }

        if (user.documents && Array.isArray(user.documents)) {
          for (const doc of user.documents) {
            // Ensure document is registered in master `document` table
            try {
              await pool.query(`
                INSERT INTO document (Document_Id, Document_Name, Document_Type_Id, DeleteStatus)
                VALUES (?, ?, 1, 0)
                ON DUPLICATE KEY UPDATE Document_Name=VALUES(Document_Name), DeleteStatus=0
              `, [doc.id, doc.name]);
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
      const pool = db.getPool();
      if (!pool) return null;

      // 1. Load active students from MySQL student table
      const [students] = await pool.query(
        'SELECT Student_Id, Student_Name, Email, Username, Password, Unique_Id, Proceeding_Course_Name FROM student WHERE DeleteStatus = 0 OR DeleteStatus IS NULL'
      );
      if (!students || students.length === 0) return null;

      // 2. Load master checklist template from document table
      let [masterDocs] = await pool.query(
        'SELECT Document_Id, Document_Name, Document_Type_Id FROM document WHERE DeleteStatus = 0 ORDER BY Document_Id ASC'
      );
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

        // Get this student's uploaded documents (in chronological order) - supports both STU001 and legacy numeric ID
        const [stuDocs] = await pool.query(
          'SELECT * FROM student_document WHERE Student_Id = ? OR Student_Id = ? ORDER BY Student_Document_Id ASC',
          [studentCode, legacyNumId ? String(legacyNumId) : studentCode]
        );

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
              docItem.uploadStatus = 'Uploaded';
              docItem.fileName = latestActive.File_Name;
              docItem.webViewLink = latestActive.Image;
              docItem.downloadUrl = latestActive.Image;
              docItem.notes = latestActive.Description || '';
              docItem.currentVersion = activeRecords.length;
              docItem.uploadDateTime = latestActive.Entry_date ? new Date(latestActive.Entry_date).toLocaleDateString() : null;
              docItem.versions = activeRecords.map((r, idx) => ({
                versionNumber: idx + 1,
                fileName: r.File_Name,
                webViewLink: r.Image,
                downloadUrl: r.Image,
                notes: r.Description || '',
                uploadDateTime: r.Entry_date ? new Date(r.Entry_date).toLocaleDateString() : null,
                studentDocumentId: r.Student_Document_Id
              }));
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
              webViewLink: latestActive.Image,
              downloadUrl: latestActive.Image,
              notes: latestActive.Description || '',
              adminFeedback: '',
              versions: activeRecords.map((r, idx) => ({
                versionNumber: idx + 1,
                fileName: r.File_Name,
                webViewLink: r.Image,
                downloadUrl: r.Image,
                notes: r.Description || '',
                uploadDateTime: r.Entry_date ? new Date(r.Entry_date).toLocaleDateString() : null,
                studentDocumentId: r.Student_Document_Id
              }))
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
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (_) {}
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
          'SELECT * FROM student WHERE (LOWER(TRIM(Username)) = ? OR LOWER(TRIM(Email)) = ?) AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
          [cleanLower, cleanLower]
        );
        if (stuRows && stuRows.length > 0) {
          const s = stuRows[0];
          const expectedPass = s.Password || 'Password123';
          const match = expectedPass === password || expectedPass.toLowerCase() === (password || '').trim().toLowerCase();
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

        // 1b. Check users table (e.g. for admin logins)
        try {
          const [userRows] = await pool.query(
            'SELECT * FROM users WHERE LOWER(TRIM(username)) = ? OR LOWER(TRIM(email)) = ?',
            [cleanLower, cleanLower]
          );
          if (userRows && userRows.length > 0) {
            const u = userRows[0];
            const expectedPass = u.password;
            const match = expectedPass === password || (expectedPass || '').toLowerCase() === (password || '').trim().toLowerCase();
            if (!match) {
              return { error: 'Incorrect password.' };
            }
            return this.findUserById(u.id) || u;
          }
        } catch (_) {}

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

    const exactMatch = user.password === password;
    const caseMatch = (user.password || '').toLowerCase() === (password || '').trim().toLowerCase();
    if (!exactMatch && !caseMatch) {
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

      const newVersionRecord = {
        versionNumber: newVersionNum,
        uploadDateTime: formattedDate,
        uploadTimestamp: nowISO,
        driveFileId: fileResult.driveFileId,
        fileName: fileResult.fileName,
        savedFileName: fileResult.savedFileName || null,
        fileSize: fileResult.fileSize,
        mimeType: fileResult.mimeType,
        webViewLink: fileResult.webViewLink,
        downloadUrl: fileResult.downloadUrl || null,
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
        webViewLink: fileResult.webViewLink,
        downloadUrl: fileResult.downloadUrl || null,
        storageType: fileResult.storageType,
        notes: userNotes,
        adminFeedback: "",
        versions: updatedVersions
      };
    } else {
      // Create new dynamic document type (Requirement 1, 4, 8)
      targetDocId = user.documents.reduce((max, d) => Math.max(max, d.id || 0), 0) + 1;
      const docName = documentType && documentType.trim() ? documentType.trim() : `Document ${targetDocId}`;

      const newVersionRecord = {
        versionNumber: 1,
        uploadDateTime: formattedDate,
        uploadTimestamp: nowISO,
        driveFileId: fileResult.driveFileId,
        fileName: fileResult.fileName,
        savedFileName: fileResult.savedFileName || null,
        fileSize: fileResult.fileSize,
        mimeType: fileResult.mimeType,
        webViewLink: fileResult.webViewLink,
        downloadUrl: fileResult.downloadUrl || null,
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
        webViewLink: fileResult.webViewLink,
        downloadUrl: fileResult.downloadUrl || null,
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
      const pool = db.getPool();
      if (!pool) return null;

      const user = this.findUserById(userId);
      const studentCode = user?.studentCode || (userId && userId.includes('STU') ? userId.replace(/^u-/, '') : `STU${String((userId || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);

      // 1. Ensure master document catalog has this document
      await pool.query(`
        INSERT INTO document (Document_Id, Document_Name, Document_Type_Id, DeleteStatus)
        VALUES (?, ?, 1, 0)
        ON DUPLICATE KEY UPDATE Document_Name=VALUES(Document_Name), DeleteStatus=0
      `, [doc.id, doc.name]);

      // 2. Direct insert into student_document table (Every upload or re-upload creates a new row with STU001 format)
      if (studentCode) {
        const [insertRes] = await pool.query(`
          INSERT INTO student_document (
            Student_Id, Entry_date, File_Name, Document_Id, Document_Name, Image, Description, DeleteStatus
          ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, 0)
        `, [
          studentCode,
          fileResult.fileName || doc.fileName || doc.name,
          doc.id,
          doc.name,
          fileResult.webViewLink || fileResult.driveFileId || doc.webViewLink || '',
          userNotes || doc.notes || ''
        ]);
        return insertRes?.insertId || null;
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

      // If studentDocumentId is not mapped in memory, lookup the exact active row in MySQL
      if (!targetStudentDocId && pool) {
        try {
          const [activeRows] = await pool.query(
            'SELECT Student_Document_Id FROM student_document WHERE (Student_Id = ? OR Student_Id = ?) AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL) ORDER BY Student_Document_Id ASC',
            [studentCode, legacyNumId ? String(legacyNumId) : studentCode, numericDocId]
          );
          if (activeRows && activeRows[vNum - 1]) {
            targetStudentDocId = activeRows[vNum - 1].Student_Document_Id;
          }
        } catch (e) {
          console.error('[MySQL Delete Lookup Error]:', e.message);
        }
      }

      // SOFT-DELETE ONLY THAT ONE SPECIFIC ROW IN MySQL (DeleteStatus = 1)
      if (targetStudentDocId && pool) {
        try {
          await pool.query(
            'UPDATE student_document SET DeleteStatus = 1 WHERE Student_Document_Id = ?',
            [targetStudentDocId]
          );
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
      // 3. Full document deletion (no version specified)
      fileIdToDelete = doc.driveFileId;
      if (pool) {
        try {
          await pool.query(
            'UPDATE student_document SET DeleteStatus = 1 WHERE (Student_Id = ? OR Student_Id = ?) AND Document_Id = ? AND (DeleteStatus = 0 OR DeleteStatus IS NULL)',
            [studentCode, legacyNumId ? String(legacyNumId) : studentCode, numericDocId]
          );
        } catch (err) {
          console.error('[MySQL Full Delete Error]:', err.message);
        }
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
  createResetToken(email) {
    this.data = this.load();
    if (!this.data.resetTokens) {
      this.data.resetTokens = {};
    }
    const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    this.data.resetTokens[token] = {
      email,
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

    // 1. Update in MySQL directly (Primary DB)
    let mysqlUpdated = false;
    try {
      const db = require('./db');
      const pool = db.getPool();
      if (pool) {
        const [res] = await pool.query(
          'UPDATE users SET password = ? WHERE LOWER(TRIM(email)) = ?',
          [newPassword, targetEmail]
        );
        mysqlUpdated = res && (res.affectedRows > 0 || res.changedRows > 0);
        console.log(`[DataStore] MySQL password successfully updated for ${targetEmail}`);
      }
    } catch (err) {
      console.warn('[DataStore] MySQL update error during password reset:', err.message);
    }

    // 2. Also update all matching user records in local dataStore
    let foundLocal = false;
    for (const u of (this.data.users || [])) {
      if ((u.email || '').toLowerCase().trim() === targetEmail) {
        u.password = newPassword;
        foundLocal = true;
      }
    }

    if (!foundLocal && !mysqlUpdated) {
      return { success: false, message: "User account not found." };
    }

    // Invalidate token so it cannot be used again
    delete this.data.resetTokens[token];

    // Persist to JSON directly
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving db:', e);
    }

    return { success: true, email: targetEmail };
  }

  updateUserPassword(userId, newPassword) {
    const user = this.findUserById(userId);
    if (!user) {
      return { success: false, message: "User account not found." };
    }

    user.password = newPassword;
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
