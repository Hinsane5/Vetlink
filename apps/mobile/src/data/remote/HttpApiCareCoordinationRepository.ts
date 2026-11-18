import type { ApiCareCompletion, ApiCareCoordinationRepository, ApiFollowUp, ApiProgressReport, ApiReminder, CareApiOperation } from '../../application/ports/ApiCareCoordinationRepository';
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

  async listReminders(): Promise<ApiReminder[]> {
    const value = await this.api.request<unknown>('/v1/reminders');
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse('Daftar pengingat tidak sesuai kontrak BE-09.');
    return value.items.map((item: unknown) => parseReminder(item));
  }

  async createReminder(operation: CareApiOperation<{ animalId?: string; consultationId?: string; followUpId?: string; kind: 'care' | 'follow_up'; dueAt: string; instructions: string }>): Promise<ApiReminder> {
    const { key, payload } = validateOperation(operation);
    for (const id of [payload.animalId, payload.consultationId, payload.followUpId]) {
      if (id !== undefined && !isUuid(id)) throw invalidQuery('ID pengingat harus UUID server.');
    }
    if (payload.animalId === undefined && payload.consultationId === undefined && payload.followUpId === undefined)
      throw invalidQuery('Pengingat memerlukan konteks ternak, layanan, atau tindak lanjut.');
    if (payload.kind !== 'care' && payload.kind !== 'follow_up') throw invalidQuery('Jenis pengingat tidak valid.');
    if (!isIsoTimestampWithTimezone(payload.dueAt) || !isNonEmptyText(payload.instructions, 500)
      || payload.instructions.trim().length < 3) throw invalidQuery('Waktu atau instruksi pengingat tidak valid.');
    const body = { ...(payload.animalId === undefined ? {} : { animalId: payload.animalId }),
      ...(payload.consultationId === undefined ? {} : { consultationId: payload.consultationId }),
      ...(payload.followUpId === undefined ? {} : { followUpId: payload.followUpId }),
      kind: payload.kind, dueAt: payload.dueAt, instructions: payload.instructions };
    const result = parseReminder(await this.api.request<unknown>('/v1/reminders', {
      method: 'POST', idempotencyKey: key, body,
    }), true);
    if ((payload.animalId !== undefined && result.animalId !== payload.animalId)
      || (payload.consultationId !== undefined && result.consultationId !== payload.consultationId)
      || (payload.followUpId !== undefined && result.followUpId !== payload.followUpId)
      || result.kind !== payload.kind) throw invalidResponse('Pengingat tersimpan tidak cocok dengan permintaan.');
    return result;
  }

  async retryReminderDelivery(reminderId: string, idempotencyKey: string): Promise<ApiReminder> {
    const id = resourceId(reminderId);
    const key = operationKey(idempotencyKey);
    const result = parseReminder(await this.api.request<unknown>(`/v1/reminders/${id}`, {
      method: 'PATCH', idempotencyKey: key, body: { action: 'retry_delivery' },
    }), true);
    if (result.id !== reminderId) throw invalidResponse('Hasil pengiriman pengingat tidak sesuai ID.');
    return result;
  }

  async completeCare(reminderId: string, operation: CareApiOperation<{ confirmation: true }>): Promise<ApiCareCompletion> {
    const id = resourceId(reminderId);
    const { key, payload } = validateOperation(operation);
    if (payload.confirmation !== true) throw invalidQuery('Konfirmasi perawatan wajib diberikan.');
    const value = await this.api.request<unknown>(`/v1/reminders/${id}/complete`, {
      method: 'POST', idempotencyKey: key, body: { confirmation: true },
    });
    if (!isRecord(value) || !isUuid(value.healthEventId)) throw invalidResponse('Konfirmasi perawatan tidak sesuai kontrak BE-09.');
    const reminder = parseReminder(value.reminder);
    if (reminder.id !== reminderId || reminder.kind !== 'care' || reminder.careStatus !== 'done'
      || reminder.completedAt === null) throw invalidResponse('Perawatan belum tercatat selesai.');
    const { operationId, replayed } = parseOperation(value, true);
    return { reminder, healthEventId: value.healthEventId, operationId: operationId!, replayed: replayed! };
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID server harus UUID.');
  return encodeURIComponent(value);
}
function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }

function validateOperation<T>(operation: CareApiOperation<T>): { key: string; payload: T & Record<string, unknown> } {
  if (!isRecord(operation) || !isRecord(operation.payload)) throw invalidQuery('Operasi care memerlukan payload.');
  return { key: operationKey(operation.idempotencyKey), payload: operation.payload as T & Record<string, unknown> };
}

function operationKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value))
    throw invalidQuery('Idempotency-Key care harus 8–128 karakter alfanumerik, hubung, atau garis bawah.');
  return value;
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

function parseReminder(value: unknown, operation = false): ApiReminder {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.animalId)
    || !(value.consultationId === null || isUuid(value.consultationId))
    || !(value.followUpId === null || isUuid(value.followUpId))
    || !isUuid(value.ownerId) || !isUuid(value.createdBy)
    || (value.kind !== 'care' && value.kind !== 'follow_up')
    || !isIsoTimestampWithTimezone(value.dueAt)
    || !isNonEmptyText(value.instructions, 500)
    || (value.careStatus !== 'scheduled' && value.careStatus !== 'done')
    || (value.deliveryStatus !== 'pending' && value.deliveryStatus !== 'sent' && value.deliveryStatus !== 'failed')
    || !(value.completedAt === null || isIsoTimestampWithTimezone(value.completedAt))
    || (value.careStatus === 'done' && value.completedAt === null)
    || (value.careStatus === 'scheduled' && value.completedAt !== null)
    || !positiveVersion(value.deliveryAttempt) || !positiveVersion(value.version)
    || !isIsoTimestampWithTimezone(value.createdAt) || !isIsoTimestampWithTimezone(value.updatedAt))
    throw invalidResponse('Pengingat tidak sesuai kontrak BE-09.');
  let deliveryOutcome: ApiReminder['deliveryOutcome'];
  if (value.deliveryOutcome !== undefined) {
    const outcome = value.deliveryOutcome;
    if (!isRecord(outcome) || !isUuid(outcome.operationId)
      || (outcome.status !== 'pending' && outcome.status !== 'succeeded' && outcome.status !== 'failed')
      || !isIsoTimestampWithTimezone(outcome.occurredAt)) throw invalidResponse('Hasil pengiriman pengingat tidak valid.');
    deliveryOutcome = { operationId: outcome.operationId, status: outcome.status, occurredAt: outcome.occurredAt };
  }
  return { id: value.id, animalId: value.animalId, consultationId: value.consultationId as string | null,
    followUpId: value.followUpId as string | null, ownerId: value.ownerId, createdBy: value.createdBy,
    kind: value.kind, dueAt: value.dueAt, instructions: value.instructions,
    careStatus: value.careStatus, deliveryStatus: value.deliveryStatus,
    completedAt: value.completedAt as string | null, deliveryAttempt: value.deliveryAttempt,
    version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(deliveryOutcome === undefined ? {} : { deliveryOutcome }), ...parseOperation(value, operation) };
}
