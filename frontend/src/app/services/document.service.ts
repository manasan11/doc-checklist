import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ChecklistResponse, DocumentItem, DocumentVersion, DriveStatus } from '../models/document.model';
import { AuthService } from './auth.service';

const API_URL = (typeof window !== 'undefined' && window.location.port === '4200') ? 'http://localhost:5000/api' : '/api';

const STORAGE_KEY = 'docuvault_documents_v3';

const INITIAL_DOCUMENTS: Array<{ id: number; name: string; description: string }> = [
  { id: 1, name: "Identity Proof (Aadhaar / Passport / Voter ID)", description: "Government issued identity proof" },
  { id: 2, name: "Address Proof (Utility Bill / Rent Agreement)", description: "Valid residential address verification" },
  { id: 3, name: "Highest Degree / Academic Certificate", description: "Graduation or Post-Graduation degree certificate" },
  { id: 4, name: "Curriculum Vitae / Resume", description: "Updated professional resume" },
  { id: 5, name: "Bank Account Proof / Cancelled Cheque", description: "Bank passbook front page or cancelled cheque" }
];

function formatCurrentDateTime(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');
  return `${day} ${month} ${year}, ${strHours}:${minutes} ${ampm}`;
}

function calculatePermissions(doc: Partial<DocumentItem>) {
  const isUploaded = doc.uploadStatus !== 'Upload Pending' && (doc.currentVersion || 0) > 0;
  const isLocked = !!doc.isLocked;
  return {
    canUpload: !isLocked,
    canView: isUploaded,
    canEdit: isUploaded && !isLocked,
    canDelete: isUploaded && !isLocked,
    uploadLabel: isUploaded ? 'Re-upload' : 'Upload'
  };
}

function createDefaultDocuments(): DocumentItem[] {
  return INITIAL_DOCUMENTS.map(item => {
    const doc: Partial<DocumentItem> = {
      id: item.id,
      name: item.name,
      description: item.description,
      uploadStatus: 'Upload Pending',
      approvalStatus: 'Pending',
      isLocked: false,
      currentVersion: 0,
      uploadDateTime: null,
      driveFileId: null,
      fileName: null,
      fileSize: null,
      mimeType: null,
      webViewLink: null,
      downloadUrl: null,
      storageType: 'Client Storage',
      notes: '',
      adminFeedback: '',
      versions: []
    };
    doc.permissions = calculatePermissions(doc);
    return doc as DocumentItem;
  });
}

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private inMemoryDocs: DocumentItem[] = [];

  constructor() {
    this.inMemoryDocs = this.loadDocs();
  }

  private loadDocs(): DocumentItem[] {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem('docuvault_documents_v1');
        localStorage.removeItem('docuvault_documents_v2');
      } catch (_) {}
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as DocumentItem[];
          let modified = false;
          const cleaned = parsed.map(d => {
            // Revert any doc that was auto-transitioned to Accepted without manual selection
            if (d.uploadStatus === 'Accepted' && !(d as any).manuallyReviewed) {
              d.uploadStatus = 'Uploaded';
              d.approvalStatus = 'Pending';
              modified = true;
            }
            return {
              ...d,
              permissions: calculatePermissions(d)
            };
          });
          if (modified) {
            this.saveDocs(cleaned);
          }
          return cleaned;
        } catch {
          // fallback to defaults if parse error
        }
      }
    }
    const defaults = createDefaultDocuments();
    this.saveDocs(defaults);
    return defaults;
  }

  private saveDocs(docs: DocumentItem[]): void {
    this.inMemoryDocs = docs;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
      } catch (err) {
        console.warn('LocalStorage save failed:', err);
      }
    }
  }

  private getLocalChecklistResponse(userId?: string): ChecklistResponse {
    const docs = this.loadDocs();
    const uploadedCount = docs.filter(d => d.uploadStatus === 'Uploaded').length;
    const approvedCount = docs.filter(d => d.approvalStatus === 'Approved').length;
    const pendingCount = docs.filter(d => d.approvalStatus === 'Pending' && d.uploadStatus === 'Uploaded').length;
    const rejectedCount = docs.filter(d => d.approvalStatus === 'Rejected').length;

    return {
      userId: userId || 'user_1',
      totalDocuments: docs.length,
      uploadedCount,
      approvedCount,
      pendingCount,
      rejectedCount,
      documents: docs
    };
  }

  getDocuments(userId?: string): Observable<ChecklistResponse> {
    return this.http.get<ChecklistResponse>(`${API_URL}/documents`, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        if (res && res.documents) {
          const docs = res.documents.map(d => ({
            ...d,
            permissions: calculatePermissions(d)
          }));
          this.saveDocs(docs);
          return { ...res, documents: docs };
        }
        return this.getLocalChecklistResponse(userId);
      }),
      catchError(() => of(this.getLocalChecklistResponse(userId)))
    );
  }

  getDocument(id: number): Observable<DocumentItem> {
    const docs = this.loadDocs();
    const doc = docs.find(d => d.id === id) || docs[0];
    return of(doc);
  }

  uploadDocument(id: number, file: File, notes: string = ''): Observable<{ message: string; document: DocumentItem }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('notes', notes);

    return this.http.post<{ message: string; document: DocumentItem }>(
      `${API_URL}/documents/${id}/upload`,
      formData,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => {
        const docs = this.loadDocs();
        const docIdx = docs.findIndex(d => d.id === id);
        if (docIdx !== -1 && res.document) {
          res.document.permissions = calculatePermissions(res.document);
          docs[docIdx] = res.document;
          this.saveDocs(docs);
        }
        return res;
      }),
      catchError(err => {
        console.warn('Backend API upload unreachable or error, falling back to local storage:', err);
        const docs = this.loadDocs();
        const doc = docs.find(d => d.id === id);
        if (!doc) {
          return of({ message: 'Document not found', document: docs[0] });
        }

        const newVersionNum = (doc.currentVersion || 0) + 1;
        const nowFormatted = formatCurrentDateTime();
        const objectUrl = URL.createObjectURL(file);

        const newVersion: DocumentVersion = {
          versionNumber: newVersionNum,
          uploadDateTime: nowFormatted,
          uploadTimestamp: new Date().toISOString(),
          driveFileId: `local_${Date.now()}`,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          webViewLink: objectUrl,
          downloadUrl: objectUrl,
          storageType: 'Client Storage',
          notes: notes,
          approvalStatusAtUpload: 'Pending'
        };

        if (!doc.versions) {
          doc.versions = [];
        }
        doc.versions.push(newVersion);
        doc.uploadStatus = 'Uploaded';
        (doc as any).manuallyReviewed = false;
        doc.currentVersion = newVersionNum;
        doc.uploadDateTime = nowFormatted;
        doc.fileName = file.name;
        doc.fileSize = file.size;
        doc.mimeType = file.type || 'application/octet-stream';
        doc.webViewLink = objectUrl;
        doc.downloadUrl = objectUrl;
        doc.notes = notes;
        doc.permissions = calculatePermissions(doc);

        this.saveDocs(docs);

        return of({
          message: `Document "${doc.name}" uploaded successfully`,
          document: doc
        });
      })
    );
  }


  deleteDocument(id: number, versionNumber?: number): Observable<{ message: string; document: DocumentItem }> {
    const url = `${API_URL}/documents/${id}${versionNumber ? '?version=' + versionNumber : ''}`;
    return this.http.delete<{ message: string; document: DocumentItem }>(url, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        const docs = this.loadDocs();
        const docIdx = docs.findIndex(d => d.id === id);
        if (docIdx !== -1 && res.document) {
          res.document.permissions = calculatePermissions(res.document);
          docs[docIdx] = res.document;
          this.saveDocs(docs);
        }
        return res;
      }),
      catchError(err => {
        console.warn('Backend delete error, falling back to local storage:', err);
        const docs = this.loadDocs();
        const doc = docs.find(d => d.id === id);
        if (doc) {
          if (versionNumber && doc.versions && doc.versions.length > 1) {
            doc.versions = doc.versions.filter(v => v.versionNumber !== versionNumber);
            const latestVer = doc.versions[doc.versions.length - 1];
            doc.currentVersion = latestVer.versionNumber;
            doc.fileName = latestVer.fileName;
            doc.fileSize = latestVer.fileSize;
            doc.mimeType = latestVer.mimeType;
            doc.uploadDateTime = latestVer.uploadDateTime;
            doc.webViewLink = latestVer.webViewLink;
            doc.downloadUrl = latestVer.downloadUrl;
            doc.notes = latestVer.notes || '';
            doc.permissions = calculatePermissions(doc);
            this.saveDocs(docs);
            return of({
              message: 'Document version deleted successfully',
              document: doc
            });
          } else {
            doc.uploadStatus = 'Upload Pending';
            doc.approvalStatus = 'Pending';
            (doc as any).manuallyReviewed = false;
            doc.isLocked = false;
            doc.currentVersion = 0;
            doc.uploadDateTime = null;
            doc.driveFileId = null;
            doc.fileName = null;
            doc.fileSize = null;
            doc.mimeType = null;
            doc.webViewLink = null;
            doc.downloadUrl = null;
            doc.notes = '';
            doc.adminFeedback = '';
            doc.versions = [];
            doc.permissions = calculatePermissions(doc);
            this.saveDocs(docs);
            return of({
              message: 'Document deleted successfully',
              document: doc
            });
          }
        }
        return of({
          message: 'Document not found',
          document: docs[0]
        });
      })
    );
  }

  getDriveStatus(): Observable<DriveStatus> {
    return this.http.get<DriveStatus>(`${API_URL}/drive/status`).pipe(
      catchError(() => of({
        mode: 'emulated_google_drive' as const,
        configured: true,
        folderId: '1R4O69oYqihfJOxXjYmLoJNKiUu_A6y0p',
        folderUrl: 'https://drive.google.com/drive/folders/1R4O69oYqihfJOxXjYmLoJNKiUu_A6y0p',
        authMode: 'none' as const,
        hasServiceAccount: false,
        message: 'Operating with local persistent storage fallback'
      }))
    );
  }
}
