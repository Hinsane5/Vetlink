import * as SecureStore from 'expo-secure-store';
import type { PendingServerChatMessage, ServerChatStateStore } from '../../application/ServerChatService';
import { DomainError } from '../../domain/errors';

/** Stores unsent draft text and the exact stable message payload for an uncertain POST. */
export class ExpoServerChatStateStore implements ServerChatStateStore {
  async readPending(userId: string, consultationId: string): Promise<PendingServerChatMessage | null> {
    try {
      const raw = await SecureStore.getItemAsync(pendingKey(userId, consultationId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isPending(value)) throw new Error('invalid pending message');
      return value;
    } catch { throw storageError('Pesan tertunda tidak dapat dibaca dengan aman.'); }
  }

  async writePending(userId: string, consultationId: string, value: PendingServerChatMessage): Promise<void> {
    if (!isPending(value)) throw new DomainError('VALIDATION_FAILED', 'Payload pesan tertunda tidak valid.');
    try { await SecureStore.setItemAsync(pendingKey(userId, consultationId), JSON.stringify(value)); }
    catch { throw storageError('Kunci retry pesan tidak dapat disimpan dengan aman.'); }
  }

  async clearPending(userId: string, consultationId: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(pendingKey(userId, consultationId)); }
    catch { throw storageError('Kunci retry pesan belum dapat dibersihkan.'); }
  }

  async readDraft(userId: string, consultationId: string): Promise<string | null> {
    try { return await SecureStore.getItemAsync(draftKey(userId, consultationId)); }
    catch { throw storageError('Draft pesan tidak dapat dibaca dengan aman.'); }
  }

  async writeDraft(userId: string, consultationId: string, value: string): Promise<void> {
    try { await SecureStore.setItemAsync(draftKey(userId, consultationId), value); }
    catch { throw storageError('Draft pesan belum dapat disimpan dengan aman.'); }
  }

  async clearDraft(userId: string, consultationId: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(draftKey(userId, consultationId)); }
    catch { throw storageError('Draft pesan belum dapat dibersihkan.'); }
  }
}

function pendingKey(userId: string, consultationId: string): string { return `vetlink.api.chat.pending.v1:${userId}:${consultationId}`; }
function draftKey(userId: string, consultationId: string): string { return `vetlink.api.chat.draft.v1:${userId}:${consultationId}`; }
function storageError(message: string): DomainError { return new DomainError('SESSION_STORAGE_FAILED', message); }
function isPending(value: unknown): value is PendingServerChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.clientMessageId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.clientMessageId)
    && typeof item.text === 'string' && item.text.trim().length > 0 && item.text.length <= 4000;
}
