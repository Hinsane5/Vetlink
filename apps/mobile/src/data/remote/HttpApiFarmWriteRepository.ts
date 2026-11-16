import type {
  AddressPatchInput,
  AddressWriteInput,
  FarmPatchInput,
  FarmWriteInput,
  FarmWriteRepository,
} from '../../application/ports/FarmWriteRepository';
import type { ApiAddressRecord, ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import { livestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isRecord, isUuid } from './apiReadValidation';
import { parseApiAddressRecord, parseApiFarmRecord } from './HttpApiFarmReadRepository';

const MAX_LOCATION_JSON_BYTES = 64 * 1024;

/** BE-02 writes; ownership and active-role authorization remain server-session scoped. */
export class HttpApiFarmWriteRepository implements FarmWriteRepository {
  constructor(private readonly api: ApiClient) {}

  async createFarm(input: FarmWriteInput): Promise<ApiFarmRecord> {
    const body = farmPayload(input, true);
    return parseApiFarmRecord(await this.api.request<unknown>('/v1/me/farms', { method: 'POST', body }));
  }

  async updateFarm(farmId: string, input: FarmPatchInput): Promise<ApiFarmRecord> {
    if (!isUuid(farmId)) throw invalidQuery('ID peternakan server harus UUID.');
    const body = { ...farmPayload(input, false), expectedVersion: expectedVersion(input.expectedVersion) };
    return parseApiFarmRecord(await this.api.request<unknown>(`/v1/me/farms/${encodeURIComponent(farmId)}`, { method: 'PATCH', body }));
  }

  async createAddress(input: AddressWriteInput): Promise<ApiAddressRecord> {
    const body = addressPayload(input);
    return parseApiAddressRecord(await this.api.request<unknown>('/v1/me/addresses', { method: 'POST', body }));
  }

  async updateAddress(addressId: string, input: AddressPatchInput): Promise<ApiAddressRecord> {
    if (!isUuid(addressId)) throw invalidQuery('ID alamat server harus UUID.');
    const body = { ...addressPayload(input), expectedVersion: expectedVersion(input.expectedVersion) };
    return parseApiAddressRecord(await this.api.request<unknown>(`/v1/me/addresses/${encodeURIComponent(addressId)}`, { method: 'PATCH', body }));
  }

  async deleteAddress(addressId: string): Promise<void> {
    if (!isUuid(addressId)) throw invalidQuery('ID alamat server harus UUID.');
    const result = await this.api.request<unknown>(`/v1/me/addresses/${encodeURIComponent(addressId)}`, { method: 'DELETE' });
    if (!isRecord(result) || result.deleted !== true) throw invalidResponse('Respons penghapusan alamat server tidak sesuai kontrak.');
  }
}

function farmPayload(input: FarmWriteInput | FarmPatchInput, creating: boolean): Record<string, unknown> {
  if (!isRecord(input)) throw invalidQuery('Data peternakan tidak valid.');
  const body: Record<string, unknown> = {};
  if (creating || input.name !== undefined) {
    body.name = boundedText(input.name, 1, 120, 'Nama peternakan');
  }
  if (input.species !== undefined) {
    if (!Array.isArray(input.species) || input.species.length > livestockSpecies.length
      || !input.species.every((species) => livestockSpecies.includes(species))
      || new Set(input.species).size !== input.species.length) {
      throw invalidQuery('Daftar jenis ternak peternakan tidak valid.');
    }
    body.species = [...input.species];
  }
  if (input.timezone !== undefined) body.timezone = boundedText(input.timezone, 1, 80, 'Zona waktu');
  if (input.location !== undefined) body.location = boundedLocation(input.location);
  if (input.visitAddressId !== undefined) {
    if (!isUuid(input.visitAddressId)) throw invalidQuery('ID alamat kunjungan harus UUID.');
    body.visitAddressId = input.visitAddressId;
  }
  if (!creating && Object.keys(body).length === 0) throw invalidQuery('Perubahan peternakan harus memuat minimal satu field.');
  return body;
}

function addressPayload(input: AddressWriteInput): Record<string, unknown> {
  if (!isRecord(input)) throw invalidQuery('Data alamat tidak valid.');
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  if (hasLatitude !== hasLongitude) throw invalidQuery('Latitude dan longitude harus dikirim bersama.');
  const latitude = hasLatitude ? coordinate(input.latitude, -90, 90, 'Latitude') : null;
  const longitude = hasLongitude ? coordinate(input.longitude, -180, 180, 'Longitude') : null;
  return {
    label: boundedText(input.label, 1, 80, 'Label alamat'),
    recipientName: boundedText(input.recipientName, 1, 120, 'Nama penerima'),
    phone: boundedText(input.phone, 5, 32, 'Nomor telepon'),
    addressLine: boundedText(input.addressLine, 1, 500, 'Alamat lengkap'),
    city: boundedText(input.city, 1, 120, 'Kota/kabupaten'),
    province: boundedText(input.province, 1, 120, 'Provinsi'),
    postalCode: boundedText(input.postalCode, 1, 16, 'Kode pos'),
    // The BE-02 request accepts numbers; the read DTO preserves PostgreSQL numeric as strings.
    latitude,
    longitude,
  };
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    throw invalidQuery(`${label} harus berisi ${minimum} sampai ${maximum} karakter.`);
  }
  return value;
}

function boundedLocation(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidQuery('Lokasi peternakan harus berupa object.');
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidQuery('Lokasi peternakan harus dapat dikirim sebagai JSON.');
  }
  if (!serialized || utf8Length(serialized) > MAX_LOCATION_JSON_BYTES) {
    throw invalidQuery('Data lokasi peternakan melewati batas ukuran request.');
  }
  return value;
}

function coordinate(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum
    || !/^-?\d+(?:\.\d{1,6})?$/.test(String(value))) {
    throw invalidQuery(`${label} harus berupa angka desimal valid dalam rentang ${minimum} sampai ${maximum}.`);
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalidQuery('expectedVersion harus berupa bilangan bulat aman minimal 1.');
  return Number(value);
}

function utf8Length(value: string): number {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}
