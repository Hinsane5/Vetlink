import type { CatalogProductPage, CatalogReadQuery, CatalogReadRepository } from '../../application/ports/CatalogReadRepository';
import type { CatalogProduct } from '../../domain/catalog';
import { DomainError } from '../../domain/errors';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 512;

/** Read-only adapter for the BE-10 active product routes. */
export class HttpApiCatalogRepository implements CatalogReadRepository {
  constructor(private readonly api: ApiClient) {}

  async search(query: CatalogReadQuery = {}): Promise<CatalogProductPage> {
    const validated = validateQuery(query);
    const params = new URLSearchParams();
    if (validated.name) params.set('name', validated.name);
    if (validated.category) params.set('category', validated.category);
    if (validated.species) params.set('species', validated.species);
    if (validated.minPriceIdr !== undefined) params.set('minPrice', String(validated.minPriceIdr));
    if (validated.maxPriceIdr !== undefined) params.set('maxPrice', String(validated.maxPriceIdr));
    if (validated.cursor !== undefined) params.set('cursor', validated.cursor);
    if (validated.limit !== undefined) params.set('limit', String(validated.limit));

    const serialized = params.toString();
    const suffix = serialized ? `?${serialized}` : '';
    const value = await this.api.request<unknown>(`/v1/products${suffix}`);
    return parsePage(value);
  }

  async getById(productId: string): Promise<CatalogProduct> {
    if (!isUuid(productId)) throw invalidQuery('ID produk server harus UUID.');
    const value = await this.api.request<unknown>(`/v1/products/${encodeURIComponent(productId)}`);
    return parseProduct(value);
  }
}

function validateQuery(query: CatalogReadQuery): CatalogReadQuery {
  const name = optionalText(query.name, 120, 'Nama produk');
  const category = optionalText(query.category, 80, 'Kategori produk');
  if (query.species !== undefined && !isLivestockSpecies(query.species)) {
    throw invalidQuery('Jenis ternak katalog tidak valid.');
  }
  const minPriceIdr = optionalPrice(query.minPriceIdr, 'Harga minimum');
  const maxPriceIdr = optionalPrice(query.maxPriceIdr, 'Harga maksimum');
  if (minPriceIdr !== undefined && maxPriceIdr !== undefined && minPriceIdr > maxPriceIdr) {
    throw invalidQuery('Harga maksimum harus sama atau lebih besar daripada harga minimum.');
  }
  if (query.cursor !== undefined && (typeof query.cursor !== 'string'
    || query.cursor.length === 0 || query.cursor.length > MAX_CURSOR_LENGTH)) {
    throw invalidQuery('Cursor katalog tidak valid.');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)) {
    throw invalidQuery('Jumlah produk per halaman harus berupa bilangan bulat dari 1 sampai 100.');
  }

  return {
    ...(name ? { name } : {}),
    ...(category ? { category } : {}),
    ...(query.species !== undefined ? { species: query.species } : {}),
    ...(minPriceIdr !== undefined ? { minPriceIdr } : {}),
    ...(maxPriceIdr !== undefined ? { maxPriceIdr } : {}),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };
}

function optionalText(value: string | undefined, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidQuery(`${label} tidak valid.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalidQuery(`${label} terlalu panjang.`);
  return normalized || undefined;
}

function optionalPrice(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw invalidQuery(`${label} harus berupa rupiah integer yang tidak negatif.`);
  return value;
}

function parsePage(value: unknown): CatalogProductPage {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean'
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw invalidResponse('Halaman katalog tidak sesuai kontrak.');
  }
  if (value.hasMore) {
    if (value.items.length === 0 || typeof value.nextCursor !== 'string'
      || value.nextCursor.length === 0 || value.nextCursor.length > MAX_CURSOR_LENGTH) {
      throw invalidResponse('Cursor halaman katalog tidak valid.');
    }
  } else if (value.nextCursor !== null) {
    throw invalidResponse('Cursor katalog harus kosong pada halaman terakhir.');
  }

  return {
    items: value.items.map(parseProduct),
    nextCursor: value.nextCursor,
    hasMore: value.hasMore,
  };
}

function parseProduct(value: unknown): CatalogProduct {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isNonEmptyString(value.name, 160)
    || !isNonEmptyString(value.category, 80)
    || !Array.isArray(value.species) || !value.species.every(isLivestockSpecies)
    || typeof value.description !== 'string' || value.description.length > 5000
    || !Number.isSafeInteger(value.unitPriceIdr) || Number(value.unitPriceIdr) < 1
    || !(value.imageAttachmentId === null || isUuid(value.imageAttachmentId))
    || value.active !== true) {
    throw invalidResponse('Produk server tidak sesuai kontrak katalog aktif dan rupiah integer.');
  }
  return {
    id: value.id,
    name: value.name,
    category: value.category,
    species: value.species as LivestockSpecies[],
    description: value.description,
    unitPrice: Number(value.unitPriceIdr),
    currency: 'IDR',
  };
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidQuery(message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', message);
}

function invalidResponse(message: string): DomainError {
  return new DomainError('API_RESPONSE_INVALID', message);
}
