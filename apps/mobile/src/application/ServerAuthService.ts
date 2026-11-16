import { accountRoles, normalizeEmail, validateAccountName, validatePassword, type AccountRole, type SessionSnapshot } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ServerAuthRepository, ServerAuthResponse, ServerSessionStore, ServerTokenSet } from './ports/ServerAuthRepository';

export class ServerAuthService {
  constructor(private readonly repository: ServerAuthRepository, private readonly sessions: ServerSessionStore) {}

  async register(input: { name: string; email: string; password: string; role: AccountRole }): Promise<SessionSnapshot> {
    const name = validateAccountName(input.name);
    const email = normalizeEmail(input.email);
    validateServerPassword(input.password);
    const response = validateAuthResponse(await this.repository.register({
      email,
      fullName: name,
      password: input.password,
      role: input.role,
    }));
    await this.store(response);
    return snapshot(response);
  }

  async login(input: { email: string; password: string; role: AccountRole }): Promise<SessionSnapshot> {
    const email = normalizeEmail(input.email);
    validateServerPassword(input.password);
    const response = validateAuthResponse(await this.repository.login({ email, password: input.password, activeRole: input.role }));
    await this.store(response);
    return snapshot(response);
  }

  async restoreSession(): Promise<SessionSnapshot | null> {
    const stored = await this.readSession();
    if (!stored) return null;
    const current = await this.repository.me();
    if (!isMeResponse(current)
      || current.sessionId !== stored.sessionId
      || current.activeRole !== stored.activeRole
      || !accountRoles(current.roles).includes(current.activeRole)) {
      await this.clearSession();
      throw new DomainError('SESSION_INVALID', 'Sesi server tidak cocok dengan akun aktif. Masuk kembali.');
    }
    return {
      sessionId: current.sessionId,
      userId: current.id,
      displayName: current.fullName,
      email: current.email,
      activeRole: current.activeRole,
      roles: accountRoles(current.roles),
      expiresAt: stored.expiresAt,
    };
  }

  async switchRole(role: AccountRole): Promise<SessionSnapshot> {
    const stored = await this.readSession();
    if (!stored) throw new DomainError('SESSION_INVALID', 'Sesi server tidak tersedia. Masuk kembali untuk melanjutkan.');
    if (stored.activeRole === role) {
      const current = await this.restoreSession();
      if (!current) throw new DomainError('SESSION_INVALID', 'Sesi server tidak tersedia. Masuk kembali untuk melanjutkan.');
      return current;
    }
    const current = await this.restoreSession();
    if (!current?.roles.includes(role)) throw new DomainError('FORBIDDEN', 'Akun ini tidak memiliki membership untuk peran tersebut.');
    throw new DomainError('INVALID_STATE', 'API belum menyediakan pergantian peran pada sesi aktif. Masuk kembali melalui autentikasi server.');
  }

  async logout(): Promise<void> {
    const stored = await this.readSession();
    if (!stored) return;
    // Keep the secure refresh token if the server could not confirm revocation,
    // so the caller can retry instead of claiming that logout succeeded.
    await this.repository.logout(stored.refreshToken);
    await this.clearSession();
  }

  private async store(response: ServerAuthResponse): Promise<void> {
    try {
      await this.sessions.save(toTokenSet(response));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Sesi server tidak dapat disimpan dengan aman.');
    }
  }

  private async readSession(): Promise<ServerTokenSet | null> {
    try {
      return await this.sessions.read();
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Sesi aman di perangkat tidak dapat dibaca.');
    }
  }

  private async clearSession(): Promise<void> {
    try {
      await this.sessions.clear();
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Sesi server tidak dapat dihapus dari perangkat.');
    }
  }
}

function validateServerPassword(password: string): void {
  validatePassword(password);
  if (password.length < 12 || password.length > 256) {
    throw new DomainError('VALIDATION_FAILED', 'Kata sandi server harus berisi 12 sampai 256 karakter.');
  }
}

function validateAuthResponse(value: ServerAuthResponse): ServerAuthResponse {
  if (!value || value.tokenType !== 'Bearer'
    || typeof value.accessToken !== 'string' || value.accessToken.length < 40
    || typeof value.refreshToken !== 'string' || value.refreshToken.length < 40
    || typeof value.sessionId !== 'string'
    || typeof value.accessExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.accessExpiresAt))
    || typeof value.sessionExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.sessionExpiresAt))
    || !value.user || typeof value.user.id !== 'string'
    || typeof value.user.fullName !== 'string' || typeof value.user.email !== 'string') {
    throw new DomainError('API_RESPONSE_INVALID', 'Respons autentikasi server tidak sesuai kontrak.');
  }
  const roles = accountRoles(value.user.roles);
  if (!roles.length || !roles.includes(value.activeRole)) {
    throw new DomainError('API_RESPONSE_INVALID', 'Membership peran pada respons server tidak valid.');
  }
  return { ...value, user: { ...value.user, roles } };
}

function toTokenSet(response: ServerAuthResponse): ServerTokenSet {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    sessionId: response.sessionId,
    activeRole: response.activeRole,
    accessExpiresAt: response.accessExpiresAt,
    expiresAt: response.sessionExpiresAt,
  };
}

function snapshot(response: ServerAuthResponse): SessionSnapshot {
  return {
    sessionId: response.sessionId,
    userId: response.user.id,
    displayName: response.user.fullName,
    email: response.user.email,
    activeRole: response.activeRole,
    roles: response.user.roles,
    expiresAt: response.sessionExpiresAt,
  };
}

function isMeResponse(value: unknown): value is {
  id: string;
  email: string;
  fullName: string;
  roles: AccountRole[];
  activeRole: AccountRole;
  sessionId: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const me = value as Record<string, unknown>;
  return typeof me.id === 'string'
    && typeof me.email === 'string'
    && typeof me.fullName === 'string'
    && Array.isArray(me.roles)
    && (me.activeRole === 'farmer' || me.activeRole === 'vet')
    && typeof me.sessionId === 'string';
}
