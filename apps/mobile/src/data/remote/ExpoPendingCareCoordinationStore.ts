import * as SecureStore from 'expo-secure-store';
import type { PendingCareCoordinationOperation, PendingCareCoordinationStore } from '../../application/ServerCareCoordinationService';
import { DomainError } from '../../domain/errors';

/** Stores the exact BE-09 request before sending, so an uncertain retry survives app restarts. */
export class ExpoPendingCareCoordinationStore implements PendingCareCoordinationStore {
  private readonly namespace: string;

  constructor(apiBaseUrl: string) {
    this.namespace = namespaceKey(apiBaseUrl);
  }

  async read(userId: string, consultationId: string): Promise<PendingCareCoordinationOperation | null> {
    try {
      const raw = await SecureStore.getItemAsync(storageKey(this.namespace, userId, consultationId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isOperation(value)) throw new Error('invalid pending care operation');
      return value;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Operasi tindak lanjut tertunda tidak dapat dibaca dengan aman.');
    }
  }

  async write(userId: string, consultationId: string, operation: PendingCareCoordinationOperation): Promise<void> {
    try {
      const key = storageKey(this.namespace, userId, consultationId);
      const raw = await SecureStore.getItemAsync(key);
      if (raw) {
        const current: unknown = JSON.parse(raw);
        if (!isOperation(current)) throw new Error('invalid pending care operation');
        if (JSON.stringify(current) !== JSON.stringify(operation)) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Selesaikan operasi tindak lanjut tertunda sebelum membuat perubahan lain.');
        }
        return;
      }
      if (!isOperation(operation)) throw new DomainError('VALIDATION_FAILED', 'Operasi tindak lanjut tidak valid.');
      await SecureStore.setItemAsync(key, JSON.stringify(operation));
    } catch (cause) {
      if (cause instanceof DomainError && cause.code === 'IDEMPOTENCY_CONFLICT') throw cause;
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry tindak lanjut tidak dapat disimpan dengan aman.');
    }
  }

  async clear(userId: string, consultationId: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(storageKey(this.namespace, userId, consultationId));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry tindak lanjut belum dapat dibersihkan.');
    }
  }
}

function storageKey(namespace: string, userId: string, consultationId: string): string {
  return `vetlink.api.carecoord.v1:${namespace}:${userId}:${consultationId}`;
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

function isOperation(value: unknown): value is PendingCareCoordinationOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(item.idempotencyKey)) return false;
  if (item.type === 'follow_up') return hasKeys(item, ['type', 'idempotencyKey', 'startsAt', 'endsAt', 'reason']) && isIso(item.startsAt) && isIso(item.endsAt) && isText(item.reason, 3, 1000);
  if (item.type === 'reminder') return hasKeys(item, ['type', 'idempotencyKey', 'followUpId', 'kind', 'dueAt', 'instructions']) && (item.followUpId === null || isUuid(item.followUpId))
    && (item.kind === 'care' || item.kind === 'follow_up') && isIso(item.dueAt) && isText(item.instructions, 3, 500);
  if (item.type === 'progress_report') {
    const base = hasKeys(item, ['type', 'idempotencyKey', 'followUpId', 'text']);
    const withAttachments = hasKeys(item, ['type', 'idempotencyKey', 'followUpId', 'text', 'attachments']);
    return (base || withAttachments) && isUuid(item.followUpId) && isText(item.text, 3, 2000)
      && (item.attachments === undefined || (Array.isArray(item.attachments) && item.attachments.length <= 5
        && item.attachments.every(isPendingReportAttachment)
        && new Set(item.attachments.map((attachment) => attachment.idempotencyKey)).size === item.attachments.length
        && !item.attachments.some((attachment) => attachment.idempotencyKey === item.idempotencyKey)));
  }
  if (item.type === 'care_completion') return hasKeys(item, ['type', 'idempotencyKey', 'reminderId']) && isUuid(item.reminderId);
  return false;
}

function isPendingReportAttachment(value: unknown): value is { file: { uri: string; filename: string; mimeType: string; byteSize: number }; idempotencyKey: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join('|') !== 'file|idempotencyKey' || typeof item.idempotencyKey !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(item.idempotencyKey)
    || !item.file || typeof item.file !== 'object' || Array.isArray(item.file)) return false;
  const file = item.file as Record<string, unknown>;
  if (Object.keys(file).sort().join('|') !== 'byteSize|filename|mimeType|uri'
    || typeof file.uri !== 'string' || !/^(file|content):\/\//.test(file.uri)
    || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 255
    || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.mimeType as string)
    || !Number.isSafeInteger(file.byteSize) || Number(file.byteSize) < 1) return false;
  const maximum = file.mimeType === 'video/mp4' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  return Number(file.byteSize) <= maximum;
}

function hasKeys(item: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(item).sort().join('|') === [...expected].sort().join('|');
}
function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}
function isIso(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
