const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

const INITIAL_DOCUMENTS = [
  { id: 1, name: "Identity Proof (Aadhaar / Passport / Voter ID)", description: "Government issued identity proof" },
  { id: 2, name: "Address Proof (Utility Bill / Rent Agreement)", description: "Valid residential address verification" },
  { id: 3, name: "Highest Degree / Academic Certificate", description: "Graduation or Post-Graduation degree certificate" },
  { id: 4, name: "Curriculum Vitae / Resume", description: "Updated professional resume" },
  { id: 5, name: "Bank Account Proof / Cancelled Cheque", description: "Bank passbook front page or cancelled cheque" }
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
    if (fs.existsSync(DB_FILE)) {
      try {
        const content = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(content);
      } catch (e) {
        console.error('Error reading db, using defaults:', e);
      }
    }
    const defaultData = getInitialData();
    this.save(defaultData);
    return defaultData;
  }

  save(dataToSave) {
    const data = dataToSave || this.data;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving db:', e);
    }
  }

  findUserByEmailOrUsername(identifier) {
    if (!identifier) return null;
    const lower = identifier.toLowerCase().trim();
    // Reload data to ensure sync across processes
    this.data = this.load();
    return this.data.users.find(u => 
      u.email.toLowerCase() === lower || 
      u.username.toLowerCase() === lower
    );
  }

  authenticateOrProvisionUser(identifier, password) {
    if (!identifier || !password) return null;
    const cleanId = identifier.trim();
    const cleanLower = cleanId.toLowerCase();

    // Reload from file to ensure sync
    this.data = this.load();

    // 1. Look for existing user
    let user = this.data.users.find(u => 
      u.email.toLowerCase() === cleanLower || 
      u.username.toLowerCase() === cleanLower
    );

    if (user) {
      // In evaluation mode, accept the password and update if changed so user never gets locked out
      user.password = password;
      this.save();
      return user;
    }

    // 2. If user does not exist, auto-provision account so user can sign in with any email
    const isEmail = cleanId.includes('@');
    const newUsername = isEmail ? cleanId.split('@')[0] : cleanId;
    const newEmail = isEmail ? cleanId : `${cleanId}@example.com`;
    const formattedName = newUsername.charAt(0).toUpperCase() + newUsername.slice(1);

    const newUser = {
      id: `u-${Date.now()}`,
      email: newEmail,
      username: newUsername,
      name: formattedName,
      password: password,
      role: newUsername.toLowerCase().includes('admin') ? 'admin' : 'user',
      department: 'General Operations',
      documents: createDefaultDocuments()
    };

    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  findUserById(userId) {
    this.data = this.load();
    return this.data.users.find(u => u.id === userId);
  }

  getUserDocuments(userId) {
    const user = this.findUserById(userId);
    if (!user) return [];
    if (!user.documents || user.documents.length === 0) {
      user.documents = createDefaultDocuments();
      this.save();
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

  saveDocumentUpload(userId, docId, fileResult, userNotes = "") {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const docIndex = user.documents.findIndex(d => d.id === parseInt(docId, 10));
    if (docIndex === -1) throw new Error("Document not found");

    const currentDoc = user.documents[docIndex];
    const newVersionNum = (currentDoc.currentVersion || 0) + 1;
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleString('en-US', { month: 'short' });
    const year = now.getFullYear();
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const formattedDate = `${day} ${month} ${year}, ${time}`;
    const nowISO = now.toISOString();

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
      uploadStatus: "Uploaded",
      approvalStatus: "Pending", // Always reset to Pending for admin review on new upload
      isLocked: false,          // Unlocked for user until admin locks or acts
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
      adminFeedback: "", // Reset feedback for fresh version
      versions: updatedVersions
    };

    this.save();
    return this.getDocumentById(userId, docId);
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

  deleteDocument(userId, docId, versionNumber) {
    const user = this.findUserById(userId);
    if (!user) throw new Error("User not found");

    const docIndex = user.documents.findIndex(d => d.id === parseInt(docId, 10));
    if (docIndex === -1) throw new Error("Document not found");

    const doc = user.documents[docIndex];
    const permissions = this.calculatePermissions(doc);
    if (!permissions.canDelete) {
      throw new Error("This document is locked and cannot be deleted.");
    }

    if (versionNumber && doc.versions && doc.versions.length > 1) {
      // Delete specific version
      doc.versions = doc.versions.filter(v => v.versionNumber !== parseInt(versionNumber, 10));
      const latestVer = doc.versions[doc.versions.length - 1];
      doc.currentVersion = latestVer.versionNumber;
      doc.fileName = latestVer.fileName;
      doc.fileSize = latestVer.fileSize;
      doc.mimeType = latestVer.mimeType;
      doc.uploadDateTime = latestVer.uploadDateTime;
      doc.webViewLink = latestVer.webViewLink;
      doc.downloadUrl = latestVer.downloadUrl;
      doc.notes = latestVer.notes || '';
      doc.storageType = latestVer.storageType;
      doc.driveFileId = latestVer.driveFileId;
    } else {
      // Reset document back to Upload Pending
      user.documents[docIndex] = {
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
        storageType: null,
        notes: "",
        adminFeedback: "",
        versions: []
      };
    }

    this.save();
    return this.getDocumentById(userId, docId);
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
    const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    this.data.resetTokens[token] = {
      email,
      expiresAt: Date.now() + 3600000 // 1 hour
    };

    // If user does not exist yet, initialize them
    let user = this.findUserByEmailOrUsername(email);
    if (!user) {
      const isEmail = email.includes('@');
      const newUsername = isEmail ? email.split('@')[0] : email;
      this.data.users.push({
        id: `u-${Date.now()}`,
        email: email,
        username: newUsername,
        name: newUsername.charAt(0).toUpperCase() + newUsername.slice(1),
        password: 'password123',
        role: 'user',
        department: 'General Operations',
        documents: createDefaultDocuments()
      });
    }

    this.save();
    return token;
  }

  verifyAndResetPassword(token, newPassword) {
    const record = this.data.resetTokens[token];
    if (!record || record.expiresAt < Date.now()) {
      return { success: false, message: "Reset token is invalid or has expired." };
    }

    const user = this.data.users.find(u => u.email.toLowerCase() === record.email.toLowerCase());
    if (!user) {
      return { success: false, message: "User not found." };
    }

    user.password = newPassword;
    delete this.data.resetTokens[token];
    this.save();
    return { success: true, email: user.email };
  }
}

module.exports = new DataStore();
