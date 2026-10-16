# DocuVault - Angular Document Checklist & Google Drive Storage System

A modern, full-stack enterprise document checklist and verification platform built with **Angular (v21)** and **Node.js/Express**, featuring direct **Google Drive cloud storage integration**, multi-version document tracking, granular permission matrices, and administrative review workflows.

---

## 🌟 Key Features & Requirements Matrix

### 1. User Authentication & Password Recovery
- **Login Page**: Responsive authentication interface with Email/Username & Password fields.
- **Forgot Password**: Self-service reset token generation with instant visual feedback.
- **Password Reset**: Secure token verification and password update form.
- **Role Switching**: Demo buttons for instant 1-click login as **Employee (Johnathan Doe)** or **Compliance Admin (Sarah Jenkins)**.

### 2. User Dashboard & 10 Required Documents
- **Header**: Displays logged-in user name (`Johnathan Doe`), department, role badge, and Google Drive cloud connection status.
- **Checklist Columns**:
  1. `No.` (#1 to #10)
  2. `Document Name` (with subtitle, version badge, and lock icon)
  3. `Upload Status` (`Upload Pending` / `Uploaded`)
  4. `Upload / Re-upload` (Dynamic action button based on state)
  5. `View Document` (Modal viewer with file preview, Drive ID, and version history)
  6. `Upload Date & Time` (Exact formatted timestamp per upload)
  7. `Approval Status` (`Pending`, `Approved`, `Rejected`)
  8. `Edit` (Modify display name and metadata when unlocked)
  9. `Delete` (Purge and reset checklist item when unlocked)
  10. `Admin Review` (Compliance review panel)

### 3. Strict Permission Matrix Implementation

| Document State | Upload / Re-upload | View | Edit | Delete | Notes |
|---|---|---|---|---|---|
| **Upload Pending** | ✅ Allowed | ❌ Disabled | ❌ Disabled | ❌ Disabled | Initial document upload |
| **Uploaded + Unlocked** | ✅ Re-upload | ✅ Allowed | ✅ Allowed | ✅ Allowed | Full access prior to review lock |
| **Uploaded + Locked** | ❌ Disabled | ✅ Allowed | ❌ Disabled | ❌ Disabled | Locked under review |
| **Rejected + Unlocked** | ✅ Re-upload | ✅ Allowed | ✅ Allowed | ✅ Allowed | User can fix issues |
| **Rejected + Locked** | ✅ **New Version** | ✅ Allowed | ❌ Disabled | ❌ Disabled | **Special Rule 8**: Preserves rejected file, allows corrected upload |
| **Approved + Locked** | ❌ Disabled | ✅ Allowed | ❌ Disabled | ❌ Disabled | Verified and completed |

### 4. Multi-Version Document History
- Every re-upload increments version number (`v1`, `v2`, `v3`...).
- Historical uploads remain permanently stored in Google Drive and can be inspected in the Document Viewer timeline with their respective timestamps.

### 5. Google Drive Cloud Storage
- **Direct App Uploads**: The user never needs to leave the app or manually open Google Drive. Files are uploaded directly to the backend and streamed to Google Drive API.
- **Dual Mode Support**:
  - **Live Google Drive API**: Set `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_CLIENT_EMAIL`, and `GOOGLE_PRIVATE_KEY` in `server/.env`.
  - **Emulated Google Drive Mode**: Zero-configuration default that stores files locally while strictly maintaining the Google Drive schema (`driveFileId`, `webViewLink`, `downloadUrl`).

---

## 🚀 Running the Project

### Prerequisites
- Node.js (v18+)
- Angular CLI

### 1. Start Both Together (Recommended)
```bash
cd f:\mine\UFS_pro\checklist
npm run dev
```
This automatically boots both:
- **Backend API**: `http://localhost:5000`
- **Frontend App**: `http://localhost:4200`

### 2. Or Start Separately:
```bash
# Start Backend only
npm run backend

# Start Frontend only
npm run frontend
```

---

## 👤 Demo Credentials

| Role | Username / Email | Password | Permissions |
|---|---|---|---|
| **Employee** | `johndoe` / `john.doe@example.com` | `password123` | Upload, Re-upload, View, Edit, Delete |
| **Compliance Admin** | `admin` / `admin@example.com` | `adminpassword` | Approve, Reject with remarks, Lock/Unlock |
