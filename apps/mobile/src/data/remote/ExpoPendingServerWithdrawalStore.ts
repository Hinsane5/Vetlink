import * as SecureStore from 'expo-secure-store';
import type { PendingServerWithdrawal, PendingServerWithdrawalStore } from '../../application/ServerEarningsService';
import { DomainError } from '../../domain/errors';

/** Keeps the exact BE-15 request until the server returns a persisted result. */
export class ExpoPendingServerWithdrawalStore implements PendingServerWithdrawalStore {
  private readonly namespace: string;

  constructor(apiBaseUrl: string) {
    this.namespace = namespaceKey(apiBaseUrl);
  }

  async read(userId: string): Promise<PendingServerWithdrawal | null> {
    try {
      const raw = await SecureStore.getItemAsync(storageKey(this.namespace, userId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isOperation(value)) throw new Error('invalid pending withdrawal');
      return value;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Pengajuan pencairan tertunda tidak dapat dibaca dengan aman.');
    }
  }

  async write(userId: string, operation: PendingServerWithdrawal): Promise<void> {
    try {
      if (!isOperation(operation)) throw new DomainError('VALIDATION_FAILED', 'Operasi pencairan tidak valid.');
      const key = storageKey(this.namespace, userId);
      const raw = await SecureStore.getItemAsync(key);
      if (raw) {
        const existing: unknown = JSON.parse(raw);
        if (!isOperation(existing)) throw new Error('invalid pending withdrawal');
        if (JSON.stringify(existing) !== JSON.stringify(operation)) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Selesaikan pengajuan pencairan tertunda sebelum mengirim pengajuan lain.');
        }
        return;
      }
      await SecureStore.setItemAsync(key, JSON.stringify(operation));
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pencairan tidak dapat disimpan dengan aman.');
    }
  }

  async clear(userId: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(storageKey(this.namespace, userId));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pencairan belum dapat dibersihkan.');
    }
  }
}

function storageKey(namespace: string, userId: string): string {
  return `vetlink.api.earnings.v1:${namespace}:${userId}`;
}

function namespaceKey(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.trim().replace(/\/+$/, '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isOperation(value: unknown): value is PendingServerWithdrawal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join('|') === ['amount', 'destinationId', 'idempotencyKey'].sort().join('|')
    && typeof item.idempotencyKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(item.idempotencyKey)
    && Number.isSafeInteger(item.amount) && Number(item.amount) > 0
    && typeof item.destinationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.destinationId);
}
