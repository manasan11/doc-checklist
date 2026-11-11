import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { UserNotification, NotificationResponse, UnreadCountResponse } from '../models/user-notification.model';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const API_URL = environment.apiUrl;

@Injectable({
  providedIn: 'root'
})
export class UserNotificationService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  // Reactive State Signals
  notifications = signal<UserNotification[]>([]);
  unreadCount = signal<number>(0);
  isOpen = signal<boolean>(false);
  isLoading = signal<boolean>(false);

  private pollIntervalId: any = null;

  constructor() {
    // Start polling unread count when authenticated
    this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    this.refresh();
    this.pollIntervalId = setInterval(() => {
      if (this.authService.isAuthenticated()) {
        this.loadUnreadCount().subscribe();
      }
    }, 30000); // 30s poll
  }

  stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  refresh() {
    if (this.authService.isAuthenticated()) {
      this.loadUnreadCount().subscribe();
      if (this.isOpen()) {
        this.loadNotifications().subscribe();
      }
    }
  }

  toggleDropdown() {
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      this.loadNotifications().subscribe();
    }
  }

  closeDropdown() {
    this.isOpen.set(false);
  }

  loadNotifications(): Observable<UserNotification[]> {
    if (!this.authService.isAuthenticated()) {
      return of([]);
    }
    this.isLoading.set(true);
    return this.http.get<NotificationResponse>(
      `${API_URL}/notifications`,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => res.notifications || []),
      tap(list => {
        this.notifications.set(list);
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.warn('[UserNotificationService] Failed to load notifications:', err);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  loadUnreadCount(): Observable<number> {
    if (!this.authService.isAuthenticated()) {
      this.unreadCount.set(0);
      return of(0);
    }
    return this.http.get<UnreadCountResponse>(
      `${API_URL}/notifications/unread-count`,
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => res.unreadCount || 0),
      tap(count => this.unreadCount.set(count)),
      catchError(err => {
        console.warn('[UserNotificationService] Failed to load unread count:', err);
        return of(0);
      })
    );
  }

  markAsRead(notificationId: number): Observable<boolean> {
    // Optimistic UI update
    this.notifications.update(list => 
      list.map(n => n.id === notificationId ? { ...n, isRead: true, viewStatus: 1, readStatus: 1 } : n)
    );
    this.unreadCount.update(count => Math.max(0, count - 1));

    return this.http.patch<{ success: boolean }>(
      `${API_URL}/notifications/${notificationId}/read`,
      {},
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => !!res.success),
      catchError(err => {
        console.warn('[UserNotificationService] Failed to mark as read:', err);
        return of(false);
      })
    );
  }

  markAllAsRead(): Observable<boolean> {
    // Optimistic UI update
    this.notifications.update(list => 
      list.map(n => ({ ...n, isRead: true, viewStatus: 1, readStatus: 1 }))
    );
    this.unreadCount.set(0);

    return this.http.patch<{ success: boolean }>(
      `${API_URL}/notifications/mark-all-read`,
      {},
      { headers: this.authService.getAuthHeaders() }
    ).pipe(
      map(res => !!res.success),
      catchError(err => {
        console.warn('[UserNotificationService] Failed to mark all as read:', err);
        return of(false);
      })
    );
  }
}

