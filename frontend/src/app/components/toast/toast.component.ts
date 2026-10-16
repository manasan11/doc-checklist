import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container" aria-live="polite">
      @for (toast of notificationService.toasts(); track toast.id) {
        <div class="toast-card" [ngClass]="'toast-' + toast.type">
          <div class="toast-icon">
            @if (toast.type === 'success') {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            } @else if (toast.type === 'error') {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            } @else if (toast.type === 'warning') {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            } @else {
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            }
          </div>
          <div class="toast-content">
            <h5 class="toast-title">{{ toast.title }}</h5>
            <p class="toast-message">{{ toast.message }}</p>
          </div>
          <button class="toast-close" (click)="notificationService.dismiss(toast.id)" aria-label="Dismiss">
            &times;
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 420px;
      width: calc(100% - 48px);
      pointer-events: none;
    }

    .toast-card {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background: #FFFFFF;
      border: 1px solid #EAE3D8;
      box-shadow: 0 10px 25px -5px rgba(40, 20, 10, 0.12), 0 4px 10px rgba(0, 0, 0, 0.04);
      animation: toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .toast-success {
      border-left: 4px solid #10B981;
      .toast-icon { color: #059669; }
    }

    .toast-error {
      border-left: 4px solid #EF4444;
      .toast-icon { color: #DC2626; }
    }

    .toast-warning {
      border-left: 4px solid #F59E0B;
      .toast-icon { color: #D97706; }
    }

    .toast-info {
      border-left: 4px solid #F15A24;
      .toast-icon { color: #EA580C; }
    }

    .toast-icon {
      flex-shrink: 0;
      margin-top: 1px;
    }

    .toast-content {
      flex: 1;
    }

    .toast-title {
      font-size: 0.88rem;
      font-weight: 700;
      color: #1C1917;
      margin-bottom: 2px;
    }

    .toast-message {
      font-size: 0.8rem;
      color: #78716C;
      line-height: 1.4;
      word-break: break-word;
    }

    .toast-close {
      background: none;
      border: none;
      color: #A8A29E;
      font-size: 1.3rem;
      line-height: 1;
      cursor: pointer;
      padding: 0 4px;
      transition: color 0.15s;
      &:hover { color: #1C1917; }
    }

    @keyframes toastSlideIn {
      from { transform: translateX(50px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `]
})
export class ToastComponent {
  notificationService = inject(NotificationService);
}
