export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  department?: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

export interface ForgotPasswordResponse {
  message: string;
  resetToken: string;
  instructions: string;
}
