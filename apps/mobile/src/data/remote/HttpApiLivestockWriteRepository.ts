import type { LivestockPatchInput, LivestockCreateInput, LivestockWriteRepository } from '../../application/ports/LivestockWriteRepository';
import type { ApiLivestockRecord } from '../../application/ports/LivestockReadRepository';
import { livestockSexes } from '../../domain/livestock';
import { livestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, isCalendarDate, isUuid } from './apiReadValidation';
import { parseApiLivestockRecord } from './HttpApiLivestockReadRepository';

const MAX_WEIGHT_KG = 999999.99;

/** BE-03 Peternak writes; the bearer session supplies owner and active-role scope. */
export class HttpApiLivestockWriteRepository implements LivestockWriteRepository {
  constructor(private readonly api: ApiClient) {}

  async create(input: LivestockCreateInput): Promise<ApiLivestockRecord> {
    const body = createPayload(input);
    return parseApiLivestockRecord(await this.api.request<unknown>('/v1/livestock', { method: 'POST', body }));
  }

  async update(livestockId: string, input: LivestockPatchInput): Promise<ApiLivestockRecord> {
    if (!isUuid(livestockId)) throw invalidQuery('ID ternak server harus UUID.');
    const body = patchPayload(input);
    return parseApiLivestockRecord(await this.api.request<unknown>(`/v1/livestock/${encodeURIComponent(livestockId)}`, { method: 'PATCH', body }));
  }
}

function createPayload(input: LivestockCreateInput): Record<string, unknown> {
  if (!isRecordLike(input) || !isUuid(input.farmId)) throw invalidQuery('Pembuatan ternak memerlukan ID Farm UUID.');
  const body: Record<string, unknown> = {
    farmId: input.farmId,
    displayCode: boundedText(input.displayCode, 1, 32, 'Kode ternak'),
    name: boundedText(input.name, 1, 120, 'Nama ternak'),
    species: species(input.species),
    sex: sex(input.sex),
  };
  if (input.breed !== undefined) body.breed = boundedText(input.breed, 0, 80, 'Ras ternak');
  if (input.birthDate !== undefined) body.birthDate = birthDate(input.birthDate, false);
  if (input.estimatedAgeMonths !== undefined) body.estimatedAgeMonths = ageMonths(input.estimatedAgeMonths, false);
  if (input.weightKg !== undefined) body.weightKg = weightKg(input.weightKg, false);
  ensureAgeFieldsCompatible(body.birthDate, body.estimatedAgeMonths);
  return body;
}

function patchPayload(input: LivestockPatchInput): Record<string, unknown> {
  if (!isRecordLike(input)) throw invalidQuery('Perubahan ternak tidak valid.');
  const body: Record<string, unknown> = { expectedVersion: expectedVersion(input.expectedVersion) };
  if (input.displayCode !== undefined) body.displayCode = boundedText(input.displayCode, 1, 32, 'Kode ternak');
  if (input.name !== undefined) body.name = boundedText(input.name, 1, 120, 'Nama ternak');
  if (input.species !== undefined) body.species = species(input.species);
  if (input.breed !== undefined) body.breed = input.breed === null ? null : boundedText(input.breed, 0, 80, 'Ras ternak');
  if (input.sex !== undefined) body.sex = sex(input.sex);
  if (input.birthDate !== undefined) body.birthDate = birthDate(input.birthDate, true);
  if (input.estimatedAgeMonths !== undefined) body.estimatedAgeMonths = ageMonths(input.estimatedAgeMonths, true);
  if (input.weightKg !== undefined) body.weightKg = weightKg(input.weightKg, true);
  if (Object.keys(body).length === 1) throw invalidQuery('Perubahan ternak harus memuat minimal satu field.');
  ensureAgeFieldsCompatible(body.birthDate, body.estimatedAgeMonths);
  return body;
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    throw invalidQuery(`${label} harus berisi ${minimum} sampai ${maximum} karakter.`);
  }
  return value;
}

function species(value: unknown): string {
  if (typeof value !== 'string' || !livestockSpecies.includes(value as (typeof livestockSpecies)[number])) {
    throw invalidQuery('Jenis ternak tidak tersedia.');
  }
  return value;
}

function sex(value: unknown): string {
  if (typeof value !== 'string' || !livestockSexes.includes(value as (typeof livestockSexes)[number])) {
    throw invalidQuery('Jenis kelamin ternak tidak tersedia.');
  }
  return value;
}

function birthDate(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (!isCalendarDate(value)) throw invalidQuery('Tanggal lahir harus berupa tanggal kalender YYYY-MM-DD.');
  return value;
}

function ageMonths(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1200) {
    throw invalidQuery('Estimasi umur harus berupa bilangan bulat aman 0 sampai 1200 bulan.');
  }
  return Number(value);
}

function weightKg(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_WEIGHT_KG
    || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw invalidQuery('Berat harus berupa angka desimal 0 sampai 999999,99 kg dengan maksimal dua desimal.');
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalidQuery('expectedVersion harus berupa bilangan bulat aman minimal 1.');
  return Number(value);
}

function ensureAgeFieldsCompatible(birthDateValue: unknown, estimatedAgeValue: unknown): void {
  if (birthDateValue !== undefined && birthDateValue !== null
    && estimatedAgeValue !== undefined && estimatedAgeValue !== null) {
    throw invalidQuery('Isi tanggal lahir atau estimasi umur, bukan keduanya.');
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
