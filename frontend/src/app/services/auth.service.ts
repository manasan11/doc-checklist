import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { User, AuthResponse, ForgotPasswordResponse } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);

  private readonly TOKEN_KEY = 'docuvault_token';
  private readonly USER_KEY = 'docuvault_user';

  private defaultUser: User = {
    id: 'u-1',
    name: 'Johnathan Doe',
    email: 'john.doe@example.com',
    username: 'johndoe',
    role: 'user',
    department: 'Engineering & Architecture'
  };

  currentUser = signal<User | null>(this.getStoredUser() || this.defaultUser);
  token = signal<string | null>(this.getStoredToken() || 'local_session_token');
  isAuthenticated = computed(() => !!this.currentUser());
  isAdmin = computed(() => this.currentUser()?.role === 'admin');

  constructor() {
    if (!this.getStoredUser()) {
      this.setSession('local_session_token', this.defaultUser);
    }
  }

  private getStoredToken(): string | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(this.TOKEN_KEY);
    }
    return null;
  }

  private getStoredUser(): User | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      const data = localStorage.getItem(this.USER_KEY);
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
    return {};
  }

  login(username: string, password: string): Observable<AuthResponse> {
    const user: User = {
      id: 'u-' + Date.now(),
      name: username ? (username.charAt(0).toUpperCase() + username.slice(1)) : 'Johnathan Doe',
      email: username.includes('@') ? username : `${username || 'johndoe'}@example.com`,
      username: username || 'johndoe',
      role: (username === 'admin' || username.includes('admin')) ? 'admin' : 'user',
      department: 'Engineering & Architecture'
    };
    const token = 'local_token_' + Date.now();
    this.setSession(token, user);
    return of({
      message: 'Login successful',
      token,
      user
    });
  }

  forgotPassword(email: string): Observable<ForgotPasswordResponse> {
    return of({
      message: 'Password reset link sent to ' + email,
      resetToken: 'mock_token_' + Date.now(),
      instructions: 'Please check your email.'
    });
  }

  resetPassword(token: string, newPassword: string): Observable<{ message: string }> {
    return of({ message: 'Password updated successfully' });
  }

  setSession(token: string, user: User) {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
    this.token.set(token);
    this.currentUser.set(user);
  }

  logout() {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
    }
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }
}
