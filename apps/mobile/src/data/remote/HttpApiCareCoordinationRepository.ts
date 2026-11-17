import type { ApiCareCoordinationRepository, ApiFollowUp, ApiProgressReport, CareApiOperation } from '../../application/ports/ApiCareCoordinationRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

/** BE-09 follow-up and farmer report adapter; server owns role and relationship checks. */
export class HttpApiCareCoordinationRepository implements ApiCareCoordinationRepository {
  constructor(private readonly api: ApiClient) {}

  async listFollowUps(consultationId: string): Promise<ApiFollowUp[]> {
    const id = resourceId(consultationId);
    const value = await this.api.request<unknown>(`/v1/consultations/${id}/follow-ups`);
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse('Daftar tindak lanjut tidak sesuai kontrak BE-09.');
    return value.items.map((item: unknown) => parseFollowUp(item, consultationId));
  }

  async createFollowUp(consultationId: string, operation: CareApiOperation<{ startsAt: string; endsAt: string; reason: string }>): Promise<ApiFollowUp> {
    const id = resourceId(consultationId);
    const { key, payload } = validateOperation(operation);
    if (!isIsoTimestampWithTimezone(payload.startsAt) || !isIsoTimestampWithTimezone(payload.endsAt)
      || Date.parse(payload.startsAt) >= Date.parse(payload.endsAt)
      || !isNonEmptyText(payload.reason, 1000) || payload.reason.length < 3) {
      throw invalidQuery('Jadwal atau alasan tindak lanjut tidak valid.');
    }
    return parseFollowUp(await this.api.request<unknown>(`/v1/consultations/${id}/follow-ups`, {
      method: 'POST', idempotencyKey: key,
      body: { startsAt: payload.startsAt, endsAt: payload.endsAt, reason: payload.reason },
    }), consultationId, true);
  }

  async cancelFollowUp(followUpId: string, operation: CareApiOperation<{ expectedVersion: number }>): Promise<ApiFollowUp> {
    const id = resourceId(followUpId);
    const { key, payload } = validateOperation(operation);
    if (!positiveVersion(payload.expectedVersion)) throw invalidQuery('Versi tindak lanjut tidak valid.');
    const result = parseFollowUp(await this.api.request<unknown>(`/v1/follow-ups/${id}`, {
      method: 'PATCH', idempotencyKey: key,
      body: { action: 'cancel', expectedVersion: payload.expectedVersion },
    }), undefined, true);
    if (result.id !== followUpId || result.status !== 'cancelled') throw invalidResponse('Pembatalan tindak lanjut tidak tersimpan.');
    return result;
  }

  async listProgressReports(followUpId: string): Promise<ApiProgressReport[]> {
    const id = resourceId(followUpId);
    const value = await this.api.request<unknown>(`/v1/follow-ups/${id}/progress-reports`);
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse('Daftar laporan perkembangan tidak sesuai kontrak BE-09.');
    return value.items.map((item: unknown) => parseReport(item, followUpId));
  }

  async createProgressReport(followUpId: string, operation: CareApiOperation<{ text: string; attachmentIds?: string[] }>): Promise<ApiProgressReport> {
    const id = resourceId(followUpId);
    const { key, payload } = validateOperation(operation);
    if (!isNonEmptyText(payload.text, 2000) || payload.text.length < 3) throw invalidQuery('Laporan harus berisi 3 sampai 2.000 karakter.');
    if (payload.attachmentIds !== undefined && (!Array.isArray(payload.attachmentIds)
      || payload.attachmentIds.length > 5 || !payload.attachmentIds.every(isUuid)
      || new Set(payload.attachmentIds).size !== payload.attachmentIds.length)) {
      throw invalidQuery('Maksimal lima lampiran laporan UUID berbeda.');
    }
    const body = { text: payload.text,
      ...(payload.attachmentIds === undefined ? {} : { attachmentIds: [...payload.attachmentIds] }) };
    const result = parseReport(await this.api.request<unknown>(`/v1/follow-ups/${id}/progress-reports`, {
      method: 'POST', idempotencyKey: key, body,
    }), followUpId, true);
    return result;
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID server harus UUID.');
  return encodeURIComponent(value);
}
function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }

function validateOperation<T>(operation: CareApiOperation<T>): { key: string; payload: T & Record<string, unknown> } {
  if (!isRecord(operation) || !isRecord(operation.payload)
    || typeof operation.idempotencyKey !== 'string' || operation.idempotencyKey.trim().length < 8
    || operation.idempotencyKey.trim().length > 128) throw invalidQuery('Operasi care memerlukan Idempotency-Key 8–128 karakter.');
  return { key: operation.idempotencyKey, payload: operation.payload as T & Record<string, unknown> };
}

function parseOperation(value: Record<string, unknown>, required: boolean): { operationId?: string; replayed?: boolean } {
  if ((required || value.operationId !== undefined || value.replayed !== undefined)
    && (!isUuid(value.operationId) || typeof value.replayed !== 'boolean')) {
    throw invalidResponse('Identitas operasi care tidak valid.');
  }
  return value.operationId === undefined ? {} : { operationId: value.operationId as string, replayed: value.replayed as boolean };
}

function parseFollowUp(value: unknown, consultationId?: string, operation = false): ApiFollowUp {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.consultationId)
    || (consultationId !== undefined && value.consultationId !== consultationId)
    || !isUuid(value.farmerId) || !isUuid(value.vetId) || !isUuid(value.animalId)
    || !isIsoTimestampWithTimezone(value.startsAt) || !isIsoTimestampWithTimezone(value.endsAt)
    || Date.parse(value.startsAt) >= Date.parse(value.endsAt)
    || !isNonEmptyText(value.timezone, 80) || value.kind !== 'recheck'
    || (value.status !== 'scheduled' && value.status !== 'completed' && value.status !== 'cancelled')
    || !isNonEmptyText(value.reason, 1000)
    || !(value.followUpConsultationId === null || isUuid(value.followUpConsultationId))
    || !positiveVersion(value.version)
    || !isIsoTimestampWithTimezone(value.createdAt) || !isIsoTimestampWithTimezone(value.updatedAt)) {
    throw invalidResponse('Tindak lanjut tidak sesuai kontrak BE-09.');
  }
  return { id: value.id, consultationId: value.consultationId, farmerId: value.farmerId,
    vetId: value.vetId, animalId: value.animalId, startsAt: value.startsAt, endsAt: value.endsAt,
    timezone: value.timezone, kind: 'recheck', status: value.status as ApiFollowUp['status'],
    reason: value.reason, followUpConsultationId: value.followUpConsultationId as string | null,
    version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...parseOperation(value, operation) };
}

function parseReport(value: unknown, followUpId: string, operation = false): ApiProgressReport {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.consultationId)
    || value.followUpId !== followUpId || !isUuid(value.farmerId)
    || !isUuid(value.vetId) || !isUuid(value.animalId)
    || !isNonEmptyText(value.text, 2000) || !Array.isArray(value.attachmentIds)
    || value.attachmentIds.length > 5 || !value.attachmentIds.every(isUuid)
    || !isIsoTimestampWithTimezone(value.submittedAt)
    || !(value.viewedAt === null || isIsoTimestampWithTimezone(value.viewedAt))) {
    throw invalidResponse('Laporan perkembangan tidak sesuai kontrak BE-09.');
  }
  return { id: value.id, consultationId: value.consultationId, followUpId,
    farmerId: value.farmerId, vetId: value.vetId, animalId: value.animalId,
    text: value.text, attachmentIds: value.attachmentIds, submittedAt: value.submittedAt,
    viewedAt: value.viewedAt as string | null, ...parseOperation(value, operation) };
}
