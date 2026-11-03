import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UploadModalComponent } from '../upload-modal/upload-modal.component';
import { DocumentService } from '../../services/document.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { DocumentItem, ChecklistResponse } from '../../models/document.model';
import { StudentUser } from '../../models/user.model';
import { environment } from '../../../environments/environment';

function getBackendUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = environment.backendUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return `${base}${cleanPath}`;
}

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
        <div class="user-greeting-wrapper">
          <h1 class="welcome-title">
            Welcome, <span class="user-highlight">{{ authService.currentUser()?.name }}</span>
          </h1>
        </div>
        <div class="header-actions">
          <button class="btn-reset-password" (click)="openResetPasswordModal()" title="Reset account password">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>Reset Password</span>
          </button>
          <button class="btn-logout" (click)="authService.logout()">Logout</button>
        </div>
      </header>

      <!-- Main Document Checklist Card -->
      <section class="checklist-section glass-panel">
        <div class="checklist-header">
          <div>
            <h2 class="checklist-title">Document Checklist</h2>
            @if (selectedStudent()) {
              <p class="checklist-subtitle">
                Student: <strong>{{ selectedStudent()?.name }}</strong>
                @if (selectedStudent()?.studentCode) {
                  <span class="student-code-badge">({{ selectedStudent()?.studentCode }})</span>
                }
              </p>
            }
          </div>

          @if (isAdmin() && students().length > 0) {
            <div class="student-selector-wrapper">
              <label for="studentSelect" class="selector-label">Select Student:</label>
              <div class="select-dropdown-container">
                <select 
                  id="studentSelect" 
                  class="student-dropdown-select" 
                  [ngModel]="selectedStudent()?.id" 
                  (ngModelChange)="onStudentChange($event)"
                >
                  @for (s of students(); track s.id) {
                    <option [value]="s.id">
                      {{ s.name }} ({{ s.studentCode || s.id }})
                    </option>
                  }
                </select>
                <div class="select-chevron">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Documents Table -->
        <div class="table-responsive">
          <table class="checklist-table">
            <thead>
              <tr>
                <th style="width: 50px;">No.</th>
                <th>Document</th>
                <th>Verification Status</th>
                <th>Upload / Re-upload</th>
                <th>View Document</th>
                <th>Upload Date & Time</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              @for (doc of documents(); track doc.id; let docIndex = $index) {
                <tr [class.row-highlight]="selectedDoc()?.id === doc.id">
                  <!-- 1. No. -->
                  <td class="col-no font-mono">
                    <span class="no-badge">#{{ doc.id || (docIndex + 1) }}</span>
                  </td>

                  <!-- 2. Document Name -->
                  <td class="col-name">
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
                  </td>

                  <!-- 3. Verification Status (0: Pending, 1: Approved, 2: Rejected) -->
                  <td class="col-upload-status">
                    @if (doc.fileName && doc.uploadStatus === 'Uploaded') {
                      <div class="verification-status-cell">
                        <div class="status-badge-row">
                          <span 
                            class="badge" 
                            [ngClass]="getVerificationBadgeClass(doc)"
                          >
                            <span class="dot" [ngClass]="getVerificationDotClass(doc)"></span>
                            {{ getVerificationStatusLabel(doc) }}
                          </span>

                          @if (isAdmin()) {
                            <div class="status-action-btns">
                              @if (doc.verificationStatus !== 1) {
                                <button 
                                  class="btn-status-action btn-status-approve" 
                                  (click)="setVerificationStatus(doc, 1)" 
                                  title="Approve Document (Status: 1)">
                                  ✓
                                </button>
                              }
                              @if (doc.verificationStatus !== 2) {
                                <button 
                                  class="btn-status-action btn-status-reject" 
                                  (click)="promptRejectionReason(doc)" 
                                  title="Reject Document with Reason (Status: 2)">
                                  ✕
                                </button>
                              }
                              @if (doc.verificationStatus !== 0) {
                                <button 
                                  class="btn-status-action btn-status-reset" 
                                  (click)="setVerificationStatus(doc, 0)" 
                                  title="Reset to Pending (Status: 0)">
                                  ↺
                                </button>
                              }
                            </div>
                          }
                        </div>

                        <!-- Rejection Reason displayed only when status is 2 (Rejected) and rejectionReason exists -->
                        @if (doc.verificationStatus === 2 && doc.rejectionReason) {
                          <div class="rejection-reason-box" [title]="doc.rejectionReason">
                            <span class="rejection-reason-icon">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                            </span>
                            <span class="rejection-reason-text">
                              <strong class="rejection-reason-label">Reason:</strong>{{ doc.rejectionReason }}
                            </span>
                          </div>
                        }
                      </div>
                    } @else {
                      <span class="badge badge-pending-upload">
                        <span class="dot dot-muted"></span>
                        Upload Pending
                      </span>
                    }
                  </td>

                  <!-- 4. Upload / Re-upload Option -->
                  <td class="col-upload-action">
                    @if (doc.fileName && doc.uploadStatus === 'Uploaded') {
                      @if (doc.permissions.canUpload) {
                        <button 
                          class="btn btn-sm btn-secondary"
                          (click)="openUploadModal(doc)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                          Re-upload
                        </button>
                      } @else {
                        <button 
                          class="btn btn-secondary btn-sm" 
                          disabled 
                          [title]="getUploadDisabledReason(doc)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                          {{ doc.permissions.uploadLabel }}
                        </button>
                      }
                    } @else {
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
                    }
                  </td>

                  <!-- 5. View Document -->
                  <td class="col-view">
                    @if (doc.fileName && doc.uploadStatus === 'Uploaded') {
                      <button class="btn btn-secondary btn-sm" (click)="openViewerVersion(doc)" [title]="'View ' + (doc.fileName || doc.name)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        View
                      </button>
                    } @else {
                      <button class="btn btn-ghost btn-sm" disabled title="Document has not been uploaded yet">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        View
                      </button>
                    }
                  </td>

                  <!-- 6. Upload Date & Time -->
                  <td class="col-datetime">
                    @if (doc.uploadDateTime) {
                      <span class="datetime-text font-medium">{{ doc.uploadDateTime }}</span>
                    } @else {
                      <span class="datetime-empty">&mdash;</span>
                    }
                  </td>

                  <!-- 7. Delete -->
                  <td class="col-delete">
                    @if (doc.fileName && doc.uploadStatus === 'Uploaded' && doc.permissions.canDelete) {
                      <button class="btn btn-danger btn-sm" (click)="confirmDelete(doc)" title="Delete document">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Delete
                      </button>
                    } @else {
                      <span class="datetime-empty">&mdash;</span>
                    }
                  </td>
                </tr>
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
        [studentName]="selectedStudent()?.name || ''"
        [studentCode]="selectedStudent()?.studentCode || ''"
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

    <!-- Reset Password Modal -->
    @if (activeModal() === 'reset-password') {
      <div class="modal-overlay" (click)="closeModals()">
        <div class="modal-content" style="max-width: 440px;" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(241, 90, 36, 0.1); color: #F15A24; display: flex; align-items: center; justify-content: center;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <div>
                <h3 class="modal-title" style="margin: 0; font-size: 1.1rem; font-weight: 700; color: #1C1917;">Reset Password</h3>
                <p style="margin: 2px 0 0; font-size: 0.8rem; color: #78716C;">Create a new password for your account</p>
              </div>
            </div>
            <button class="btn btn-ghost btn-icon" (click)="closeModals()" aria-label="Close dialog">&times;</button>
          </div>

          <form (ngSubmit)="submitResetPassword()">
            <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
              @if (resetPasswordError()) {
                <div class="modal-error-alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span>{{ resetPasswordError() }}</span>
                </div>
              }

              <!-- New Password -->
              <div class="form-group" style="margin: 0;">
                <label class="form-label" for="modalNewPassword">New Password</label>
                <div class="password-input-wrapper">
                  <input 
                    [type]="showNewPassword() ? 'text' : 'password'"
                    id="modalNewPassword" 
                    name="modalNewPassword" 
                    [ngModel]="newPassword()"
                    (ngModelChange)="newPassword.set($event); resetPasswordError.set('')"
                    class="form-control" 
                    placeholder="Enter at least 6 characters"
                    required
                    autocomplete="new-password"
                  >
                  <button 
                    type="button" 
                    class="password-toggle-btn" 
                    (click)="showNewPassword.set(!showNewPassword())" 
                    tabindex="-1"
                    [attr.aria-label]="showNewPassword() ? 'Hide password' : 'Show password'"
                  >
                    @if (showNewPassword()) {
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    } @else {
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    }
                  </button>
                </div>
              </div>

              <!-- Confirm Password -->
              <div class="form-group" style="margin: 0;">
                <label class="form-label" for="modalConfirmPassword">Confirm Password</label>
                <div class="password-input-wrapper">
                  <input 
                    [type]="showConfirmPassword() ? 'text' : 'password'"
                    id="modalConfirmPassword" 
                    name="modalConfirmPassword" 
                    [ngModel]="confirmPassword()"
                    (ngModelChange)="confirmPassword.set($event); resetPasswordError.set('')"
                    class="form-control" 
                    placeholder="Re-enter your new password"
                    required
                    autocomplete="new-password"
                  >
                  <button 
                    type="button" 
                    class="password-toggle-btn" 
                    (click)="showConfirmPassword.set(!showConfirmPassword())" 
                    tabindex="-1"
                    [attr.aria-label]="showConfirmPassword() ? 'Hide password' : 'Show password'"
                  >
                    @if (showConfirmPassword()) {
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    } @else {
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    }
                  </button>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" (click)="closeModals()" [disabled]="resetPasswordLoading()">Cancel</button>
              <button type="submit" class="btn btn-primary-submit" [disabled]="resetPasswordLoading()">
                @if (resetPasswordLoading()) {
                  <span>Updating...</span>
                } @else {
                  <span>Update Password</span>
                }
              </button>
            </div>
          </form>
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

    .user-greeting-wrapper {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .user-email-pill {
      font-size: 0.8rem;
      background: #F4EFE6;
      color: #78716C;
      padding: 3px 10px;
      border-radius: 20px;
      border: 1px solid #E5DED3;
      font-weight: 500;
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

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-reset-password {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: #FAF7F2;
      border: 1px solid #E5DED3;
      color: #44403C;
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .btn-reset-password:hover {
      background: #FFF7ED;
      border-color: #FDBA74;
      color: #EA580C;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(241, 90, 36, 0.12);
    }

    .btn-reset-password svg {
      color: #F15A24;
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

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }

    .password-input-wrapper .form-control {
      padding-right: 44px;
    }

    .password-toggle-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      padding: 6px;
      margin: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #78716C;
      cursor: pointer;
      border-radius: 6px;
      transition: color 0.15s ease, background-color 0.15s ease;
    }

    .password-toggle-btn:hover {
      color: #F15A24;
      background: rgba(241, 90, 36, 0.08);
    }

    .modal-error-alert {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #B91C1C;
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .modal-error-alert svg {
      flex-shrink: 0;
      color: #DC2626;
    }

    .btn-primary-submit {
      padding: 9px 18px;
      background: linear-gradient(135deg, #E64323 0%, #F15A24 50%, #F97316 100%);
      color: #ffffff;
      border: none;
      border-radius: var(--radius-md);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(230, 67, 35, 0.28);
      transition: all 0.2s;
    }

    .btn-primary-submit:hover:not(:disabled) {
      box-shadow: 0 5px 16px rgba(230, 67, 35, 0.38);
      transform: translateY(-1px);
    }

    .btn-primary-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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

    .checklist-subtitle {
      font-size: 0.88rem;
      color: #78716C;
      margin: 4px 0 0 0;
      strong {
        color: #1C1917;
      }
    }

    .student-code-badge {
      font-size: 0.8rem;
      color: #EA580C;
      font-weight: 600;
      margin-left: 4px;
    }

    .student-selector-wrapper {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #FAF7F2;
      padding: 6px 14px;
      border: 1px solid #EAE3D8;
      border-radius: var(--radius-md);
    }

    .selector-label {
      font-size: 0.82rem;
      font-weight: 700;
      color: #78716C;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }

    .select-dropdown-container {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .student-dropdown-select {
      appearance: none;
      -webkit-appearance: none;
      background: #FFFFFF;
      border: 1.5px solid #E5DED3;
      border-radius: 6px;
      padding: 6px 32px 6px 12px;
      font-size: 0.88rem;
      font-weight: 600;
      color: #1C1917;
      cursor: pointer;
      outline: none;
      transition: all 0.2s;
    }

    .student-dropdown-select:hover {
      border-color: #F15A24;
    }

    .student-dropdown-select:focus {
      border-color: #F15A24;
      box-shadow: 0 0 0 3px rgba(241, 90, 36, 0.15);
    }

    .select-chevron {
      position: absolute;
      right: 10px;
      pointer-events: none;
      color: #78716C;
      display: flex;
      align-items: center;
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

    .verification-status-cell {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
      padding: 3px 0;
    }

    .status-badge-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .rejection-reason-box {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 3px;
      padding: 6px 10px;
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-left: 3px solid #EF4444;
      border-radius: 6px;
      font-size: 0.76rem;
      line-height: 1.4;
      color: #991B1B;
      max-width: 320px;
      word-break: break-word;
      box-shadow: 0 1px 3px rgba(239, 68, 68, 0.08);
    }

    .rejection-reason-icon {
      flex-shrink: 0;
      color: #DC2626;
      margin-top: 2px;
      display: flex;
    }

    .rejection-reason-label {
      font-weight: 700;
      color: #B91C1C;
      margin-right: 4px;
    }

    .rejection-reason-text {
      font-weight: 500;
      color: #7F1D1D;
    }

    .status-action-btns {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      opacity: 0.85;
      transition: opacity 0.2s;
    }
    .status-action-btns:hover {
      opacity: 1;
    }

    .btn-status-action {
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }

    .btn-status-approve {
      background: #ECFDF5;
      color: #059669;
      border-color: #A7F3D0;
    }
    .btn-status-approve:hover {
      background: #059669;
      color: #FFFFFF;
    }

    .btn-status-reject {
      background: #FEF2F2;
      color: #DC2626;
      border-color: #FECACA;
    }
    .btn-status-reject:hover {
      background: #DC2626;
      color: #FFFFFF;
    }

    .btn-status-reset {
      background: #FFFBEB;
      color: #D97706;
      border-color: #FDE68A;
    }
    .btn-status-reset:hover {
      background: #D97706;
      color: #FFFFFF;
    }
  `]
})
export class DashboardComponent implements OnInit {
  docService = inject(DocumentService);
  authService = inject(AuthService);
  notificationService = inject(NotificationService);

  documents = signal<DocumentItem[]>([]);
  students = signal<StudentUser[]>([]);
  selectedStudent = signal<StudentUser | null>(null);
  isAdmin = computed(() => this.authService.isAdmin());
  loadingStudents = signal<boolean>(false);

  // Modal controls
  activeModal = signal<'upload' | 'delete' | 'reset-password' | null>(null);
  selectedDoc = signal<DocumentItem | null>(null);
  selectedVersion = signal<number | undefined>(undefined);

  // Reset Password State
  newPassword = signal<string>('');
  confirmPassword = signal<string>('');
  showNewPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);
  resetPasswordError = signal<string>('');
  resetPasswordLoading = signal<boolean>(false);

  uploadingInProgress = signal<boolean>(false);

  ngOnInit() {
    if (this.isAdmin()) {
      this.loadStudentsAndChecklist();
    } else {
      const cur = this.authService.currentUser();
      if (cur) {
        this.selectedStudent.set({
          id: cur.id,
          name: cur.name,
          email: cur.email,
          role: cur.role,
          studentCode: cur.studentCode
        });
      }
      this.loadDocuments();
    }
  }

  loadStudentsAndChecklist(preferredStudentId?: string) {
    this.loadingStudents.set(true);
    this.docService.getStudents().subscribe({
      next: (list) => {
        this.loadingStudents.set(false);
        this.students.set(list);
        if (list.length > 0) {
          const match = preferredStudentId ? list.find(s => s.id === preferredStudentId) : null;
          const target = match || list[0];
          this.selectedStudent.set(target);
          this.loadDocuments(target.id);
        } else {
          this.selectedStudent.set(null);
          this.loadDocuments();
        }
      },
      error: () => {
        this.loadingStudents.set(false);
        this.loadDocuments();
      }
    });
  }

  onStudentChange(studentId: string) {
    const student = this.students().find(s => s.id === studentId);
    if (student) {
      this.selectedStudent.set(student);
      this.loadDocuments(student.id);
    }
  }

  loadDocuments(userId?: string) {
    const targetId = userId || this.selectedStudent()?.id;
    this.docService.getDocuments(targetId).subscribe({
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

  getVerificationStatusLabel(doc: DocumentItem): string {
    if (!doc.fileName || doc.uploadStatus === 'Upload Pending' ) {
      return 'Upload Pending';
    }
    const vStatus = doc.verificationStatus !== undefined && doc.verificationStatus !== null
      ? Number(doc.verificationStatus)
      : (doc.approvalStatus === 'Approved' || doc.approvalStatus === 'Accepted' ? 1 : (doc.approvalStatus === 'Rejected' ? 2 : 0));

    switch (vStatus) {
      case 1:
        return 'Approved';
      case 2:
        return 'Rejected';
      case 0:
      default:
        return 'Pending';
    }
  }

  getVerificationBadgeClass(doc: DocumentItem): string {
    if (!doc.fileName || doc.uploadStatus === 'Upload Pending' ) {
      return 'badge-pending-upload';
    }
    const vStatus = doc.verificationStatus !== undefined && doc.verificationStatus !== null
      ? Number(doc.verificationStatus)
      : (doc.approvalStatus === 'Approved' || doc.approvalStatus === 'Accepted' ? 1 : (doc.approvalStatus === 'Rejected' ? 2 : 0));

    switch (vStatus) {
      case 1:
        return 'badge-accepted';
      case 2:
        return 'badge-rejected';
      case 0:
      default:
        return 'badge-verifying';
    }
  }

  getVerificationDotClass(doc: DocumentItem): string {
    if (!doc.fileName || doc.uploadStatus === 'Upload Pending' ) {
      return 'dot-muted';
    }
    const vStatus = doc.verificationStatus !== undefined && doc.verificationStatus !== null
      ? Number(doc.verificationStatus)
      : (doc.approvalStatus === 'Approved' || doc.approvalStatus === 'Accepted' ? 1 : (doc.approvalStatus === 'Rejected' ? 2 : 0));

    switch (vStatus) {
      case 1:
        return 'dot-success';
      case 2:
        return 'dot-danger';
      case 0:
      default:
        return 'dot-verifying';
    }
  }

  promptRejectionReason(doc: DocumentItem) {
    const defaultReason = doc.rejectionReason || 'Document is unclear, invalid, or does not meet required specifications.';
    const reason = window.prompt(`Please enter the rejection reason for "${doc.name}":`, defaultReason);
    if (reason !== null) {
      this.setVerificationStatus(doc, 2, reason.trim());
    }
  }

  setVerificationStatus(doc: DocumentItem, newStatus: number, rejectionReason?: string) {
    const student = this.selectedStudent();
    const userId = student ? (student.id || `u-${student.studentCode}`) : undefined;
    const label = newStatus === 1 ? 'Approved' : (newStatus === 2 ? 'Rejected' : 'Pending');
    const effectiveReason = newStatus === 2 ? (rejectionReason !== undefined ? rejectionReason : (doc.rejectionReason || '')) : '';

    this.docService.updateVerificationStatus(doc.id, newStatus, userId, effectiveReason).subscribe({
      next: () => {
        doc.verificationStatus = newStatus;
        doc.approvalStatus = newStatus === 1 ? 'Approved' : (newStatus === 2 ? 'Rejected' : 'Pending');
        doc.isLocked = (newStatus === 1);
        doc.rejectionReason = effectiveReason;
        if (doc.permissions) {
          doc.permissions.canUpload = newStatus !== 1;
        }
        this.notificationService.success('Status Updated', `Document "${doc.name}" marked as ${label} (Status: ${newStatus})`);
      },
      error: (err: any) => {
        this.notificationService.error('Update Failed', err.error?.error || err.message || 'Failed to update verification status');
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

    const fileId = targetVer?.driveFileId || doc.driveFileId;
    let targetPath = '';

    // Directly open Google Drive viewer for uploaded Google Drive files
    if (fileId && !fileId.startsWith('local_') && !fileId.startsWith('gdrive_')) {
      targetPath = `https://drive.google.com/file/d/${fileId}/view`;
    } else if (targetVer?.webViewLink || doc.webViewLink) {
      targetPath = targetVer?.webViewLink || doc.webViewLink || '';
      // If webViewLink references /api/drive/files/<driveFileId>, extract Drive file ID and link directly
      const driveMatch = targetPath.match(/\/api\/drive\/files\/([^\/]+)/);
      if (driveMatch && driveMatch[1] && !driveMatch[1].startsWith('local_') && !driveMatch[1].startsWith('gdrive_')) {
        targetPath = `https://drive.google.com/file/d/${driveMatch[1]}/view`;
      }
    }

    if (targetPath) {
      const fullUrl = getBackendUrl(targetPath);
      window.open(fullUrl, '_blank');
    } else {
      this.notificationService.warning('Document Unavailable', 'No uploaded file found for this document.');
    }
  }

  confirmDelete(doc: DocumentItem, versionNum?: number) {
    this.selectedDoc.set(doc);
    this.selectedVersion.set(versionNum);
    this.activeModal.set('delete');
  }

  openResetPasswordModal() {
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
    this.resetPasswordError.set('');
    this.resetPasswordLoading.set(false);
    this.activeModal.set('reset-password');
  }

  submitResetPassword() {
    const newPass = this.newPassword().trim();
    const confirmPass = this.confirmPassword().trim();

    if (!newPass) {
      this.resetPasswordError.set('Please enter a new password.');
      return;
    }
    if (newPass.length < 6) {
      this.resetPasswordError.set('Password must be at least 6 characters long.');
      return;
    }
    if (newPass !== confirmPass) {
      this.resetPasswordError.set('Passwords do not match. Please re-enter.');
      return;
    }

    this.resetPasswordError.set('');
    this.resetPasswordLoading.set(true);

    this.authService.changePassword(newPass, confirmPass).subscribe({
      next: (res) => {
        this.resetPasswordLoading.set(false);
        this.closeModals();
        this.notificationService.success('Password Updated', res.message || 'Your password has been reset successfully.');
      },
      error: (err) => {
        this.resetPasswordLoading.set(false);
        this.resetPasswordError.set(err.error?.error || 'Failed to update password. Please try again.');
      }
    });
  }

  closeModals() {
    this.activeModal.set(null);
    this.selectedVersion.set(undefined);
    this.resetPasswordError.set('');
    this.resetPasswordLoading.set(false);
  }



  handleUpload(event: { file: File; notes: string; documentType?: string }) {
    const doc = this.selectedDoc();
    if (!doc) return;

    this.uploadingInProgress.set(true);
    const docId = (doc.id && doc.id > 0) ? doc.id : null;
    const targetUserId = this.selectedStudent()?.id;
    this.docService.uploadDocument(docId, event.file, event.notes, event.documentType, targetUserId).subscribe({
      next: (res: any) => {
        this.uploadingInProgress.set(false);
        const renamedName = res?.generatedFileName || (event.documentType ? `${event.documentType}.${event.file.name.split('.').pop()}` : event.file.name);
        this.notificationService.success(
          'Upload Successful',
          `Document saved as "${renamedName}" to checklist and Drive.`
        );
        this.closeModals();
        this.loadDocuments(targetUserId);
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
    const targetUserId = this.selectedStudent()?.id;
    this.docService.deleteDocument(doc.id, verNum, targetUserId).subscribe({
      next: (res) => {
        this.notificationService.info('Deleted', res.message);
        this.closeModals();
        this.loadDocuments(targetUserId);
      },
      error: (err) => {
        this.notificationService.error('Delete Failed', err.error?.error || 'Failed to delete document.');
      }
    });
  }
}
