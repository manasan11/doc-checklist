import { Component, inject, signal, ElementRef, ViewChild, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <!-- Brand Header -->
        <div class="card-header">
          <div class="brand-badge">
            <span class="brand-name">Ysquare</span>
          </div>
          <h1 class="card-title">
            @if (currentView() === 'login') {
              Login
            } @else if (currentView() === 'forgot') {
              Forgot Password
            } @else {
              Reset Password
            }
          </h1>
          @if (currentView() !== 'login') {
            <p class="card-subtitle">
              @if (currentView() === 'forgot') {
                Enter your registered email or username to reset your password
              } @else {
                @if (targetEmail()) {
                  Create a new secure password for {{ targetEmail() }}
                } @else {
                  Enter your new password below
                }
              }
            </p>
          }
        </div>

        <!-- 1. LOGIN VIEW -->
        @if (currentView() === 'login') {
          <form (ngSubmit)="onLogin()" class="login-form">
            <!-- Username / Email -->
            <div class="form-group">
              <label class="form-label" for="username">Username / Email</label>
              <input 
                type="text" 
                id="username" 
                name="username" 
                #usernameInput
                [(ngModel)]="username" 
                (ngModelChange)="errorMessage.set('')"
                required 
                class="form-control" 
                placeholder="e.g. johndoe (or any registered email)"
                autocomplete="username"
              >
            </div>

            <!-- Password -->
            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <div class="password-input-wrapper">
                <input 
                  [type]="showPassword() ? 'text' : 'password'" 
                  id="password" 
                  name="password" 
                  #passwordInput
                  [(ngModel)]="password" 
                  (ngModelChange)="errorMessage.set('')"
                  required 
                  class="form-control" 
                  placeholder="e.g. password123"
                  autocomplete="current-password"
                >
                <button 
                  type="button" 
                  class="password-toggle-btn" 
                  (click)="toggleShowPassword()" 
                  [title]="showPassword() ? 'Hide password' : 'Show password'"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                >
                  @if (showPassword()) {
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  } @else {
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  }
                </button>
              </div>
            </div>

            <!-- Options: Forgot Password -->
            <div class="form-options">
              <button type="button" class="link-btn" (click)="setView('forgot')">
                Forgot Password?
              </button>
            </div>

            <!-- Inline Error Notice -->
            @if (errorMessage()) {
              <div class="error-alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <!-- Login Button -->
            <button 
              type="submit" 
              [disabled]="loading()" 
              class="btn-submit"
            >
              {{ loading() ? 'Logging in...' : 'Login' }}
            </button>

          </form>
        }

        <!-- 2. FORGOT PASSWORD VIEW -->
        @if (currentView() === 'forgot') {
          <form (ngSubmit)="onForgotPassword()" class="login-form">
            <div class="form-group">
              <label class="form-label" for="forgotEmail">Registered Email or Username</label>
              <input 
                type="text" 
                id="forgotEmail" 
                name="forgotEmail" 
                [(ngModel)]="forgotEmail" 
                (ngModelChange)="errorMessage.set(''); resetSentMessage.set('')"
                required 
                class="form-control" 
                placeholder="Enter your registered email or username"
                autocomplete="username"
              >
            </div>

            @if (resetSentMessage()) {
              <div class="success-alert">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                <span>{{ resetSentMessage() }}</span>
              </div>
            }

            @if (errorMessage()) {
              <div class="error-alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <div class="form-actions">
              <button 
                type="submit" 
                [disabled]="loading() || !forgotEmail" 
                class="btn-submit"
              >
                {{ loading() ? 'Sending Email Link...' : 'Send Reset Link' }}
              </button>
              <button type="button" class="btn-back" (click)="setView('login')">
                &larr; Back to Login
              </button>
            </div>
          </form>
        }

        <!-- 3. PASSWORD RESET VIEW (Opened after clicking email link) -->
        @if (currentView() === 'reset') {
          @if (tokenError()) {
            <div class="error-alert token-error-banner">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <div>
                <strong style="display: block; margin-bottom: 2px;">Reset Link Invalid or Expired</strong>
                <span>{{ tokenError() }}</span>
              </div>
            </div>
            <div class="form-actions" style="margin-top: 18px;">
              <button type="button" class="btn-submit" (click)="resetForgotState(); setView('forgot')">
                Request a New Reset Link
              </button>
              <button type="button" class="btn-back" (click)="setView('login')">
                &larr; Back to Login
              </button>
            </div>
          } @else {
            <form (ngSubmit)="onResetPassword()" class="login-form">
              @if (targetEmail()) {
                <div class="verified-account-banner">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  <span>Resetting password for: <strong>{{ targetEmail() }}</strong></span>
                </div>
              }

              @if (!isTokenFromUrl()) {
                <div class="form-group">
                  <label class="form-label" for="resetToken">Reset Token</label>
                  <input 
                    type="text" 
                    id="resetToken" 
                    name="resetToken" 
                    [(ngModel)]="resetTokenInput" 
                    (ngModelChange)="errorMessage.set('')"
                    required 
                    class="form-control" 
                    placeholder="Enter reset token from email"
                  >
                </div>
              }

              <div class="form-group">
                <label class="form-label" for="newPassword">New Password</label>
                <div class="password-input-wrapper">
                  <input 
                    [type]="showNewPassword() ? 'text' : 'password'" 
                    id="newPassword" 
                    name="newPassword" 
                    [(ngModel)]="newPassword" 
                    (ngModelChange)="errorMessage.set('')"
                    required 
                    minlength="6" 
                    class="form-control" 
                    placeholder="Enter new password (min. 6 characters)"
                    autocomplete="new-password"
                  >
                  <button 
                    type="button" 
                    class="password-toggle-btn" 
                    (click)="toggleShowNewPassword()" 
                    [title]="showNewPassword() ? 'Hide password' : 'Show password'"
                    [attr.aria-label]="showNewPassword() ? 'Hide password' : 'Show password'"
                  >
                    @if (showNewPassword()) {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    } @else {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    }
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="confirmPassword">Confirm Password</label>
                <div class="password-input-wrapper">
                  <input 
                    [type]="showConfirmPassword() ? 'text' : 'password'" 
                    id="confirmPassword" 
                    name="confirmPassword" 
                    [(ngModel)]="confirmPassword" 
                    (ngModelChange)="errorMessage.set('')"
                    required 
                    class="form-control" 
                    placeholder="Re-enter new password"
                    autocomplete="new-password"
                  >
                  <button 
                    type="button" 
                    class="password-toggle-btn" 
                    (click)="toggleShowConfirmPassword()" 
                    [title]="showConfirmPassword() ? 'Hide password' : 'Show password'"
                    [attr.aria-label]="showConfirmPassword() ? 'Hide password' : 'Show password'"
                  >
                    @if (showConfirmPassword()) {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    } @else {
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    }
                  </button>
                </div>
              </div>

              @if (newPassword && confirmPassword && newPassword !== confirmPassword) {
                <div class="mismatch-notice">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <span>Passwords do not match yet</span>
                </div>
              }

              @if (errorMessage()) {
                <div class="error-alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                  <span>{{ errorMessage() }}</span>
                </div>
              }

              <div class="form-actions">
                <button 
                  type="submit" 
                  [disabled]="loading() || !resetTokenInput || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword" 
                  class="btn-submit"
                >
                  {{ loading() ? 'Updating Password...' : 'Reset Password' }}
                </button>
                <button type="button" class="btn-back" (click)="setView('login')">
                  &larr; Back to Login
                </button>
              </div>
            </form>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: radial-gradient(ellipse at 50% 20%, rgba(241, 90, 36, 0.08) 0%, #FAF7F2 65%, #F4EFE6 100%);
    }

    .login-card {
      width: 100%;
      max-width: 440px;
      background: #FFFFFF;
      border: 1px solid #EAE3D8;
      border-radius: 20px;
      padding: 38px 34px;
      box-shadow: 0 16px 40px -8px rgba(40, 20, 10, 0.08), 0 4px 14px -2px rgba(241, 90, 36, 0.05);
      position: relative;
      overflow: hidden;
      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 5px;
        background: linear-gradient(135deg, #E64323 0%, #F15A24 50%, #F97316 100%);
      }
    }

    .card-header {
      margin-bottom: 24px;
      text-align: center;
    }

    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 12px;
    }

    .brand-name {
      font-size: 0.8rem;
      font-weight: 700;
      color: #EA580C;
      letter-spacing: 0.5px;
    }

    .brand-dot {
      width: 4px;
      height: 4px;
      background-color: #FDBA74;
      border-radius: 50%;
    }

    .brand-sub {
      font-size: 0.75rem;
      font-weight: 500;
      color: #9A3412;
    }

    .card-title {
      font-size: 1.85rem;
      font-weight: 700;
      color: #1C1917;
      margin-bottom: 6px;
      letter-spacing: -0.02em;
    }

    .card-subtitle {
      font-size: 0.88rem;
      color: #78716C;
      line-height: 1.45;
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 0.84rem;
      font-weight: 600;
      color: #292524;
    }

    .form-control {
      width: 100%;
      padding: 11px 14px;
      background: #FAF8F5;
      border: 1px solid #E5DED3;
      border-radius: 10px;
      color: #1C1917;
      font-size: 0.92rem;
      transition: all 0.2s;
      box-sizing: border-box;
    }

    .form-control:focus {
      outline: none;
      background: #FFFFFF;
      border-color: #F15A24;
      box-shadow: 0 0 0 3px rgba(241, 90, 36, 0.18);
    }

    .form-control:-webkit-autofill,
    .form-control:-webkit-autofill:hover, 
    .form-control:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0px 1000px #FAF8F5 inset !important;
      -webkit-text-fill-color: #1C1917 !important;
      transition: background-color 5000s ease-in-out 0s;
    }

    .form-control::placeholder {
      color: #A8A29E;
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

    .password-toggle-btn:focus-visible {
      outline: 2px solid #F15A24;
      outline-offset: 1px;
    }

    .form-options {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: -4px;
      margin-bottom: 2px;
    }

    .link-btn {
      background: none;
      border: none;
      color: #E64323;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
      transition: color 0.15s;
    }

    .link-btn:hover {
      color: #F97316;
      text-decoration: underline;
    }

    .error-alert {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 10px;
      padding: 11px 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #B91C1C;
      font-size: 0.84rem;
      line-height: 1.4;
      svg { flex-shrink: 0; color: #DC2626; }
    }

    .success-alert {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #166534;
      font-size: 0.86rem;
      line-height: 1.45;
      svg { flex-shrink: 0; color: #16A34A; }
    }

    .mismatch-notice {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #D97706;
      font-size: 0.78rem;
      font-weight: 500;
      margin-top: -6px;
    }


    .btn-submit {
      width: 100%;
      padding: 12px 16px;
      background: linear-gradient(135deg, #E64323 0%, #F15A24 50%, #F97316 100%);
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 0.94rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(230, 67, 35, 0.32);
      transition: all 0.2s;
      margin-top: 4px;
    }

    .btn-submit:hover:not(:disabled) {
      background: linear-gradient(135deg, #D63919 0%, #E24F1A 50%, #EA580C 100%);
      box-shadow: 0 6px 18px rgba(230, 67, 35, 0.42);
      transform: translateY(-1px);
    }

    .btn-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .credential-hint {
      text-align: center;
      font-size: 0.78rem;
      color: #78716C;
      margin-top: 6px;
      line-height: 1.5;
      b { color: #292524; }
    }

    .form-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 6px;
    }

    .btn-back {
      background: #FAF7F2;
      border: 1px solid #E5DED3;
      color: #57534E;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }

    .btn-back:hover {
      background: #F5EFE6;
      color: #1C1917;
      border-color: #D8CEBE;
    }

    /* Email sent dispatched card */
    .mail-dispatched-box {
      text-align: center;
      padding: 6px 0;
      animation: fadeIn 0.3s ease;
    }

    .mail-icon-circle {
      width: 60px;
      height: 60px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #EA580C;
    }

    .mail-sent-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #1C1917;
      margin: 0 0 8px;
    }

    .mail-sent-desc {
      font-size: 0.86rem;
      color: #57534E;
      margin: 0 0 10px;
    }

    .highlight-email-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #FAF8F5;
      border: 1px solid #E5DED3;
      padding: 6px 14px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.88rem;
      color: #1C1917;
      margin-bottom: 14px;
      svg { color: #EA580C; }
    }

    .mail-instruction {
      font-size: 0.82rem;
      color: #78716C;
      line-height: 1.5;
      margin: 0 0 16px;
    }

    .reset-link-preview {
      background: #FFF7ED;
      border: 1px solid #FDBA74;
      border-radius: 12px;
      padding: 12px 14px;
      text-align: left;
      margin-bottom: 12px;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .preview-badge {
      font-size: 0.72rem;
      font-weight: 700;
      color: #9A3412;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .preview-tag {
      font-size: 0.72rem;
      color: #EA580C;
      font-weight: 600;
    }

    .btn-open-link {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #FFFFFF;
      border: 1px solid #FED7AA;
      border-radius: 8px;
      padding: 10px 14px;
      color: #C2410C;
      font-weight: 600;
      font-size: 0.86rem;
      text-decoration: none;
      transition: all 0.2s;
    }

    .btn-open-link:hover {
      background: #EA580C;
      color: #FFFFFF;
      border-color: #EA580C;
    }

    /* Verified badge on reset view */
    .verified-account-banner {
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #166534;
      font-size: 0.85rem;
      svg { flex-shrink: 0; color: #16A34A; }
    }

    .token-error-banner {
      padding: 14px;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class LoginComponent implements OnInit, AfterViewInit {
  @ViewChild('usernameInput') usernameInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('passwordInput') passwordInputRef?: ElementRef<HTMLInputElement>;

  authService = inject(AuthService);
  notificationService = inject(NotificationService);
  router = inject(Router);
  route = inject(ActivatedRoute);

  currentView = signal<'login' | 'forgot' | 'reset'>('login');
  loading = signal<boolean>(false);
  errorMessage = signal<string>('');

  username = '';
  password = '';
  showPassword = signal<boolean>(false);

  // Forgot password state
  forgotEmail = '';
  emailSentSuccess = signal<boolean>(false);
  forgotSuccessEmail = signal<string>('');
  generatedResetLink = signal<string>('');
  generatedToken = signal<string>('');
  resetSentMessage = signal<string>('');
  isLiveEmailSent = signal<boolean>(false);
  devResetLink = signal<string>('');

  // Reset password state
  resetTokenInput = '';
  isTokenFromUrl = signal<boolean>(false);
  targetEmail = signal<string>('');
  tokenError = signal<string>('');
  newPassword = '';
  confirmPassword = '';
  showNewPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);

  ngOnInit() {
    // Listen for query parameters from email link: /login?view=reset&token=...&email=...
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const email = params['email'];

      // ONLY open reset view if a token is present from clicking the email link
      if (token) {
        this.currentView.set('reset');
        this.resetTokenInput = token;
        this.isTokenFromUrl.set(true);
        if (email) {
          this.targetEmail.set(email);
        }
        this.verifyResetToken(token);
      } else if (params['view'] === 'forgot') {
        this.currentView.set('forgot');
      }
    });
  }

  ngAfterViewInit() {
    this.syncAutofilledValues();
    setTimeout(() => this.syncAutofilledValues(), 100);
    setTimeout(() => this.syncAutofilledValues(), 300);
    setTimeout(() => this.syncAutofilledValues(), 800);
  }

  syncAutofilledValues() {
    if (this.usernameInputRef?.nativeElement?.value && !this.username) {
      this.username = this.usernameInputRef.nativeElement.value;
    }
    if (this.passwordInputRef?.nativeElement?.value && !this.password) {
      this.password = this.passwordInputRef.nativeElement.value;
    }
  }

  toggleShowPassword() {
    this.showPassword.update(v => !v);
  }

  toggleShowNewPassword() {
    this.showNewPassword.update(v => !v);
  }

  toggleShowConfirmPassword() {
    this.showConfirmPassword.update(v => !v);
  }

  setView(view: 'login' | 'forgot' | 'reset') {
    this.currentView.set(view);
    this.errorMessage.set('');
    this.resetSentMessage.set('');
    this.isLiveEmailSent.set(false);
    this.devResetLink.set('');
    this.showPassword.set(false);
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
  }

  resetForgotState() {
    this.emailSentSuccess.set(false);
    this.forgotSuccessEmail.set('');
    this.generatedResetLink.set('');
    this.generatedToken.set('');
    this.errorMessage.set('');
  }

  verifyResetToken(token: string) {
    this.tokenError.set('');
    this.authService.verifyResetToken(token).subscribe({
      next: (res) => {
        if (res.valid) {
          if (res.email) {
            this.targetEmail.set(res.email);
          }
        } else {
          this.tokenError.set(res.error || 'Reset link has expired or is invalid.');
        }
      },
      error: (err) => {
        const msg = err.error?.error || 'This reset link has expired or is invalid. Please request a new one.';
        this.tokenError.set(msg);
      }
    });
  }

  navigateViaResetLink(event: MouseEvent) {
    event.preventDefault();
    if (this.generatedToken()) {
      this.resetTokenInput = this.generatedToken();
      this.isTokenFromUrl.set(true);
      if (this.forgotSuccessEmail()) {
        this.targetEmail.set(this.forgotSuccessEmail());
      }
      this.setView('reset');
      this.verifyResetToken(this.resetTokenInput);
    }
  }

  onLogin() {
    this.syncAutofilledValues();
    if (this.usernameInputRef?.nativeElement?.value) {
      this.username = this.usernameInputRef.nativeElement.value;
    }
    if (this.passwordInputRef?.nativeElement?.value) {
      this.password = this.passwordInputRef.nativeElement.value;
    }

    if (!this.username.trim() || !this.password) {
      this.errorMessage.set('Please enter both username/email and password.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.authService.login(this.username, this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.notificationService.success('Welcome', `Logged in as ${res.user.name}`);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error || 'Invalid username or password';
        this.errorMessage.set(msg);
        this.notificationService.error('Login Failed', msg);
      }
    });
  }

  onForgotPassword() {
    if (!this.forgotEmail || !this.forgotEmail.trim()) {
      this.errorMessage.set('Please enter your registered email address.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.resetSentMessage.set('');
    this.isLiveEmailSent.set(false);
    this.devResetLink.set('');
    this.authService.forgotPassword(this.forgotEmail.trim()).subscribe({
      next: (res) => {
        this.loading.set(false);
        const emailSent = res.email || this.forgotEmail.trim();
        this.resetSentMessage.set(`A password reset link has been dispatched to ${emailSent}. Please check your email inbox and click the link to reset your password.`);
        this.notificationService.success('Email Sent', 'Reset link sent to your registered email.');
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error || 'No registered account found with that email or username in the database.';
        this.errorMessage.set(msg);
        this.notificationService.error('Not Found', msg);
      }
    });
  }

  onResetPassword() {
    if (!this.resetTokenInput) {
      this.errorMessage.set('Reset token is required.');
      return;
    }

    if (!this.newPassword || this.newPassword.length < 6) {
      this.errorMessage.set('New password must be at least 6 characters long.');
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('New password and confirm password do not match.');
      this.notificationService.warning('Mismatch', 'Passwords do not match');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.authService.resetPassword(this.resetTokenInput, this.newPassword).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.notificationService.success('Password Updated', res.message || 'Your password has been successfully reset. Please log in.');
        
        // Populate username/email for convenient immediate login
        if (res.email || this.targetEmail()) {
          this.username = res.email || this.targetEmail();
        }
        this.password = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.resetTokenInput = '';
        this.isTokenFromUrl.set(false);
        this.targetEmail.set('');

        // Clean query parameters from URL
        this.router.navigate(['/login'], { queryParams: {} });
        this.setView('login');
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error || 'Failed to reset password. The link or token may have expired.';
        this.errorMessage.set(msg);
        this.notificationService.error('Reset Failed', msg);
      }
    });
  }
}
