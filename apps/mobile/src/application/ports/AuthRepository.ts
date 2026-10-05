import type { AccountRole } from '../../domain/auth';
import type { DomainEntity, EntityRelation } from '../../domain/entities';

export interface AuthRepository {
  findUserByEmail(normalizedEmail: string): Promise<DomainEntity | null>;
  findUserById(userId: string): Promise<DomainEntity | null>;
  findRoleProfile(userId: string, role: AccountRole): Promise<DomainEntity | null>;
  createAccount(user: DomainEntity, profile: DomainEntity, relations: readonly EntityRelation[]): Promise<void>;
  createSession(session: DomainEntity, relation: EntityRelation): Promise<void>;
  findSession(sessionId: string): Promise<DomainEntity | null>;
  updateSession(session: DomainEntity, expectedVersion: number): Promise<void>;
}

export interface CredentialVerifierStore {
  save(userId: string, verifier: string): Promise<void>;
  read(userId: string): Promise<string | null>;
  remove(userId: string): Promise<void>;
}

export interface SessionMaterialStore {
  saveSessionId(sessionId: string): Promise<void>;
  readSessionId(): Promise<string | null>;
  clearSessionId(): Promise<void>;
}

export interface OnboardingStore {
  hasCompletedOnboarding(): Promise<boolean>;
  markOnboardingCompleted(): Promise<void>;
}

export interface PasswordVerifier {
  create(password: string): Promise<string>;
  verify(password: string, verifier: string): Promise<boolean>;
}

export interface IdFactory {
  create(): string;
}
