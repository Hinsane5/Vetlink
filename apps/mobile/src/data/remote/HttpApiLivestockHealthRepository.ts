import { healthRecordKinds, type FarmerReportKind, type HealthRecordKind } from '../../domain/health';
import type {
  ApiCareEvent,
  ApiCareEventInput,
  ApiHealthEvent,
  ApiHealthEventProvenance,
  LivestockCareEventWriteRepository,
  LivestockHealthReadRepository,
} from '../../application/ports/LivestockHealthRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isCalendarDate, isRecord, isUtcTimestamp, isUuid } from './apiReadValidation';

const healthEventProvenances: readonly ApiHealthEventProvenance[] = ['farmer_report', 'clinical_note', 'reminder'];
const farmerReportKinds: readonly FarmerReportKind[] = ['disease', 'vaccine', 'medication', 'care'];
const isoDateTimePattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Isolated BE-03 adapter. A care report remains a farmer_report event; the server
 * alone decides whether the bearer owns the animal and is allowed to write.
 */
export class HttpApiLivestockHealthRepository implements LivestockHealthReadRepository, LivestockCareEventWriteRepository {
  constructor(private readonly api: ApiClient) {}

  async listHealthEvents(livestockId: string): Promise<ApiHealthEvent[]> {
    if (!isUuid(livestockId)) throw invalidQuery('ID ternak untuk riwayat kesehatan harus UUID.');
    const value = await this.api.request<unknown>(`/v1/livestock/${encodeURIComponent(livestockId)}/health-events`);
    if (!Array.isArray(value)) throw invalidResponse('Timeline kesehatan server harus berupa array BE-03.');
    return value.map(parseApiHealthEvent);
  }

  async createCareEvent(livestockId: string, input: ApiCareEventInput): Promise<ApiCareEvent> {
    if (!isUuid(livestockId)) throw invalidQuery('ID ternak untuk laporan perawatan harus UUID.');
    const body = careEventPayload(input);
    const value = await this.api.request<unknown>(`/v1/livestock/${encodeURIComponent(livestockId)}/care-events`, {
      method: 'POST',
      body,
    });
    return parseApiCareEvent(value);
  }
}

function parseApiHealthEvent(value: unknown): ApiHealthEvent {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isHealthRecordKind(value.kind)
    || !isUtcTimestamp(value.occurredAt)
    || typeof value.description !== 'string' || value.description.length > 8000
    || !isHealthEventProvenance(value.provenance)
    || !isUtcTimestamp(value.createdAt)) {
    throw invalidResponse('Catatan timeline server tidak sesuai proyeksi BE-03.');
  }
  return {
    id: value.id,
    kind: value.kind,
    occurredAt: value.occurredAt,
    description: value.description,
    provenance: value.provenance,
    createdAt: value.createdAt,
  };
}

function parseApiCareEvent(value: unknown): ApiCareEvent {
  if (!isRecord(value)
    || !isUuid(value.id)
    || !isFarmerReportKind(value.kind)
    || !isUtcTimestamp(value.occurredAt)
    || typeof value.description !== 'string' || value.description.length < 1 || value.description.length > 2000
    || value.provenance !== 'farmer_report') {
    throw invalidResponse('Hasil laporan perawatan server tidak sesuai kontrak BE-03.');
  }
  return {
    id: value.id,
    kind: value.kind,
    occurredAt: value.occurredAt,
    description: value.description,
    provenance: 'farmer_report',
  };
}

function careEventPayload(input: ApiCareEventInput): ApiCareEventInput {
  if (!isRecord(input) || !isFarmerReportKind(input.kind)) {
    throw invalidQuery('Jenis laporan hanya dapat berupa penyakit, vaksin, obat, atau perawatan Peternak.');
  }
  if (!isIsoDateTimeWithZone(input.occurredAt)) {
    throw invalidQuery('Waktu laporan harus berupa timestamp ISO-8601 dengan zona waktu.');
  }
  if (typeof input.description !== 'string' || input.description.length < 1 || input.description.length > 2000
    || input.description.trim().length === 0) {
    throw invalidQuery('Deskripsi laporan harus berisi 1 sampai 2000 karakter.');
  }
  if (typeof input.sourceKey !== 'string' || input.sourceKey.length < 8 || input.sourceKey.length > 128
    || input.sourceKey.trim().length === 0) {
    throw invalidQuery('sourceKey laporan harus berisi 8 sampai 128 karakter.');
  }

  // Build an allowlisted payload: actor, owner, provenance, and animal ID belong to the server/route.
  return {
    kind: input.kind,
    occurredAt: input.occurredAt,
    description: input.description,
    sourceKey: input.sourceKey,
  };
}

function isIsoDateTimeWithZone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = isoDateTimePattern.exec(value);
  if (!match || !isCalendarDate(match[1])) return false;
  const [, date, hours, minutes, seconds, fraction, zone, sign, offsetHours, offsetMinutes] = match;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return false;
  if (zone !== 'Z') {
    const hourOffset = Number(offsetHours);
    const minuteOffset = Number(offsetMinutes);
    if (hourOffset > 14 || minuteOffset > 59 || (hourOffset === 14 && minuteOffset !== 0)) return false;
  }
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
  const offset = zone === 'Z' ? 'Z' : `${sign}${offsetHours}:${offsetMinutes}`;
  return Number.isFinite(Date.parse(`${date}T${hours}:${minutes}:${seconds}${millis}${offset}`));
}

function isHealthRecordKind(value: unknown): value is HealthRecordKind {
  return typeof value === 'string' && (healthRecordKinds as readonly string[]).includes(value);
}

function isFarmerReportKind(value: unknown): value is FarmerReportKind {
  return typeof value === 'string' && farmerReportKinds.includes(value as FarmerReportKind);
}

function isHealthEventProvenance(value: unknown): value is ApiHealthEventProvenance {
  return typeof value === 'string' && healthEventProvenances.includes(value as ApiHealthEventProvenance);
}
