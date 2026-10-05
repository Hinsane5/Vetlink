import type { AuthRepository, CredentialVerifierStore, IdFactory, PasswordVerifier, SessionMaterialStore } from './ports/AuthRepository';
import { accountRoles, normalizeEmail, validateAccountName, validatePassword, type AccountRole, type SessionSnapshot } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { DomainEntity, EntityRelation } from '../domain/entities';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class LocalAuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly credentials: CredentialVerifierStore,
    private readonly sessionMaterial: SessionMaterialStore,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: { name: string; email: string; password: string; role: AccountRole }): Promise<SessionSnapshot> {
    const name = validateAccountName(input.name);
    const email = normalizeEmail(input.email);
    validatePassword(input.password);

    if (await this.repository.findUserByEmail(email)) {
      throw new DomainError('EMAIL_IN_USE', 'Email ini sudah terdaftar. Masuk dengan akun tersebut atau gunakan email lain.');
    }

    const userId = this.ids.create();
    const profileId = this.ids.create();
    const timestamp = this.now().toISOString();
    const user = makeEntity('user', userId, null, {
      name,
      email,
      roles: [input.role],
      status: 'active',
      accountOrigin: 'local',
    }, timestamp);
    const profile = input.role === 'farmer'
      ? makeEntity('farmerProfile', profileId, userId, {
          userId,
          photoAttachmentId: null,
          farmId: null,
        }, timestamp)
      : makeEntity('vetProfile', profileId, userId, {
          userId,
          professionalName: name,
          verificationStatus: 'not_submitted',
          services: [],
        }, timestamp);
    const relations: EntityRelation[] = [{ sourceId: profileId, relationship: 'user', targetId: userId }];
    const verifier = await this.passwordVerifier.create(input.password);

    await this.credentials.save(userId, verifier);
    try {
      await this.repository.createAccount(user, profile, relations);
    } catch (error) {
      await this.credentials.remove(userId);
      throw error;
    }

    return this.startSession(user, input.role);
  }

  async login(input: { email: string; password: string; role: AccountRole }): Promise<SessionSnapshot> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.findUserByEmail(email);
    const storedVerifier = user ? await this.credentials.read(user.id) : null;
    const passwordMatches = storedVerifier ? await this.passwordVerifier.verify(input.password, storedVerifier) : false;
    if (!user || !passwordMatches || user.payload.status !== 'active') {
      throw new DomainError('INVALID_CREDENTIALS', 'Email atau kata sandi tidak cocok.');
    }

    const roles = accountRoles(user.payload.roles);
    if (!roles.includes(input.role) || !(await this.repository.findRoleProfile(user.id, input.role))) {
      throw new DomainError('ROLE_NOT_ALLOWED', 'Akun ini belum memiliki akses untuk peran tersebut. Masuk atau daftar dengan akun lain.');
    }

    return this.startSession(user, input.role);
  }

  async restoreSession(): Promise<SessionSnapshot | null> {
    const sessionId = await this.sessionMaterial.readSessionId();
    if (!sessionId) return null;
    const session = await this.repository.findSession(sessionId);
    const userId = session?.payload.userId;
    const activeRole = session?.payload.activeRole;
    const expiresAt = session?.payload.expiresAt;
    const isActive = session?.payload.status === 'active' && typeof expiresAt === 'string' && Date.parse(expiresAt) > this.now().getTime();
    const user = isActive && typeof userId === 'string' ? await this.repository.findUserById(userId) : null;
    const roles = user ? accountRoles(user.payload.roles) : [];
    if (
      !session ||
      !user ||
      user.payload.status !== 'active' ||
      (activeRole !== 'farmer' && activeRole !== 'vet') ||
      !roles.includes(activeRole) ||
      !(await this.repository.findRoleProfile(user.id, activeRole))
    ) {
      await this.sessionMaterial.clearSessionId();
      if (session?.payload.status === 'active') await this.revoke(session);
      return null;
    }

    return snapshot(session, user, roles, activeRole);
  }

  async switchRole(role: AccountRole): Promise<SessionSnapshot> {
    const sessionId = await this.sessionMaterial.readSessionId();
    const session = sessionId ? await this.repository.findSession(sessionId) : null;
    if (!session || session.payload.status !== 'active') {
      throw new DomainError('SESSION_INVALID', 'Sesi sudah berakhir. Silakan masuk kembali.');
    }
    const userId = typeof session.payload.userId === 'string' ? session.payload.userId : '';
    const user = await this.repository.findUserById(userId);
    const roles = user ? accountRoles(user.payload.roles) : [];
    if (!user || !roles.includes(role) || !(await this.repository.findRoleProfile(user.id, role))) {
      throw new DomainError('ROLE_NOT_ALLOWED', 'Akun ini belum memiliki akses untuk peran tersebut.');
    }

    const updated = withSessionPayload(session, {
      ...session.payload,
      activeRole: role,
      expiresAt: typeof session.payload.expiresAt === 'string'
        ? session.payload.expiresAt
        : new Date(this.now().getTime() + SESSION_MAX_AGE_MS).toISOString(),
    }, this.now().toISOString());
    await this.repository.updateSession(updated, session.version);
    return snapshot(updated, user, roles, role);
  }

  async resetPassword(input: { email: string; role: AccountRole; newPassword: string }): Promise<boolean> {
    const email = normalizeEmail(input.email);
    validatePassword(input.newPassword);
    const user = await this.repository.findUserByEmail(email);
    if (!user || !accountRoles(user.payload.roles).includes(input.role)) return false;

    // Fixture accounts intentionally have no local verifier and cannot be claimed via this local reset flow.
    if (!(await this.credentials.read(user.id))) return false;
    await this.credentials.save(user.id, await this.passwordVerifier.create(input.newPassword));
    return true;
  }

  async logout(): Promise<void> {
    const sessionId = await this.sessionMaterial.readSessionId();
    await this.sessionMaterial.clearSessionId();
    if (!sessionId) return;
    const session = await this.repository.findSession(sessionId);
    if (session?.payload.status === 'active') await this.revoke(session);
  }

  private async startSession(user: DomainEntity, role: AccountRole): Promise<SessionSnapshot> {
    const roles = accountRoles(user.payload.roles);
    if (!roles.includes(role) || !(await this.repository.findRoleProfile(user.id, role))) {
      throw new DomainError('ROLE_NOT_ALLOWED', 'Akun ini belum memiliki akses untuk peran tersebut.');
    }
    const previousSessionId = await this.sessionMaterial.readSessionId();
    const timestamp = this.now().toISOString();
    const sessionId = this.ids.create();
    const session = makeEntity('session', sessionId, user.id, {
      userId: user.id,
      activeRole: role,
      status: 'active',
      createdAt: timestamp,
      expiresAt: new Date(this.now().getTime() + SESSION_MAX_AGE_MS).toISOString(),
      revokedAt: null,
    }, timestamp);
    await this.repository.createSession(session, { sourceId: sessionId, relationship: 'user', targetId: user.id });
    try {
      await this.sessionMaterial.saveSessionId(sessionId);
    } catch {
      await this.revoke(session);
      throw new DomainError('SESSION_STORAGE_FAILED', 'Sesi tidak dapat disimpan dengan aman. Silakan coba lagi.');
    }
    if (previousSessionId && previousSessionId !== sessionId) {
      const previous = await this.repository.findSession(previousSessionId);
      if (previous?.payload.status === 'active') await this.revoke(previous);
    }
    return snapshot(session, user, roles, role);
  }

  private async revoke(session: DomainEntity): Promise<void> {
    const updated = withSessionPayload(session, {
      ...session.payload,
      status: 'revoked',
      revokedAt: this.now().toISOString(),
    }, this.now().toISOString());
    await this.repository.updateSession(updated, session.version);
  }
}

function makeEntity(
  kind: DomainEntity['kind'],
  id: string,
  ownerId: string | null,
  payload: Record<string, unknown>,
  timestamp: string,
): DomainEntity {
  return { id, kind, ownerId, contextId: null, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
}

function withSessionPayload(session: DomainEntity, payload: Record<string, unknown>, timestamp: string): DomainEntity {
  return { ...session, payload, updatedAt: timestamp, version: session.version + 1 };
}

function snapshot(session: DomainEntity, user: DomainEntity, roles: AccountRole[], activeRole: AccountRole): SessionSnapshot {
  return {
    sessionId: session.id,
    userId: user.id,
    displayName: String(user.payload.name ?? ''),
    email: String(user.payload.email ?? ''),
    activeRole,
    roles,
    expiresAt: String(session.payload.expiresAt ?? ''),
  };
}
