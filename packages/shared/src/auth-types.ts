export interface User {
  id: string;
  email: string;
  displayName: string;
  preferredLanguage: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SignUpRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
  jti: string;
}
