import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UploadModalComponent } from '../upload-modal/upload-modal.component';
import { DocumentService } from '../../services/document.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { DocumentItem, ChecklistResponse } from '../../models/document.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    UploadModalComponent
  ],
  template: `
    <main class="dashboard-container">
      <!-- Top Bar: Welcome User & Logout -->
      <header class="top-header">
        <h1 class="welcome-title">
          Welcome, <span class="user-highlight">{{ authService.currentUser()?.name }}</span>
        </h1>
        <button class="btn-logout" (click)="authService.logout()">Logout</button>
      </header>

      <!-- Main Document Checklist Card -->
      <section class="checklist-section glass-panel">
        <div class="checklist-header">
          <h2 class="checklist-title">Document Checklist</h2>
        </div>

        <!-- Documents Table -->
        <div class="table-responsive">
          <table class="checklist-table">
            <thead>
              <tr>
                <th style="width: 50px;">No.</th>
                <th>Document Name</th>
                <th>Upload Status</th>
                <th>Upload / Re-upload</th>
                <th>View Document</th>
                <th>Upload Date & Time</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              @for (doc of documents(); track doc.id) {
                @if (doc.versions && doc.versions.length > 0) {
                  @for (ver of doc.versions; track ver.versionNumber) {
                    <tr [class.row-highlight]="selectedDoc()?.id === doc.id" [class.sub-version-row]="doc.versions.length > 1 && ver.versionNumber > 1">
                      <!-- 1. No. -->
                      <td class="col-no font-mono">
                        <span class="no-badge">#{{ doc.id }}</span>
                      </td>

                      <!-- 2. Document Name -->
                      <td class="col-name">
                        @if (ver.versionNumber === 1) {
                          <div class="doc-info-block">
                            <div class="doc-primary-line">
                              <span class="doc-name-text">{{ doc.name }}</span>
                              @if (doc.isLocked) {
                                <span class="lock-indicator" title="Document Locked by Admin">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                </span>
                              }
                            </div>
                          </div>
                        } @else {
                          <span class="datetime-empty">&mdash;</span>
                        }
                      </td>

                      <!-- 3. Upload Status -->
                      <td class="col-upload-status">
                        @if (ver.versionNumber === doc.currentVersion) {
                          <span 
                            class="badge" 
                            [ngClass]="getStatusBadgeClass(doc.uploadStatus)"
                          >
                            <span class="dot" [ngClass]="getStatusDotClass(doc.uploadStatus)"></span>
                            {{ doc.uploadStatus }}
                          </span>
                        } @else {
                          <span class="badge badge-uploaded-info">
                            <span class="dot dot-uploaded"></span>
                            Uploaded
                          </span>
                        }
                      </td>

                      <!-- 4. Upload / Re-upload Option -->
                      <td class="col-upload-action">
                        @if (ver.versionNumber === doc.currentVersion && doc.permissions.canUpload) {
                          <button 
                            class="btn btn-sm btn-secondary"
                            (click)="openUploadModal(doc)"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            Re-upload
                          </button>
                        } @else if (ver.versionNumber === doc.currentVersion && !doc.permissions.canUpload) {
                          <button 
                            class="btn btn-secondary btn-sm" 
                            disabled 
                            [title]="getUploadDisabledReason(doc)"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                            {{ doc.permissions.uploadLabel }}
                          </button>
                        } @else {
                          <span class="datetime-empty">&mdash;</span>
                        }
                      </td>

                      <!-- 5. View Document -->
                      <td class="col-view">
                        <button class="btn btn-secondary btn-sm" (click)="openViewerVersion(doc, ver.versionNumber)" [title]="'View ' + ver.fileName">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          View
                        </button>
                      </td>

                      <!-- 6. Upload Date & Time -->
                      <td class="col-datetime">
                        <span class="datetime-text font-medium">{{ ver.uploadDateTime }}</span>
                      </td>

                      <!-- 8. Delete -->
                      <td class="col-delete">
                        @if (doc.permissions.canDelete) {
                          <button class="btn btn-danger btn-sm" (click)="confirmDelete(doc, ver.versionNumber)" title="Delete document">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            Delete
                          </button>
                        } @else {
                          <span class="datetime-empty">&mdash;</span>
                        }
                      </td>
                    </tr>
                  }
                } @else {
                  <tr [class.row-highlight]="selectedDoc()?.id === doc.id">
                    <!-- 1. No. -->
                    <td class="col-no font-mono">
                      <span class="no-badge">#{{ doc.id }}</span>
                    </td>

                    <!-- 2. Document Name -->
                    <td class="col-name">
                      <div class="doc-info-block">
                        <div class="doc-primary-line">
                          <span class="doc-name-text">{{ doc.name }}</span>
                        </div>
                      </div>
                    </td>

                    <!-- 3. Upload Status -->
                    <td class="col-upload-status">
                      <span class="badge badge-pending-upload">
                        <span class="dot dot-muted"></span>
                        Upload Pending
                      </span>
                    </td>

                    <!-- 4. Upload / Re-upload Option -->
                    <td class="col-upload-action">
                      @if (doc.permissions.canUpload) {
                        <button 
                          class="btn btn-primary btn-sm"
                          (click)="openUploadModal(doc)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                          Upload
                        </button>
                      } @else {
                        <button class="btn btn-secondary btn-sm" disabled>Upload</button>
                      }
                    </td>

                    <!-- 5. View Document -->
                    <td class="col-view">
                      <button class="btn btn-ghost btn-sm" disabled title="Document has not been uploaded yet">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        View
                      </button>
                    </td>

                    <!-- 6. Upload Date & Time -->
                    <td class="col-datetime">
                      <span class="datetime-empty">&mdash;</span>
                    </td>

                    <!-- 8. Delete -->
                    <td class="col-delete">
                      <button class="btn btn-ghost btn-sm" disabled title="Disabled: Document not uploaded">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Delete
                      </button>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>


      </section>
    </main>

    <!-- Modals & Drawers -->
    @if (activeModal() === 'upload' && selectedDoc()) {
      <app-upload-modal 
        [document]="selectedDoc()!"
        [uploading]="uploadingInProgress"
        (onUpload)="handleUpload($event)"
        (onCancel)="closeModals()"
      ></app-upload-modal>
    }




    <!-- Delete Confirmation Modal -->
    @if (activeModal() === 'delete' && selectedDoc()) {
      <div class="modal-overlay" (click)="closeModals()">
        <div class="modal-content" style="max-width: 440px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 class="modal-title" style="color: #f87171;">Delete Document</h3>
            <button class="btn btn-ghost btn-icon" (click)="closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5;">
              @if ((selectedDoc()?.versions?.length || 0) > 1 && selectedVersion()) {
                Are you sure you want to delete this version of <b>{{ selectedDoc()?.name }}</b>?
              } @else {
                Are you sure you want to delete <b>{{ selectedDoc()?.name }}</b>? This will purge the uploaded file and reset the checklist item to <b>Upload Pending</b>.
              }
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="closeModals()">Cancel</button>
            <button class="btn btn-danger" (click)="executeDelete()">Confirm Delete</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .dashboard-container {
      width: 100%;
      max-width: 1750px;
      margin: 0 auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Top Header */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: #FFFFFF;
      border: 1px solid #EAE3D8;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 16px -2px rgba(40, 20, 10, 0.05);
    }

    .welcome-title {
      font-size: 1.65rem;
      font-weight: 700;
      color: #1C1917;
      margin: 0;
      letter-spacing: -0.02em;
    }

    .user-highlight {
      background: linear-gradient(135deg, #E64323 0%, #F15A24 50%, #F97316 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 700;
    }

    .btn-logout {
      background: #FAF7F2;
      border: 1px solid #E5DED3;
      color: #57534E;
      padding: 8px 18px;
      border-radius: var(--radius-md);
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-logout:hover {
      background: #FEF2F2;
      color: #DC2626;
      border-color: #FECACA;
    }

    /* Checklist Section */
    .checklist-section {
      padding: 24px 20px;
      background: #FFFFFF;
      border: 1px solid #EAE3D8;
      border-radius: var(--radius-lg);
      box-shadow: 0 12px 30px -4px rgba(241, 90, 36, 0.06), 0 2px 8px rgba(0, 0, 0, 0.02);
    }

    .checklist-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      gap: 16px;
      flex-wrap: wrap;
    }

    .checklist-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1C1917;
      letter-spacing: -0.02em;
    }

    /* Table */
    .table-responsive {
      overflow-x: auto;
      border-radius: var(--radius-md);
      border: 1px solid #EAE3D8;
    }

    .checklist-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    .checklist-table th {
      background: #FAF7F2;
      color: #78716C;
      padding: 12px 10px;
      font-size: 0.74rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #EAE3D8;
      white-space: nowrap;
    }

    .checklist-table td {
      padding: 12px 10px;
      border-bottom: 1px solid #F2ECE2;
      vertical-align: middle;
      background: #FFFFFF;
    }

    .checklist-table .btn-sm {
      padding: 5px 10px;
      font-size: 0.78rem;
    }

    .checklist-table tbody tr:hover td {
      background: #FFFBF7;
    }

    .checklist-table tr.row-highlight td {
      background: #FFF7ED;
    }

    .checklist-table tr.sub-version-row td {
      background: #FCFAF6;
      border-top: 1px dashed #EDE5D8;
    }
    .checklist-table tr.sub-version-row:hover td {
      background: #FFF7ED;
    }

    .no-badge {
      font-weight: 700;
      color: #A8A29E;
    }

    .doc-info-block {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: 260px;
    }

    .doc-primary-line {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .doc-name-text {
      font-weight: 600;
      color: #1C1917;
      font-size: 0.88rem;
    }

    .lock-indicator {
      color: #DC2626;
      display: flex;
      align-items: center;
    }

    .datetime-stack {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .datetime-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.77rem;
      white-space: nowrap;
    }

    .datetime-tag {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .tag-initial {
      background: #ECFDF5;
      color: #047857;
      border: 1px solid #A7F3D0;
    }

    .tag-reupload {
      background: #FFF7ED;
      color: #EA580C;
      border: 1px solid #FDBA74;
    }

    .datetime-value {
      color: #57534E;
      font-weight: 500;
    }

    .datetime-item.is-latest .datetime-value {
      color: #1C1917;
      font-weight: 700;
    }

    .datetime-text {
      font-size: 0.78rem;
      color: #57534E;
      white-space: nowrap;
      font-weight: 500;
    }

    .datetime-empty {
      color: #A8A29E;
    }
  `]
})
export class DashboardComponent implements OnInit {
  docService = inject(DocumentService);
  authService = inject(AuthService);
  notificationService = inject(NotificationService);

  documents = signal<DocumentItem[]>([]);

  // Modal controls
  activeModal = signal<'upload' | 'delete' | null>(null);
  selectedDoc = signal<DocumentItem | null>(null);
  selectedVersion = signal<number | undefined>(undefined);

  uploadingInProgress = signal<boolean>(false);

  ngOnInit() {
    this.loadDocuments();
  }

  loadDocuments() {
    this.docService.getDocuments().subscribe({
      next: (res: ChecklistResponse) => {
        this.documents.set(res.documents);

        // Keep selectedDoc updated if open
        const cur = this.selectedDoc();
        if (cur) {
          const updated = res.documents.find(d => d.id === cur.id);
          if (updated) this.selectedDoc.set(updated);
        }
      },
      error: () => {
        this.notificationService.error('Fetch Error', 'Failed to load document checklist.');
      }
    });
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'Upload Pending': return 'badge-pending-upload';
      case 'Uploaded': return 'badge-uploaded-info';
      case 'Verifying': return 'badge-verifying';
      case 'Accepted': return 'badge-accepted';
      case 'Rejected': return 'badge-rejected';
      default: return 'badge-pending-upload';
    }
  }

  getStatusDotClass(status: string): string {
    switch (status) {
      case 'Upload Pending': return 'dot-muted';
      case 'Uploaded': return 'dot-uploaded';
      case 'Verifying': return 'dot-verifying';
      case 'Accepted': return 'dot-success';
      case 'Rejected': return 'dot-danger';
      default: return 'dot-muted';
    }
  }

  getUploadDisabledReason(doc: DocumentItem): string {
    if (doc.isLocked) {
      if (doc.approvalStatus === 'Approved') {
        return 'Upload disabled: Document is Approved and Locked.';
      }
      return 'Upload disabled: Document is locked by Administrator.';
    }
    return 'Upload not allowed';
  }

  openUploadModal(doc: DocumentItem) {
    this.selectedDoc.set(doc);
    this.activeModal.set('upload');
  }

  openViewerVersion(doc: DocumentItem, versionNum?: number) {
    const targetVer = (doc.versions && versionNum)
      ? doc.versions.find(v => v.versionNumber === versionNum)
      : (doc.versions && doc.versions.length > 0 ? doc.versions[doc.versions.length - 1] : undefined);

    const viewUrl = targetVer?.webViewLink || doc.webViewLink;
    if (viewUrl) {
      window.open(viewUrl, '_blank');
    } else {
      this.notificationService.warning('Document Unavailable', 'No uploaded file found for this document.');
    }
  }

  confirmDelete(doc: DocumentItem, versionNum?: number) {
    this.selectedDoc.set(doc);
    this.selectedVersion.set(versionNum);
    this.activeModal.set('delete');
  }

  closeModals() {
    this.activeModal.set(null);
    this.selectedVersion.set(undefined);
  }

  handleUpload(event: { file: File; notes: string }) {
    const doc = this.selectedDoc();
    if (!doc) return;

    this.uploadingInProgress.set(true);
    this.docService.uploadDocument(doc.id, event.file, event.notes).subscribe({
      next: () => {
        this.uploadingInProgress.set(false);
        this.notificationService.success(
          'Uploaded to Google Drive',
          `Document #${doc.id} uploaded successfully.`
        );
        this.closeModals();
        this.loadDocuments();
      },
      error: (err) => {
        this.uploadingInProgress.set(false);
        this.notificationService.error(
          'Upload Failed',
          err.error?.error || 'Failed to complete document upload.'
        );
      }
    });
  }

  executeDelete() {
    const doc = this.selectedDoc();
    if (!doc) return;

    const verNum = this.selectedVersion();
    this.docService.deleteDocument(doc.id, verNum).subscribe({
      next: (res) => {
        this.notificationService.info('Deleted', res.message);
        this.closeModals();
        this.loadDocuments();
      },
      error: (err) => {
        this.notificationService.error('Delete Failed', err.error?.error || 'Failed to delete document.');
      }
    });
  }
}
