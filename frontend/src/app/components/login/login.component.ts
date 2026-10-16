import { Component, inject, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
          <h1 class="card-title">
            @if (currentView() === 'login') {
              Login
            } @else if (currentView() === 'forgot') {
              Forgot Password
            } @else {
              Password Reset
            }
          </h1>
          <p class="card-subtitle">
            @if (currentView() === 'login') {
              Sign in to access your Document Dashboard
            } @else if (currentView() === 'forgot') {
              Enter your email to receive a password reset token
            } @else {
              Enter your reset token and new password
            }
          </p>
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
                placeholder="e.g. johndoe (or any email)"
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

            <!-- Options: Forgot Password & Reset Password -->
            <div class="form-options">
              <button type="button" class="link-btn" (click)="setView('forgot')">
                Forgot Password?
              </button>
              <button type="button" class="link-btn" (click)="setView('reset')">
                Reset Password
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

            <!-- Subtle Credential Hint -->
            <p class="credential-hint">
              Default login: <b>johndoe</b> / <b>password123</b> <br>
              <span style="color: #64748b;">(Or enter any email & password to sign in)</span>
            </p>
          </form>
        }

        <!-- 2. FORGOT PASSWORD VIEW -->
        @if (currentView() === 'forgot') {
          <form (ngSubmit)="onForgotPassword()" class="login-form">
            <div class="form-group">
              <label class="form-label" for="forgotEmail">Email Address</label>
              <input 
                type="email" 
                id="forgotEmail" 
                name="forgotEmail" 
                [(ngModel)]="forgotEmail" 
                (ngModelChange)="errorMessage.set('')"
                required 
                class="form-control" 
                placeholder="Enter your registered email"
              >
            </div>

            @if (errorMessage()) {
              <div class="error-alert">
                <span>{{ errorMessage() }}</span>
              </div>
            }

            @if (generatedToken()) {
              <div class="token-box">
                <span class="token-label">Your Reset Token:</span>
                <code class="token-value">{{ generatedToken() }}</code>
                <button type="button" class="btn-token-next" (click)="proceedToResetWithToken()">
                  Continue to Password Reset &rarr;
                </button>
              </div>
            }

            <div class="form-actions">
              <button 
                type="submit" 
                [disabled]="loading() || !forgotEmail" 
                class="btn-submit"
              >
                {{ loading() ? 'Submitting...' : 'Submit' }}
              </button>
              <button type="button" class="btn-back" (click)="setView('login')">
                &larr; Back to Login
              </button>
            </div>
          </form>
        }

        <!-- 3. PASSWORD RESET VIEW -->
        @if (currentView() === 'reset') {
          <form (ngSubmit)="onResetPassword()" class="login-form">
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
                placeholder="Enter reset token"
              >
            </div>

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
                  placeholder="Confirm new password"
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

            @if (errorMessage()) {
              <div class="error-alert">
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <div class="form-actions">
              <button 
                type="submit" 
                [disabled]="loading() || !resetTokenInput || !newPassword || newPassword !== confirmPassword" 
                class="btn-submit"
              >
                {{ loading() ? 'Resetting...' : 'Reset Password' }}
              </button>
              <button type="button" class="btn-back" (click)="setView('login')">
                &larr; Back to Login
              </button>
            </div>
          </form>
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
      max-width: 420px;
      background: #FFFFFF;
      border: 1px solid #EAE3D8;
      border-radius: 18px;
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
      margin-bottom: 26px;
      text-align: center;
    }

    .card-title {
      font-size: 1.8rem;
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
      gap: 8px;
      color: #B91C1C;
      font-size: 0.83rem;
      line-height: 1.4;
      svg { flex-shrink: 0; color: #DC2626; }
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
      gap: 12px;
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

    .token-box {
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      border-radius: 10px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .token-label {
      font-size: 0.76rem;
      color: #C2410C;
      text-transform: uppercase;
      font-weight: 700;
    }

    .token-value {
      font-family: monospace;
      font-size: 0.95rem;
      color: #EA580C;
      background: #FFFFFF;
      border: 1px solid #FDBA74;
      padding: 8px 12px;
      border-radius: 6px;
      word-break: break-all;
    }

    .btn-token-next {
      background: none;
      border: none;
      color: #E64323;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      text-align: right;
      padding: 4px 0 0 0;
    }

    .btn-token-next:hover {
      color: #F97316;
      text-decoration: underline;
    }
  `]
})
export class LoginComponent implements AfterViewInit {
  @ViewChild('usernameInput') usernameInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('passwordInput') passwordInputRef?: ElementRef<HTMLInputElement>;

  authService = inject(AuthService);
  notificationService = inject(NotificationService);
  router = inject(Router);

  currentView = signal<'login' | 'forgot' | 'reset'>('login');
  loading = signal<boolean>(false);
  errorMessage = signal<string>('');

  username = '';
  password = '';
  showPassword = signal<boolean>(false);

  forgotEmail = '';
  generatedToken = signal<string>('');

  resetTokenInput = '';
  newPassword = '';
  confirmPassword = '';
  showNewPassword = signal<boolean>(false);
  showConfirmPassword = signal<boolean>(false);

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
    this.showPassword.set(false);
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
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
    this.loading.set(true);
    this.errorMessage.set('');
    this.authService.forgotPassword(this.forgotEmail).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.generatedToken.set(res.resetToken);
        this.notificationService.success('Token Generated', 'Reset token generated successfully.');
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error || 'Failed to request reset token';
        this.errorMessage.set(msg);
        this.notificationService.error('Error', msg);
      }
    });
  }

  proceedToResetWithToken() {
    this.resetTokenInput = this.generatedToken();
    this.setView('reset');
  }

  onResetPassword() {
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('Passwords do not match');
      this.notificationService.warning('Mismatch', 'Passwords do not match');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');
    this.authService.resetPassword(this.resetTokenInput, this.newPassword).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.notificationService.success('Success', res.message);
        this.password = '';
        this.setView('login');
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.error || 'Failed to reset password';
        this.errorMessage.set(msg);
        this.notificationService.error('Reset Failed', msg);
      }
    });
  }
}
