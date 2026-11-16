import type { ApiAddressRecord, ApiFarmRecord, FarmReadRepository } from '../../application/ports/FarmReadRepository';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isDecimalString, isNonEmptyText, isRecord, isUtcTimestamp, isUuid } from './apiReadValidation';

const COORDINATE_PATTERN = /^-?\d+(?:\.\d{1,6})?$/;

/** Read-only adapter for BE-02 owner-scoped Farm and address routes. */
export class HttpApiFarmReadRepository implements FarmReadRepository {
  constructor(private readonly api: ApiClient) {}

  async listFarms(): Promise<ApiFarmRecord[]> {
    const value = await this.api.request<unknown>('/v1/me/farms');
    if (!Array.isArray(value)) throw invalidResponse('Daftar peternakan server tidak sesuai kontrak.');
    return value.map(parseApiFarmRecord);
  }

  async getFarmById(farmId: string): Promise<ApiFarmRecord> {
    if (!isUuid(farmId)) throw invalidQuery('ID peternakan server harus UUID.');
    return parseApiFarmRecord(await this.api.request<unknown>(`/v1/me/farms/${encodeURIComponent(farmId)}`));
  }

  async listAddresses(): Promise<ApiAddressRecord[]> {
    const value = await this.api.request<unknown>('/v1/me/addresses');
    if (!Array.isArray(value)) throw invalidResponse('Daftar alamat server tidak sesuai kontrak.');
    return value.map(parseApiAddressRecord);
  }

  async getAddressById(addressId: string): Promise<ApiAddressRecord> {
    if (!isUuid(addressId)) throw invalidQuery('ID alamat server harus UUID.');
    return parseApiAddressRecord(await this.api.request<unknown>(`/v1/me/addresses/${encodeURIComponent(addressId)}`));
  }
}

export function parseApiFarmRecord(value: unknown): ApiFarmRecord {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isNonEmptyText(value.name, 120)
    || !Array.isArray(value.species) || !value.species.every(isLivestockSpecies)
    || new Set(value.species).size !== value.species.length
    || !isNonEmptyText(value.timezone, 80)
    || !(value.location === null || isRecord(value.location))
    || !(value.visitAddressId === null || isUuid(value.visitAddressId))
    || !isUtcTimestamp(value.createdAt) || !isUtcTimestamp(value.updatedAt)
    || !isVersion(value.version)) {
    throw invalidResponse('Data peternakan server tidak sesuai DTO BE-16.');
  }
  return {
    id: value.id,
    name: value.name,
    species: value.species as LivestockSpecies[],
    timezone: value.timezone,
    location: value.location as Record<string, unknown> | null,
    visitAddressId: value.visitAddressId as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

export function parseApiAddressRecord(value: unknown): ApiAddressRecord {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isNonEmptyText(value.label, 80)
    || !isNonEmptyText(value.recipientName, 120)
    || !isNonEmptyText(value.phone, 32)
    || !isNonEmptyText(value.addressLine, 500)
    || !isNonEmptyText(value.city, 120)
    || !isNonEmptyText(value.province, 120)
    || !isNonEmptyText(value.postalCode, 16)
    || !isNullableCoordinate(value.latitude, -90, 90) || !isNullableCoordinate(value.longitude, -180, 180)
    || (value.latitude === null) !== (value.longitude === null)
    || !isUtcTimestamp(value.createdAt) || !isUtcTimestamp(value.updatedAt)
    || !isVersion(value.version)) {
    throw invalidResponse('Data alamat server tidak sesuai DTO BE-16.');
  }
  return {
    id: value.id,
    label: value.label,
    recipientName: value.recipientName,
    phone: value.phone,
    addressLine: value.addressLine,
    city: value.city,
    province: value.province,
    postalCode: value.postalCode,
    latitude: value.latitude as string | null,
    longitude: value.longitude as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function isNullableCoordinate(value: unknown, minimum: number, maximum: number): value is string | null {
  if (value === null) return true;
  if (!isDecimalString(value, COORDINATE_PATTERN)) return false;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum;
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
