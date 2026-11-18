import * as SecureStore from 'expo-secure-store';
import type { ApiCareEventInput } from '../../application/ports/LivestockHealthRepository';
import type { PendingCareReportStore } from '../../application/ServerLivestockHealthService';
import { DomainError } from '../../domain/errors';

/** Keeps the exact BE-03 sourceKey and payload across an uncertain POST or app restart. */
export class ExpoPendingCareReportStore implements PendingCareReportStore {
  async read(userId: string, livestockId: string): Promise<ApiCareEventInput | null> {
    try {
      const raw = await SecureStore.getItemAsync(storageKey(userId, livestockId));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isInput(value)) throw new Error('invalid pending payload');
      return value;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Laporan tertunda tidak dapat dibaca dengan aman.');
    }
  }

  async write(userId: string, livestockId: string, input: ApiCareEventInput): Promise<void> {
    try {
      await SecureStore.setItemAsync(storageKey(userId, livestockId), JSON.stringify(input));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry laporan tidak dapat disimpan dengan aman.');
    }
  }

  async clear(userId: string, livestockId: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(storageKey(userId, livestockId));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry laporan belum dapat dibersihkan.');
    }
  }
}

function storageKey(userId: string, livestockId: string): string {
  return `vetlink.api.care.v1:${userId}:${livestockId}`;
}

function isInput(value: unknown): value is ApiCareEventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['disease', 'vaccine', 'medication', 'care'].includes(String(item.kind))
    && typeof item.occurredAt === 'string' && !Number.isNaN(Date.parse(item.occurredAt))
    && typeof item.description === 'string' && item.description.trim().length > 0 && item.description.length <= 2000
    && typeof item.sourceKey === 'string' && item.sourceKey.length >= 8 && item.sourceKey.length <= 128;
}
