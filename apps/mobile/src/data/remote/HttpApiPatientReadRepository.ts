import type { ApiPatientRecord, PatientReadRepository } from '../../application/ports/PatientReadRepository';
import { livestockSexes } from '../../domain/livestock';
import { ApiClient } from './ApiClient';
import { invalidResponse, isCalendarDate, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const WEIGHT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_WEIGHT_KG = 999999.99;

/** Parses the compact raw-array projection returned by LivestockService.patients. */
export class HttpApiPatientReadRepository implements PatientReadRepository {
  constructor(private readonly api: ApiClient) {}

  async listPatients(): Promise<ApiPatientRecord[]> {
    const value = await this.api.request<unknown>('/v1/patients');
    if (!Array.isArray(value)) throw invalidResponse('Daftar pasien server harus berupa array BE-03.');
    return value.map(parseApiPatientRecord);
  }
}

function parseApiPatientRecord(value: unknown): ApiPatientRecord {
  if (!isRecord(value)
    || !isUuid(value.id) || !isUuid(value.farmId) || !isUuid(value.farmerId)
    || !isNonEmptyText(value.displayCode, 32)
    || !isNonEmptyText(value.name, 120)
    || !isNonEmptyText(value.species, 80)
    || !(value.breed === null || isNonEmptyText(value.breed, 80))
    || !isLivestockSex(value.sex)
    || !(value.birthDate === null || isCalendarDate(value.birthDate))
    || !(value.estimatedAgeMonths === null
      || (Number.isSafeInteger(value.estimatedAgeMonths) && Number(value.estimatedAgeMonths) >= 0 && Number(value.estimatedAgeMonths) <= 1200))
    || !(value.weightKg === null || isWeightDecimal(value.weightKg))) {
    throw invalidResponse('Row pasien server tidak sesuai proyeksi aktual BE-03.');
  }
  return {
    id: value.id,
    displayCode: value.displayCode,
    name: value.name,
    species: value.species,
    breed: value.breed as string | null,
    sex: value.sex as ApiPatientRecord['sex'],
    birthDate: value.birthDate as string | null,
    estimatedAgeMonths: value.estimatedAgeMonths as number | null,
    weightKg: value.weightKg as string | null,
    farmId: value.farmId,
    farmerId: value.farmerId,
  };
}

function isLivestockSex(value: unknown): value is ApiPatientRecord['sex'] {
  return typeof value === 'string' && (livestockSexes as readonly string[]).includes(value);
}

function isWeightDecimal(value: unknown): value is string {
  return typeof value === 'string' && WEIGHT_PATTERN.test(value) && Number(value) <= MAX_WEIGHT_KG;
}
