import type { ApiPatientRecord, PatientReadRepository } from '../../application/ports/PatientReadRepository';
import { livestockSexes } from '../../domain/livestock';
import { ApiClient } from './ApiClient';
import { invalidResponse, isCalendarDate, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const WEIGHT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_WEIGHT_KG = 999999.99;
const SERVICE_TYPES = ['chat', 'visit'] as const;
const SERVICE_STATUSES = ['requested', 'scheduled', 'reschedule_pending', 'in_progress', 'en_route', 'arrived', 'examining', 'completed', 'rejected', 'cancelled'] as const;

/** Parses the assigned-patient array documented by PatientResponseDto BE-16. */
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
    || !(value.weightKg === null || isWeightDecimal(value.weightKg))
    || !isNonEmptyText(value.ownerName, 120)
    || !isIsoTimestampWithTimezone(value.lastServiceAt)
    || typeof value.serviceCount !== 'number'
    || !Number.isSafeInteger(value.serviceCount) || value.serviceCount < 1
    || typeof value.latestServiceType !== 'string' || !(SERVICE_TYPES as readonly string[]).includes(value.latestServiceType)
    || typeof value.latestServiceStatus !== 'string' || !(SERVICE_STATUSES as readonly string[]).includes(value.latestServiceStatus)) {
    throw invalidResponse('Row pasien server tidak sesuai PatientResponseDto BE-16.');
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
    ownerName: value.ownerName,
    lastServiceAt: value.lastServiceAt,
    serviceCount: value.serviceCount,
    latestServiceType: value.latestServiceType as ApiPatientRecord['latestServiceType'],
    latestServiceStatus: value.latestServiceStatus as ApiPatientRecord['latestServiceStatus'],
  };
}

function isLivestockSex(value: unknown): value is ApiPatientRecord['sex'] {
  return typeof value === 'string' && (livestockSexes as readonly string[]).includes(value);
}

function isWeightDecimal(value: unknown): value is string {
  return typeof value === 'string' && WEIGHT_PATTERN.test(value) && Number(value) <= MAX_WEIGHT_KG;
}
