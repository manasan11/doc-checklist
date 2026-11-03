import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ChecklistResponse, DocumentItem, DriveStatus } from '../models/document.model';
import { StudentUser } from '../models/user.model';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const API_URL = environment.apiUrl;

export function calculatePermissions(doc: Partial<DocumentItem>) {
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

@Injectable({
  providedIn: 'root'
})
export class DocumentService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  /**
   * Fetch all registered students from the database.
   * Compatible with /api/students and fallback to /api/documents/all.
   */
  getStudents(): Observable<StudentUser[]> {
    return this.http.get<{ totalStudents?: number; students?: StudentUser[]; users?: StudentUser[] }>(
      `${API_URL}/students`,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => {
        if (res && res.students && res.students.length > 0) return res.students;
        if (res && res.users && res.users.length > 0) return res.users.filter(u => u.role !== 'admin');
        return [];
      }),
      catchError(() => {
        // Fallback to /documents/all for colleague's backend
        return this.http.get<{ totalUsers?: number; users?: StudentUser[] }>(
          `${API_URL}/documents/all`,
          { headers: this.authService.getAuthHeaders() }
        ).pipe(
          map(res => (res?.users || []).filter(u => u.role !== 'admin')),
          catchError(err => {
            console.error('[DocumentService] Failed to fetch students from backend:', err);
            return of([]);
          })
        );
      })
    );
  }

  /**
   * Fetch document checklist dynamically for a specific student ID or logged-in user.
   */
  getDocuments(userId?: string): Observable<ChecklistResponse> {
    const targetUserId = userId || this.authService.currentUser()?.id;
    const url = targetUserId ? `${API_URL}/documents?userId=${encodeURIComponent(targetUserId)}` : `${API_URL}/documents`;

    return this.http.get<ChecklistResponse>(url, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        if (res && res.documents) {
          const docs = res.documents.map(d => {
            if (d.versions && d.versions.length > 0) {
              const needsRenumbering = d.versions.some((v, idx) => v.versionNumber !== idx + 1);
              if (needsRenumbering) {
                d.versions.forEach((v, idx) => { v.versionNumber = idx + 1; });
                d.currentVersion = d.versions.length;
              }
            }
            return {
              ...d,
              permissions: d.permissions || calculatePermissions(d)
            };
          });
          docs.sort((a, b) => a.id - b.id);
          return {
            ...res,
            totalDocuments: docs.length,
            documents: docs
          };
        }
        return {
          userId: targetUserId || '',
          totalDocuments: 0,
          uploadedCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
          documents: []
        };
      }),
      catchError((err) => {
        if (err?.status === 401) {
          this.authService.logout();
        }
        return of({
          userId: targetUserId || '',
          totalDocuments: 0,
          uploadedCount: 0,
          approvedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
          documents: []
        });
      })
    );
  }

  /**
   * Upload or re-upload a document against a specific student ID and document type.
   */
  uploadDocument(
    id: number | null, 
    file: File, 
    notes: string = '', 
    documentType?: string, 
    userId?: string
  ): Observable<{ message: string; document: DocumentItem; generatedFileName?: string }> {
    const targetUserId = userId || this.authService.currentUser()?.id;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('notes', notes);
    if (documentType) {
      formData.append('documentType', documentType);
    }
    if (targetUserId) {
      formData.append('userId', targetUserId);
      formData.append('studentId', targetUserId);
    }

    const queryParam = targetUserId ? `?userId=${encodeURIComponent(targetUserId)}` : '';
    const endpoint = id 
      ? `${API_URL}/documents/${id}/upload${queryParam}` 
      : `${API_URL}/documents/upload${queryParam}`;

    return this.http.post<{ message: string; document: DocumentItem; generatedFileName?: string }>(
      endpoint,
      formData,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => {
        if (res && res.document) {
          res.document.permissions = res.document.permissions || calculatePermissions(res.document);
        }
        return res;
      }),
      catchError(err => {
        if (err?.status === 401) {
          this.authService.logout();
        }
        throw err;
      })
    );
  }

  /**
   * Delete a document or version for a student.
   */
  deleteDocument(id: number, versionNumber?: number, userId?: string): Observable<{ message: string; document: DocumentItem }> {
    const targetUserId = userId || this.authService.currentUser()?.id;
    const params: string[] = [];
    if (versionNumber) params.push(`version=${versionNumber}`);
    if (targetUserId) params.push(`userId=${encodeURIComponent(targetUserId)}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const url = `${API_URL}/documents/${id}${query}`;

    return this.http.delete<{ message: string; document: DocumentItem }>(url, {
      headers: this.authService.getAuthHeaders()
    }).pipe(
      map(res => {
        if (res && res.document) {
          res.document.permissions = res.document.permissions || calculatePermissions(res.document);
        }
        return res;
      }),
      catchError(err => {
        if (err?.status === 401) {
          this.authService.logout();
        }
        throw err;
      })
    );
  }

  getDriveStatus(): Observable<DriveStatus> {
    return this.http.get<DriveStatus>(`${API_URL}/drive/status`).pipe(
      catchError(() => of({
        mode: 'live_google_drive' as const,
        configured: true,
        folderId: '',
        authMode: 'apps_script' as const,
        hasServiceAccount: true,
        message: 'Google Drive connected'
      }))
    );
  }

  /**
   * Fetch documents and associated followup staff info using Student_Id and Dept_Id
   */
  getStudentFollowupDocuments(studentId: string, deptId?: string | number): Observable<any> {
    const cleanId = String(studentId).replace(/^u-/, '');
    let url = `${API_URL}/students/${encodeURIComponent(cleanId)}/documents`;
    if (deptId) {
      url += `?deptId=${encodeURIComponent(String(deptId))}`;
    }
    return this.http.get<any>(url, { headers: this.authService.getAuthHeaders() });
  }

  /**
   * Update student profile details
   */
  updateStudent(studentId: string, data: any): Observable<any> {
    const cleanId = String(studentId).replace(/^u-/, '');
    return this.http.put<any>(`${API_URL}/students/${encodeURIComponent(cleanId)}`, data, {
      headers: this.authService.getAuthHeaders()
    });
  }

  /**
   * Update Verification_Status in MySQL (0: Pending, 1: Approved, 2: Rejected)
   * Supports updating a specific version by studentDocumentId or versionNumber
   */
  updateVerificationStatus(
    docId: number, 
    status: number, 
    userId?: string, 
    rejectionReason?: string, 
    studentDocumentId?: number, 
    versionNumber?: number
  ): Observable<any> {
    const payload: any = { verificationStatus: status };
    if (userId) payload.userId = userId;
    if (rejectionReason !== undefined) payload.rejectionReason = rejectionReason;
    if (studentDocumentId !== undefined) payload.studentDocumentId = studentDocumentId;
    if (versionNumber !== undefined) payload.versionNumber = versionNumber;
    return this.http.patch<any>(`${API_URL}/documents/${docId}/review`, payload, {
      headers: this.authService.getAuthHeaders()
    });
  }
}
