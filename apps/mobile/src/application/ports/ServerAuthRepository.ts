import type { AccountRole } from '../../domain/auth';

export interface ServerTokenSet {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  activeRole: AccountRole;
  accessExpiresAt: string;
  expiresAt: string;
}

export interface ServerAuthResponse {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  activeRole: AccountRole;
  accessExpiresAt: string;
  sessionExpiresAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: AccountRole[];
  };
}

export interface ServerMeResponse {
  id: string;
  email: string;
  fullName: string;
  roles: AccountRole[];
  activeRole: AccountRole;
  sessionId: string;
}

/** Server credentials and session metadata are stored only by a secure device store. */
export interface ServerSessionStore {
  read(): Promise<ServerTokenSet | null>;
  save(session: ServerTokenSet): Promise<void>;
  clear(): Promise<void>;
}

/** Auth operations are owned by BE-01. No local fixture or verifier is used here. */
export interface ServerAuthRepository {
  register(input: { email: string; fullName: string; password: string; role: AccountRole }): Promise<ServerAuthResponse>;
  login(input: { email: string; password: string; activeRole: AccountRole }): Promise<ServerAuthResponse>;
  switchActiveRole(activeRole: AccountRole): Promise<ServerAuthResponse>;
  me(): Promise<ServerMeResponse>;
  logout(refreshToken: string): Promise<void>;
}
