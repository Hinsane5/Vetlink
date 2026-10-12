import type { Request } from 'express';

export const USER_ROLES = ['farmer', 'vet'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  fullName: string;
  roles: UserRole[];
  activeRole: UserRole;
  sessionId: string;
}

export type RequestWithPrincipal = Request & { authPrincipal?: AuthenticatedPrincipal };

export interface SessionTokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  sessionExpiresAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: UserRole[];
}

export interface AuthSessionResponse {
  user: AuthUser;
  activeRole: UserRole;
  sessionId: string;
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  sessionExpiresAt: string;
}
