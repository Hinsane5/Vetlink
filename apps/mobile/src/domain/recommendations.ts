import type { DomainEntity } from './entities';
import { DomainError } from './errors';

export type RecommendationItemInput = {
  id?: string | null;
  productId: string | null;
  titleSnapshot: string;
  instructions: string;
  note: string;
};

export type RecommendationItemSnapshot = RecommendationItemInput & {
  id: string;
  record: DomainEntity;
  productName: string | null;
  productUnitPrice: number | null;
  position: number;
};

export type RecommendationSnapshot = {
  record: DomainEntity;
  status: 'draft' | 'sent';
  sentAt: string | null;
  items: RecommendationItemSnapshot[];
};

export type RecommendationProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  unitPrice: number;
};

export function normalizeRecommendationItems(input: readonly RecommendationItemInput[]): RecommendationItemInput[] {
  if (!Array.isArray(input) || input.length > 10) {
    throw new DomainError('VALIDATION_FAILED', 'Rekomendasi dapat memuat maksimal 10 item.');
  }
  const seen = new Set<string>();
  const normalized: RecommendationItemInput[] = [];
  for (const item of input) {
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
    if (id && seen.has(id)) throw new DomainError('VALIDATION_FAILED', 'Item rekomendasi tidak boleh tercantum lebih dari sekali.');
    if (id) seen.add(id);
    const productId = typeof item.productId === 'string' && item.productId.trim() ? item.productId.trim() : null;
    const titleSnapshot = typeof item.titleSnapshot === 'string' ? item.titleSnapshot.trim() : '';
    const instructions = typeof item.instructions === 'string' ? item.instructions.trim() : '';
    const note = typeof item.note === 'string' ? item.note.trim() : '';
    if (titleSnapshot.length > 120) throw new DomainError('VALIDATION_FAILED', 'Nama rekomendasi maksimal 120 karakter.');
    if (instructions.length > 2000) throw new DomainError('VALIDATION_FAILED', 'Instruksi maksimal 2.000 karakter.');
    if (note.length > 1000) throw new DomainError('VALIDATION_FAILED', 'Catatan tambahan maksimal 1.000 karakter.');
    if (!productId && !titleSnapshot && !instructions && !note) continue;
    normalized.push({ id, productId, titleSnapshot, instructions, note });
  }
  return normalized;
}

export function assertRecommendationSendable(items: readonly RecommendationItemInput[]): void {
  if (!items.length) throw new DomainError('VALIDATION_FAILED', 'Tambahkan minimal satu item sebelum mengirim rekomendasi.');
  for (const item of items) {
    if (!item.titleSnapshot.trim()) throw new DomainError('VALIDATION_FAILED', 'Nama setiap rekomendasi wajib diisi.');
    if (!item.instructions.trim()) throw new DomainError('VALIDATION_FAILED', 'Instruksi setiap rekomendasi wajib diisi.');
  }
}
