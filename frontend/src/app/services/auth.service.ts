import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { User, AuthResponse, ForgotPasswordResponse } from '../models/user.model';

const API_URL = (typeof window !== 'undefined' && window.location.port === '4200') ? 'http://localhost:5000/api' : '/api';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly TOKEN_KEY = 'docuvault_token';
  private readonly USER_KEY = 'docuvault_user';

  currentUser = signal<User | null>(this.getStoredUser());
  token = signal<string | null>(this.getStoredToken());
  isAuthenticated = computed(() => !!this.currentUser());
  isAdmin = computed(() => this.currentUser()?.role === 'admin');

  constructor() {
    // Purge any legacy shared localStorage sessions to eliminate cross-tab bleed
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
      } catch (_) {}
    }

    // Active session is strictly bound to THIS browser tab (sessionStorage)
    const user = this.getStoredUser();
    const token = this.getStoredToken();
    if (user && token) {
      this.currentUser.set(user);
      this.token.set(token);
    } else {
      this.currentUser.set(null);
      this.token.set(null);
    }
  }

  private getStoredToken(): string | null {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return sessionStorage.getItem(this.TOKEN_KEY);
    }
    return null;
  }

  private getStoredUser(): User | null {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const data = sessionStorage.getItem(this.USER_KEY);
      if (data) {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  getAuthHeaders(): { [header: string]: string } {
    const token = this.token();
    const user = this.currentUser();
    const headers: { [header: string]: string } = {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (user?.id) {
      headers['X-User-Id'] = user.id;
    }
    if (user?.email) {
      headers['X-User-Email'] = user.email;
    }

    return headers;
  }

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API_URL}/auth/login`, { username, password }).pipe(
      tap(res => {
        if (res && res.token && res.user) {
          this.setSession(res.token, res.user);
        }
      })
    );
  }

  forgotPassword(email: string): Observable<ForgotPasswordResponse> {
    return this.http.post<ForgotPasswordResponse>(`${API_URL}/auth/forgot-password`, { email });
  }

  verifyResetToken(token: string): Observable<{ valid: boolean; email?: string; name?: string; error?: string }> {
    return this.http.get<{ valid: boolean; email?: string; name?: string; error?: string }>(
      `${API_URL}/auth/verify-reset-token`,
      { params: { token } }
    );
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string; email?: string }> {
    return this.http.post<{ message: string; email?: string }>(`${API_URL}/auth/reset-password`, { token, newPassword });
  }

  changePassword(newPassword: string, confirmPassword?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${API_URL}/auth/change-password`,
      { newPassword, confirmPassword },
      { headers: this.getAuthHeaders() }
    );
  }

  setSession(token: string, user: User) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      // Session lives EXCLUSIVELY in sessionStorage for this specific browser tab
      sessionStorage.setItem(this.TOKEN_KEY, token);
      sessionStorage.setItem(this.USER_KEY, JSON.stringify(user));

      // Clean up localStorage to prevent any other tab from reading this user
      try {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
      } catch (_) {}
    }
    this.token.set(token);
    this.currentUser.set(user);
  }

  logout() {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(this.TOKEN_KEY);
        sessionStorage.removeItem(this.USER_KEY);
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
      } catch (_) {}
    }
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}
