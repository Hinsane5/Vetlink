import type { ApiLivestockRecord, LivestockReadPage, LivestockReadQuery, LivestockReadRepository } from '../../application/ports/LivestockReadRepository';
import { livestockSexes, type LivestockSex } from '../../domain/livestock';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isCalendarDate, isDecimalString, isNonEmptyText, isRecord, isUtcTimestamp, isUuid, parseReadPage, validateOpaqueCursor, validatePageLimit } from './apiReadValidation';

const WEIGHT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_WEIGHT_KG = 999999.99;

/** Read-only adapter; ownership and patient assignment are enforced by the API session. */
export class HttpApiLivestockReadRepository implements LivestockReadRepository {
  constructor(private readonly api: ApiClient) {}

  async listPage(query: LivestockReadQuery = {}): Promise<LivestockReadPage> {
    validateOpaqueCursor(query.cursor, 'ternak');
    validatePageLimit(query.limit, 'ternak');
    const params = new URLSearchParams();
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const serialized = params.toString();
    const value = await this.api.request<unknown>(`/v1/livestock/page${serialized ? `?${serialized}` : ''}`);
    return parseReadPage(value, parseApiLivestockRecord, 'ternak');
  }

  async getById(livestockId: string): Promise<ApiLivestockRecord> {
    if (!isUuid(livestockId)) throw invalidQuery('ID ternak server harus UUID.');
    return parseApiLivestockRecord(await this.api.request<unknown>(`/v1/livestock/${encodeURIComponent(livestockId)}`));
  }
}

export function parseApiLivestockRecord(value: unknown): ApiLivestockRecord {
  if (!isRecord(value)
    || !isUuid(value.id) || !isUuid(value.farmerId) || !isUuid(value.farmId)
    || !isNonEmptyText(value.displayCode, 32)
    || !isNonEmptyText(value.name, 120)
    || !isLivestockSpecies(value.species)
    || !(value.breed === null || isNonEmptyText(value.breed, 80))
    || !isLivestockSex(value.sex)
    || !(value.birthDate === null || isCalendarDate(value.birthDate))
    || !(value.estimatedAgeMonths === null || (Number.isSafeInteger(value.estimatedAgeMonths) && Number(value.estimatedAgeMonths) >= 0 && Number(value.estimatedAgeMonths) <= 1200))
    || !(value.weightKg === null || isWeightDecimal(value.weightKg))
    || !isUtcTimestamp(value.createdAt) || !isUtcTimestamp(value.updatedAt)
    || !isVersion(value.version)) {
    throw invalidResponse('Data ternak server tidak sesuai DTO BE-16.');
  }
  return {
    id: value.id,
    farmerId: value.farmerId,
    farmId: value.farmId,
    displayCode: value.displayCode,
    name: value.name,
    species: value.species,
    breed: value.breed as string | null,
    sex: value.sex as LivestockSex,
    birthDate: value.birthDate as string | null,
    estimatedAgeMonths: value.estimatedAgeMonths as number | null,
    weightKg: value.weightKg as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

function isWeightDecimal(value: unknown): value is string {
  return isDecimalString(value, WEIGHT_PATTERN) && Number(value) <= MAX_WEIGHT_KG;
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function isLivestockSex(value: unknown): value is LivestockSex {
  return typeof value === 'string' && (livestockSexes as readonly string[]).includes(value);
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
