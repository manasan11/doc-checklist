export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  studentCode?: string;
  department?: string;
}

export interface StudentUser {
  id: string;
  name: string;
  email: string;
  username?: string;
  role?: string;
  studentCode?: string;
  department?: string;
  documentsCount?: number;
  uploadedCount?: number;
  approvedCount?: number;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

export interface ForgotPasswordResponse {
  message: string;
  resetToken?: string;
  resetLink?: string;
  email?: string;
  liveEmailSent?: boolean;
  instructions?: string;
}
