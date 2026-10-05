import { DomainError } from './errors';

export type AccountRole = 'farmer' | 'vet';

export interface SessionSnapshot {
  sessionId: string;
  userId: string;
  displayName: string;
  email: string;
  activeRole: AccountRole;
  roles: AccountRole[];
  expiresAt: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !emailPattern.test(normalized)) {
    throw new DomainError('VALIDATION_FAILED', 'Masukkan alamat email yang valid.');
  }
  return normalized;
}

export function validateAccountName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) {
    throw new DomainError('VALIDATION_FAILED', 'Nama harus berisi 2 sampai 80 karakter.');
  }
  return normalized;
}

export function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 128) {
    throw new DomainError('VALIDATION_FAILED', 'Kata sandi harus berisi 8 sampai 128 karakter.');
  }
}

export function accountRoles(value: unknown): AccountRole[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((role): role is AccountRole => role === 'farmer' || role === 'vet'))];
}
