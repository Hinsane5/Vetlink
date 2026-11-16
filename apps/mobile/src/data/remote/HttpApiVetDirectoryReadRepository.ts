import type { ApiDirectoryWeekdayRule, ApiVetDirectoryDetail, ApiVetDirectoryRecord, ApiVetSlot, VetDirectoryPage, VetDirectoryQuery, VetDirectoryReadRepository, VetSlotsQuery } from '../../application/ports/VetDirectoryReadRepository';
import type { DirectoryServiceType } from '../../domain/directory';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isCalendarDate, isNonEmptyText, isRecord, isUtcTimestamp, isUuid, parseReadPage, validateOpaqueCursor, validatePageLimit } from './apiReadValidation';

const SERVICE_TYPES: readonly DirectoryServiceType[] = ['chat', 'visit'];

/** Read-only adapter for BE-04 verified discovery, detail and available slots. */
export class HttpApiVetDirectoryReadRepository implements VetDirectoryReadRepository {
  constructor(private readonly api: ApiClient) {}

  async search(query: VetDirectoryQuery = {}): Promise<VetDirectoryPage> {
    const validated = validateDirectoryQuery(query);
    const params = new URLSearchParams();
    if (validated.name) params.set('name', validated.name);
    if (validated.species) params.set('species', validated.species);
    if (validated.service) params.set('service', validated.service);
    if (validated.location) params.set('location', validated.location);
    if (validated.available !== undefined) params.set('available', String(validated.available));
    if (validated.minFeeIdr !== undefined) params.set('minFee', String(validated.minFeeIdr));
    if (validated.maxFeeIdr !== undefined) params.set('maxFee', String(validated.maxFeeIdr));
    if (validated.cursor !== undefined) params.set('cursor', validated.cursor);
    if (validated.limit !== undefined) params.set('limit', String(validated.limit));
    const serialized = params.toString();
    const value = await this.api.request<unknown>(`/v1/vets/page${serialized ? `?${serialized}` : ''}`);
    return parseReadPage(value, parseVetSummary, 'direktori dokter');
  }

  async getById(vetId: string): Promise<ApiVetDirectoryDetail> {
    if (!isUuid(vetId)) throw invalidQuery('ID dokter server harus UUID.');
    return parseVetDetail(await this.api.request<unknown>(`/v1/vets/${encodeURIComponent(vetId)}`));
  }

  async getSlots(vetId: string, query: VetSlotsQuery): Promise<ApiVetSlot[]> {
    if (!isUuid(vetId)) throw invalidQuery('ID dokter server harus UUID.');
    validateSlotsQuery(query);
    const params = new URLSearchParams({ dateFrom: query.dateFrom, dateTo: query.dateTo, service: query.service });
    const value = await this.api.request<unknown>(`/v1/vets/${encodeURIComponent(vetId)}/slots?${params.toString()}`);
    if (!Array.isArray(value)) throw invalidResponse('Daftar slot server tidak sesuai kontrak.');
    return value.map(parseSlot);
  }
}

function validateDirectoryQuery(query: VetDirectoryQuery): VetDirectoryQuery {
  const name = optionalText(query.name, 120, 'Nama dokter');
  const location = optionalText(query.location, 120, 'Lokasi dokter');
  if (query.species !== undefined && !isLivestockSpecies(query.species)) throw invalidQuery('Jenis ternak direktori tidak valid.');
  if (query.service !== undefined && !isService(query.service)) throw invalidQuery('Jenis layanan direktori tidak valid.');
  if (query.available !== undefined && typeof query.available !== 'boolean') throw invalidQuery('Filter ketersediaan dokter tidak valid.');
  const minFeeIdr = optionalFee(query.minFeeIdr, 'Tarif minimum');
  const maxFeeIdr = optionalFee(query.maxFeeIdr, 'Tarif maksimum');
  if (minFeeIdr !== undefined && maxFeeIdr !== undefined && minFeeIdr > maxFeeIdr) {
    throw invalidQuery('Tarif maksimum harus sama atau lebih besar daripada tarif minimum.');
  }
  validateOpaqueCursor(query.cursor, 'dokter');
  validatePageLimit(query.limit, 'dokter');
  return {
    ...(name ? { name } : {}),
    ...(query.species !== undefined ? { species: query.species } : {}),
    ...(query.service !== undefined ? { service: query.service } : {}),
    ...(location ? { location } : {}),
    ...(query.available !== undefined ? { available: query.available } : {}),
    ...(minFeeIdr !== undefined ? { minFeeIdr } : {}),
    ...(maxFeeIdr !== undefined ? { maxFeeIdr } : {}),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  };
}

function validateSlotsQuery(query: VetSlotsQuery): void {
  if (!query || !isService(query.service) || !isCalendarDate(query.dateFrom) || !isCalendarDate(query.dateTo)) {
    throw invalidQuery('Rentang tanggal dan layanan untuk slot tidak valid.');
  }
  const start = Date.parse(`${query.dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${query.dateTo}T00:00:00.000Z`);
  if (end < start || end - start > 31 * 86_400_000) {
    throw invalidQuery('Rentang slot harus berurutan dan maksimal 32 hari.');
  }
}

function parseVetSummary(value: unknown): ApiVetDirectoryRecord {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isNonEmptyText(value.professionalName, 120)
    || !isExperience(value.experienceYears)
    || !isTextArray(value.specialties)
    || !isSpeciesArray(value.species)
    || !isNonEmptyText(value.practiceLocation, 500)
    || !isTextArray(value.serviceAreas)
    || typeof value.acceptingNewRequests !== 'boolean'
    || !isServiceArray(value.services)
    || value.services.length === 0
    || !isNonEmptyText(value.timezone, 80)
    || !Array.isArray(value.weekdayRules)
    || !value.weekdayRules.every(isWeekdayRule)
    || !isFeeMap(value.fees)
    || !feesCoverServices(value.services, value.fees)
    || !isSafeIdr(value.minFeeIdr) || !isSafeIdr(value.maxFeeIdr)
    || value.minFeeIdr > value.maxFeeIdr
    || !feeBoundsMatch(value.fees, value.minFeeIdr, value.maxFeeIdr)
    || !isRating(value.ratingAverage)
    || !isCount(value.ratingCount)) {
    throw invalidResponse('Data direktori dokter server tidak sesuai DTO verified BE-16.');
  }
  return {
    id: value.id,
    professionalName: value.professionalName,
    experienceYears: value.experienceYears,
    specialties: value.specialties as string[],
    species: value.species as LivestockSpecies[],
    practiceLocation: value.practiceLocation,
    serviceAreas: value.serviceAreas as string[],
    acceptingNewRequests: value.acceptingNewRequests,
    services: value.services as DirectoryServiceType[],
    timezone: value.timezone,
    weekdayRules: value.weekdayRules as ApiDirectoryWeekdayRule[],
    fees: value.fees as Partial<Record<DirectoryServiceType, number>>,
    minFeeIdr: value.minFeeIdr,
    maxFeeIdr: value.maxFeeIdr,
    ratingAverage: value.ratingAverage,
    ratingCount: value.ratingCount,
  };
}

function parseVetDetail(value: unknown): ApiVetDirectoryDetail {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isNonEmptyText(value.professionalName, 120)
    || !isExperience(value.experienceYears)
    || !isTextArray(value.specialties)
    || !isSpeciesArray(value.species)
    || !isNonEmptyText(value.practiceLocation, 500)
    || !isTextArray(value.serviceAreas)
    || typeof value.acceptingNewRequests !== 'boolean'
    || !isServiceArray(value.services) || value.services.length === 0
    || !isNonEmptyText(value.timezone, 80)
    || !Array.isArray(value.weekdayRules) || !value.weekdayRules.every(isWeekdayRule)
    || !isDuration(value.chatDurationMinutes) || !isDuration(value.visitDurationMinutes)
    || !isRating(value.ratingAverage) || !isCount(value.ratingCount)
    || !isFeeMap(value.rates) || !feesCoverServices(value.services, value.rates)) {
    throw invalidResponse('Detail dokter server tidak sesuai DTO verified BE-16.');
  }
  return {
    id: value.id,
    professionalName: value.professionalName,
    experienceYears: value.experienceYears,
    specialties: value.specialties as string[],
    species: value.species as LivestockSpecies[],
    practiceLocation: value.practiceLocation,
    serviceAreas: value.serviceAreas as string[],
    acceptingNewRequests: value.acceptingNewRequests,
    services: value.services as DirectoryServiceType[],
    timezone: value.timezone,
    weekdayRules: value.weekdayRules as ApiDirectoryWeekdayRule[],
    ratingAverage: value.ratingAverage,
    ratingCount: value.ratingCount,
    chatDurationMinutes: value.chatDurationMinutes,
    visitDurationMinutes: value.visitDurationMinutes,
    rates: value.rates as Partial<Record<DirectoryServiceType, number>>,
  };
}

function parseSlot(value: unknown): ApiVetSlot {
  if (!isRecord(value) || !isUtcTimestamp(value.startsAt) || !isUtcTimestamp(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    throw invalidResponse('Slot dokter server harus memiliki timestamp UTC valid dengan waktu selesai setelah mulai.');
  }
  return { startsAt: value.startsAt, endsAt: value.endsAt };
}

function optionalText(value: string | undefined, maxLength: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidQuery(`${label} tidak valid.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw invalidQuery(`${label} terlalu panjang.`);
  return normalized || undefined;
}

function optionalFee(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!isSafeIdr(value)) throw invalidQuery(`${label} harus berupa rupiah integer aman dan tidak negatif.`);
  return value;
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function isService(value: unknown): value is DirectoryServiceType {
  return typeof value === 'string' && (SERVICE_TYPES as readonly string[]).includes(value);
}

function isServiceArray(value: unknown): value is DirectoryServiceType[] {
  return Array.isArray(value) && value.every(isService) && new Set(value).size === value.length;
}

function isSpeciesArray(value: unknown): value is LivestockSpecies[] {
  return Array.isArray(value) && value.every(isLivestockSpecies) && new Set(value).size === value.length;
}

function isTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isWeekdayRule(value: unknown): value is ApiDirectoryWeekdayRule {
  if (!isRecord(value) || !Number.isInteger(value.weekday) || Number(value.weekday) < 0 || Number(value.weekday) > 6
    || typeof value.start !== 'string' || typeof value.end !== 'string'
    || !isClockTime(value.start) || !isClockTime(value.end) || value.start >= value.end) return false;
  return true;
}

function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isFeeMap(value: unknown): value is Partial<Record<DirectoryServiceType, number>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => isService(key) && isSafeIdr(value[key]));
}

function feesCoverServices(services: DirectoryServiceType[], fees: Partial<Record<DirectoryServiceType, number>>): boolean {
  return services.every((service) => isSafeIdr(fees[service]));
}

function feeBoundsMatch(fees: Partial<Record<DirectoryServiceType, number>>, min: number, max: number): boolean {
  const values = Object.values(fees);
  return values.length > 0 && Math.min(...values) === min && Math.max(...values) === max;
}

function isSafeIdr(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isExperience(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 80;
}

function isDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 5 && Number(value) <= 240;
}

function isRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
