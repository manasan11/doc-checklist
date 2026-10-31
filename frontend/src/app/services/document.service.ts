import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ChecklistResponse, DocumentItem, DocumentVersion, DriveStatus } from '../models/document.model';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const API_URL = environment.apiUrl;

const INITIAL_DOCUMENTS: Array<{ id: number; name: string; description: string }> = [
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
  const hasVersions = !!(doc.versions && doc.versions.length > 0);
  const isUploaded = (doc.uploadStatus !== 'Upload Pending' && (doc.currentVersion || 0) > 0) || hasVersions;
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

  constructor() {
    // Purge legacy non-isolated global document caches
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem('docuvault_documents_v1');
        localStorage.removeItem('docuvault_documents_v2');
        localStorage.removeItem('docuvault_documents_v3');
        localStorage.removeItem('docuvault_documents_v4');
        localStorage.removeItem('docuvault_documents_v5');
        localStorage.removeItem('docuvault_documents_v6');
      } catch (_) {}
    }
  }

  private getStorageKey(userId?: string): string {
    const uid = userId || this.authService.currentUser()?.id || 'guest';
    return `docuvault_docs_${uid}`;
  }

  loadDocs(userId?: string): DocumentItem[] {
    const key = this.getStorageKey(userId);
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored) as DocumentItem[];
          let modified = false;
          const cleaned = parsed.map(d => {
            if (d.versions && d.versions.length > 0) {
              const vMap = new Map();
              for (const v of d.versions) {
                vMap.set(v.versionNumber, v);
              }
              const uniqueVers = Array.from(vMap.values());
              if (uniqueVers.length !== d.versions.length) {
                d.versions = uniqueVers;
                modified = true;
              }
              const needsRenumbering = d.versions.some((v, idx) => v.versionNumber !== idx + 1);
              if (needsRenumbering) {
                d.versions.forEach((v, idx) => { v.versionNumber = idx + 1; });
                d.currentVersion = d.versions.length;
                modified = true;
              }
              if (d.uploadStatus === 'Upload Pending') {
                d.uploadStatus = 'Uploaded';
                modified = true;
              }
              if (!d.currentVersion || d.currentVersion < 1) {
                d.currentVersion = d.versions.length;
                modified = true;
              }
            }
            return {
              ...d,
              permissions: calculatePermissions(d)
            };
          });

          // Ensure all 16 documents exist
          const list = [...cleaned];
          INITIAL_DOCUMENTS.forEach(init => {
            const match = list.find(d => d.id === init.id);
            if (!match) {
              list.push({
                id: init.id,
                name: init.name,
                description: init.description,
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
                storageType: 'google_drive_cloud',
                notes: '',
                adminFeedback: '',
                versions: [],
                permissions: calculatePermissions({ uploadStatus: 'Upload Pending' })
              });
              modified = true;
            } else {
              if (match.name !== init.name || match.description !== init.description) {
                match.name = init.name;
                match.description = init.description;
                modified = true;
              }
            }
          });
          list.sort((a, b) => a.id - b.id);
          if (modified) {
            this.saveDocs(list, userId);
          }
          return list;
        }
      } catch (_) {}
    }
    const defaults = createDefaultDocuments();
    this.saveDocs(defaults, userId);
    return defaults;
  }

  saveDocs(docs: DocumentItem[], userId?: string): void {
    const key = this.getStorageKey(userId);
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const json = JSON.stringify(docs);
        sessionStorage.setItem(key, json);
      } catch (err) {
        console.warn('Document storage save failed:', err);
      }
    }
  }

  private getLocalChecklistResponse(userId?: string): ChecklistResponse {
    const targetUserId = userId || this.authService.currentUser()?.id || 'guest';
    const docs = this.loadDocs(targetUserId);
    const uploadedCount = docs.filter(d => d.uploadStatus === 'Uploaded').length;
    const approvedCount = docs.filter(d => d.approvalStatus === 'Approved').length;
    const pendingCount = docs.filter(d => d.approvalStatus === 'Pending' && d.uploadStatus === 'Uploaded').length;
    const rejectedCount = docs.filter(d => d.approvalStatus === 'Rejected').length;

    return {
      userId: targetUserId,
      totalDocuments: docs.length,
      uploadedCount,
      approvedCount,
      pendingCount,
      rejectedCount,
      documents: docs
    };
  }

  getDocuments(userId?: string): Observable<ChecklistResponse> {
    const targetUserId = userId || this.authService.currentUser()?.id;
    return this.http.get<ChecklistResponse>(`${API_URL}/documents`, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        if (res && res.documents) {
          const docs = res.documents.map(d => {
            const init = INITIAL_DOCUMENTS.find(i => i.id === d.id);
            if (init) {
              d.name = d.name || init.name;
              d.description = d.description || init.description;
            }
            if (d.versions && d.versions.length > 0) {
              const needsRenumbering = d.versions.some((v, idx) => v.versionNumber !== idx + 1);
              if (needsRenumbering) {
                d.versions.forEach((v, idx) => { v.versionNumber = idx + 1; });
                d.currentVersion = d.versions.length;
              }
            }
            return {
              ...d,
              permissions: calculatePermissions(d)
            };
          });
          docs.sort((a, b) => a.id - b.id);
          this.saveDocs(docs, res.userId || targetUserId);
          return { ...res, totalDocuments: docs.length, documents: docs };
        }
        return this.getLocalChecklistResponse(targetUserId);
      }),
      catchError(() => of(this.getLocalChecklistResponse(targetUserId)))
    );
  }

  getDocument(id: number): Observable<DocumentItem> {
    const targetUserId = this.authService.currentUser()?.id;
    const docs = this.loadDocs(targetUserId);
    const doc = docs.find(d => d.id === id) || docs[0];
    return of(doc);
  }

  uploadDocument(id: number | null, file: File, notes: string = '', documentType?: string): Observable<{ message: string; document: DocumentItem; generatedFileName?: string }> {
    const targetUserId = this.authService.currentUser()?.id;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('notes', notes);
    if (documentType) {
      formData.append('documentType', documentType);
    }

    const endpoint = id ? `${API_URL}/documents/${id}/upload` : `${API_URL}/documents/upload`;

    return this.http.post<{ message: string; document: DocumentItem; generatedFileName?: string }>(
      endpoint,
      formData,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => {
        const docs = this.loadDocs(targetUserId);
        if (res.document) {
          res.document.permissions = calculatePermissions(res.document);
          const docIdx = docs.findIndex(d => d.id === res.document.id);
          if (docIdx !== -1) {
            docs[docIdx] = res.document;
          } else {
            docs.push(res.document);
          }
          this.saveDocs(docs, targetUserId);
        }
        return res;
      })
    );
  }

  deleteDocument(id: number, versionNumber?: number): Observable<{ message: string; document: DocumentItem }> {
    const targetUserId = this.authService.currentUser()?.id;
    const url = `${API_URL}/documents/${id}${versionNumber ? '?version=' + versionNumber : ''}`;

    return this.http.delete<{ message: string; document: DocumentItem }>(url, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        const docs = this.loadDocs(targetUserId);
        const docIdx = docs.findIndex(d => d.id === id);
        if (docIdx !== -1 && res && res.document) {
          res.document.permissions = calculatePermissions(res.document);
          docs[docIdx] = res.document;
          this.saveDocs(docs, targetUserId);
        }
        return res;
      })
    );
  }

  getDriveStatus(): Observable<DriveStatus> {
    return this.http.get<DriveStatus>(`${API_URL}/drive/status`).pipe(
      catchError(() => of({
        mode: 'emulated_google_drive' as const,
        configured: true,
        folderId: '1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk',
        folderUrl: 'https://drive.google.com/drive/folders/1suDPKDdeXmrBIIPG4W3FUnL4ZQbBqaNk',
        authMode: 'none' as const,
        hasServiceAccount: false,
        message: 'Operating with local persistent storage fallback'
      }))
    );
  }

  getDriveFiles(folderId?: string): Observable<any> {
    const url = folderId ? `${API_URL}/drive/files?folderId=${folderId}` : `${API_URL}/drive/files`;
    return this.http.get<any>(url, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      catchError(err => {
        console.warn('Failed to fetch drive files:', err);
        return of({ source: 'none', count: 0, files: [] });
      })
    );
  }

  syncDriveDocuments(userId?: string): Observable<any> {
    const targetUserId = userId || this.authService.currentUser()?.id;
    return this.http.post<any>(`${API_URL}/drive/sync`, { userId: targetUserId }, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        if (res && res.documents) {
          const docs = res.documents.map((d: any) => ({
            ...d,
            permissions: calculatePermissions(d)
          }));
          this.saveDocs(docs, res.userId || targetUserId);
          return { ...res, documents: docs };
        }
        return res;
      }),
      catchError(err => {
        console.warn('Drive sync API unreachable:', err);
        return of({ message: 'Sync unavailable', syncedCount: 0 });
      })
    );
  }
}
