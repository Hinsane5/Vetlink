import * as SecureStore from 'expo-secure-store';
import type { PendingServerBooking, PendingServerBookingStore } from '../../application/ServerBookingService';
import { DomainError } from '../../domain/errors';

/** Persists only the quote ID and idempotency key needed to retry an uncertain booking POST. */
export class ExpoPendingServerBookingStore implements PendingServerBookingStore {
  async read(userId: string): Promise<PendingServerBooking | null> {
    try {
      const raw = await SecureStore.getItemAsync(storageKey(userId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isPending(parsed)) throw new Error('invalid pending booking');
      return parsed;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Permintaan konsultasi tertunda tidak dapat dibaca dengan aman.');
    }
  }

  async write(userId: string, pending: PendingServerBooking): Promise<void> {
    try { await SecureStore.setItemAsync(storageKey(userId), JSON.stringify(pending)); }
    catch { throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry konsultasi tidak dapat disimpan dengan aman.'); }
  }

  async clear(userId: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(storageKey(userId)); }
    catch { throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry konsultasi belum dapat dibersihkan.'); }
  }
}

function storageKey(userId: string): string { return `vetlink.api.booking.v1:${userId}`; }

function isPending(value: unknown): value is PendingServerBooking {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pending = value as Record<string, unknown>;
  return typeof pending.quoteId === 'string' && /^[0-9a-f-]{36}$/i.test(pending.quoteId)
    && typeof pending.idempotencyKey === 'string'
    && pending.idempotencyKey === `consultation:${pending.quoteId}`;
}
