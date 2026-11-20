import type { ApiPatientMediaRecord, PatientMediaReadRepository } from '../../application/ports/PatientMediaReadRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;

/** Reads private media metadata from the assignment-scoped BE-16 patient projection. */
export class HttpApiPatientMediaReadRepository implements PatientMediaReadRepository {
  constructor(private readonly api: ApiClient) {}

  async listForPatient(animalId: string): Promise<ApiPatientMediaRecord[]> {
    if (!isUuid(animalId)) throw invalidQuery('ID pasien untuk lampiran harus UUID.');
    const value = await this.api.request<unknown>(`/v1/patients/${encodeURIComponent(animalId)}/media`);
    if (!Array.isArray(value)) throw invalidResponse('Media pasien server harus berupa array BE-16.');
    return value.map(parsePatientMedia);
  }
}

function parsePatientMedia(value: unknown): ApiPatientMediaRecord {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.consultationId) || !isUuid(value.recordId)
    || (value.source !== 'message' && value.source !== 'progress_report')
    || (value.kind !== 'image' && value.kind !== 'video')
    || typeof value.mimeType !== 'string' || !(MIME_TYPES as readonly string[]).includes(value.mimeType)
    || (value.kind === 'video') !== (value.mimeType === 'video/mp4')
    || !isNonEmptyText(value.filename, 255)
    || !Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 1 || Number(value.byteSize) > 50 * 1024 * 1024
    || value.url !== `/v1/attachments/${value.id}/content`
    || !isIsoTimestampWithTimezone(value.createdAt)) {
    throw invalidResponse('Lampiran pasien server tidak sesuai PatientMediaResponseDto BE-16.');
  }
  return {
    id: value.id,
    consultationId: value.consultationId,
    recordId: value.recordId,
    source: value.source,
    kind: value.kind,
    mimeType: value.mimeType as ApiPatientMediaRecord['mimeType'],
    filename: value.filename,
    byteSize: value.byteSize as number,
    url: value.url,
    createdAt: value.createdAt,
  };
}
