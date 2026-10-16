export interface DocumentPermissions {
  canUpload: boolean;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  uploadLabel: string;
}

export interface DocumentVersion {
  versionNumber: number;
  uploadDateTime: string;
  uploadTimestamp: string;
  driveFileId: string;
  fileName: string;
  savedFileName?: string;
  fileSize: number;
  mimeType: string;
  webViewLink: string;
  downloadUrl?: string;
  storageType: string;
  notes?: string;
  approvalStatusAtUpload: string;
}

export interface DocumentItem {
  id: number;
  name: string;
  description: string;
  uploadStatus: 'Upload Pending' | 'Uploaded' | 'Verifying' | 'Accepted' | 'Rejected';
  approvalStatus: 'Pending' | 'Approved' | 'Rejected' | 'Accepted';
  isLocked: boolean;
  currentVersion: number;
  uploadDateTime: string | null;
  driveFileId: string | null;
  fileName: string | null;
  savedFileName?: string | null;
  fileSize: number | null;
  mimeType: string | null;
  webViewLink: string | null;
  downloadUrl?: string | null;
  storageType: string | null;
  notes: string;
  adminFeedback: string;
  versions: DocumentVersion[];
  permissions: DocumentPermissions;
}

export interface ChecklistResponse {
  userId: string;
  totalDocuments: number;
  uploadedCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  documents: DocumentItem[];
}

export interface DriveStatus {
  mode: 'live_google_drive' | 'emulated_google_drive';
  configured: boolean;
  folderId: string;
  folderUrl?: string;
  authMode?: 'oauth2' | 'service_account' | 'apps_script' | 'none';
  hasServiceAccount: boolean;
  hasOAuth?: boolean;
  hasAppsScript?: boolean;
  message: string;
}
