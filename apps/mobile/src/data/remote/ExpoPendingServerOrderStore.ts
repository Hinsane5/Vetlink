import * as SecureStore from 'expo-secure-store';
import type { PendingServerOrder, PendingServerOrderStore } from '../../application/ServerCommerceService';
import { DomainError } from '../../domain/errors';

/** Keeps the quote ID and idempotency key for uncertain BE-11 order writes. */
export class ExpoPendingServerOrderStore implements PendingServerOrderStore {
  private readonly namespace: string;

  constructor(apiBaseUrl: string) {
    this.namespace = namespaceKey(apiBaseUrl);
  }

  async read(userId: string): Promise<PendingServerOrder | null> {
    try {
      const raw = await SecureStore.getItemAsync(storageKey(this.namespace, userId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isOperation(value)) throw new Error('invalid pending order');
      return value;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Pesanan tertunda tidak dapat dibaca dengan aman.');
    }
  }

  async write(userId: string, operation: PendingServerOrder): Promise<void> {
    try {
      if (!isOperation(operation)) throw new DomainError('VALIDATION_FAILED', 'Operasi pesanan tidak valid.');
      const key = storageKey(this.namespace, userId);
      const raw = await SecureStore.getItemAsync(key);
      if (raw) {
        const existing: unknown = JSON.parse(raw);
        if (!isOperation(existing)) throw new Error('invalid pending order');
        if (JSON.stringify(existing) !== JSON.stringify(operation)) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Pulihkan pesanan tertunda sebelum mengirim pesanan lain.');
        }
        return;
      }
      await SecureStore.setItemAsync(key, JSON.stringify(operation));
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pesanan tidak dapat disimpan dengan aman.');
    }
  }

  async clear(userId: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(storageKey(this.namespace, userId));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pesanan belum dapat dibersihkan.');
    }
  }
}

function storageKey(namespace: string, userId: string): string {
  return `vetlink.api.orders.v1:${namespace}:${userId}`;
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

function isOperation(value: unknown): value is PendingServerOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join('|') === ['idempotencyKey', 'quoteId'].join('|')
    && typeof item.quoteId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.quoteId)
    && item.idempotencyKey === `order:${item.quoteId}`;
}
