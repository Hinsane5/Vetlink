import type {
  ApiClinicalNote, ApiClinicalNoteInput, ApiClinicalRepository, ApiRecommendation,
  ApiRecommendationInput, ApiRecommendationItem,
} from '../../application/ports/ApiClinicalRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isRecord, isUuid } from './apiReadValidation';

/** BE-08 raw row adapter; final note and sent recommendation remain server-owned. */
export class HttpApiClinicalRepository implements ApiClinicalRepository {
  constructor(private readonly api: ApiClient) {}

  async getNote(consultationId: string): Promise<ApiClinicalNote> {
    const id = resourceId(consultationId);
    return parseNote(await this.api.request<unknown>(`/v1/consultations/${id}/note`), consultationId);
  }

  async saveNote(consultationId: string, input: ApiClinicalNoteInput): Promise<ApiClinicalNote> {
    const id = resourceId(consultationId);
    const body = notePayload(input);
    return parseNote(await this.api.request<unknown>(`/v1/consultations/${id}/note`, { method: 'PUT', body }), consultationId);
  }

  async finalizeNote(consultationId: string, expectedVersion: number): Promise<ApiClinicalNote> {
    const id = resourceId(consultationId);
    if (!positiveVersion(expectedVersion)) throw invalidQuery('Versi catatan klinis tidak valid.');
    return parseNote(await this.api.request<unknown>(`/v1/consultations/${id}/note/finalize`, {
      method: 'POST', body: { expectedVersion },
    }), consultationId);
  }

  async getRecommendation(consultationId: string): Promise<ApiRecommendation> {
    const id = resourceId(consultationId);
    return parseRecommendation(await this.api.request<unknown>(`/v1/consultations/${id}/recommendation`), consultationId, 'read');
  }

  async saveRecommendation(consultationId: string, input: ApiRecommendationInput): Promise<ApiRecommendation> {
    const id = resourceId(consultationId);
    const body = recommendationPayload(input);
    return parseRecommendation(await this.api.request<unknown>(`/v1/consultations/${id}/recommendation`, {
      method: 'PUT', body,
    }), consultationId, 'save');
  }

  async sendRecommendation(consultationId: string, expectedVersion: number): Promise<ApiRecommendation> {
    const id = resourceId(consultationId);
    if (!positiveVersion(expectedVersion)) throw invalidQuery('Versi rekomendasi tidak valid.');
    return parseRecommendation(await this.api.request<unknown>(`/v1/consultations/${id}/recommendation/send`, {
      method: 'POST', body: { expectedVersion },
    }), consultationId, 'send');
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID konsultasi server harus UUID.');
  return encodeURIComponent(value);
}
function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }
function textWithin(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }

function notePayload(input: ApiClinicalNoteInput): Record<string, unknown> {
  if (!isRecord(input) || !positiveVersion(input.expectedVersion)) throw invalidQuery('Versi catatan klinis tidak valid.');
  const body: Record<string, unknown> = { expectedVersion: input.expectedVersion };
  const fields = { complaint: 4000, findings: 8000, assessment: 8000, actions: 8000, careInstructions: 8000 };
  for (const [field, max] of Object.entries(fields)) {
    const value = input[field as keyof ApiClinicalNoteInput];
    if (value !== undefined) {
      if (!textWithin(value, max)) throw invalidQuery(`Field ${field} catatan klinis tidak valid.`);
      body[field] = value;
    }
  }
  return body;
}

function parseNote(value: unknown, expectedConsultationId: string): ApiClinicalNote {
  if (!isRecord(value) || !positiveVersion(value.version) || (value.status !== 'draft' && value.status !== 'final')
    || !textWithin(value.complaint, 4000) || !textWithin(value.findings, 8000)
    || !textWithin(value.assessment, 8000) || !textWithin(value.actions, 8000)) {
    throw invalidResponse('Catatan klinis tidak sesuai kontrak BE-08.');
  }
  const id = value.id === undefined ? null : value.id;
  const consultationId = value.consultation_id ?? value.consultationId;
  const careInstructions = value.care_instructions ?? value.careInstructions;
  const finalizedAt = value.finalized_at ?? null;
  if ((id !== null && !isUuid(id)) || consultationId !== expectedConsultationId
    || !textWithin(careInstructions, 8000)
    || !(finalizedAt === null || isIsoTimestampWithTimezone(finalizedAt))
    || (value.status === 'final' && (id === null || finalizedAt === null))) {
    throw invalidResponse('Identitas atau finalisasi catatan klinis tidak valid.');
  }
  return { id, consultationId, status: value.status, complaint: value.complaint,
    findings: value.findings, assessment: value.assessment, actions: value.actions,
    careInstructions, version: value.version, finalizedAt };
}

function recommendationPayload(input: ApiRecommendationInput): Record<string, unknown> {
  if (!isRecord(input) || !positiveVersion(input.expectedVersion)
    || !Array.isArray(input.items) || input.items.length > 50) throw invalidQuery('Item rekomendasi atau versi tidak valid.');
  return { expectedVersion: input.expectedVersion, items: input.items.map((item, index) => {
    if (!isRecord(item)) throw invalidQuery(`Item rekomendasi ${index + 1} tidak valid.`);
    const body: Record<string, unknown> = {};
    if (item.productId !== undefined) {
      if (!isUuid(item.productId)) throw invalidQuery('ID produk rekomendasi harus UUID.');
      body.productId = item.productId;
    }
    if (item.title !== undefined) {
      if (!textWithin(item.title, 160) || !item.title.trim()) throw invalidQuery('Judul rekomendasi tidak valid.');
      body.title = item.title;
    }
    if (body.productId === undefined && body.title === undefined) throw invalidQuery('Judul atau produk rekomendasi wajib diisi.');
    for (const field of ['instructions', 'note'] as const) {
      if (item[field] !== undefined) {
        if (!textWithin(item[field], 2000)) throw invalidQuery(`Field ${field} rekomendasi tidak valid.`);
        body[field] = item[field];
      }
    }
    return body;
  }) };
}

function parseRecommendation(value: unknown, expectedConsultationId: string, route: 'read' | 'save' | 'send'): ApiRecommendation {
  if (!isRecord(value) || !positiveVersion(value.version)
    || (value.status !== 'draft' && value.status !== 'sent')) throw invalidResponse('Rekomendasi tidak sesuai kontrak BE-08.');
  const id = value.id === undefined ? null : value.id;
  const consultationId = value.consultation_id ?? value.consultationId;
  const sentAt = value.sent_at ?? null;
  if ((id !== null && !isUuid(id)) || consultationId !== expectedConsultationId
    || !(sentAt === null || isIsoTimestampWithTimezone(sentAt))
    || (value.status === 'sent' && (id === null || sentAt === null))) {
    throw invalidResponse('Identitas atau status rekomendasi tidak valid.');
  }
  if (route === 'save' && value.status !== 'draft') throw invalidResponse('Hasil simpan rekomendasi harus draft.');
  if (route === 'send' && value.status !== 'sent') throw invalidResponse('Hasil kirim rekomendasi harus sent.');
  let items: ApiRecommendationItem[] | null = null;
  if (route !== 'send') {
    if (!Array.isArray(value.items)) throw invalidResponse('Item rekomendasi tidak tersedia.');
    items = value.items.map((item: unknown) => parseRecommendationItem(item, route));
  }
  if (value.alreadySent !== undefined && typeof value.alreadySent !== 'boolean') throw invalidResponse('Flag pengiriman rekomendasi tidak valid.');
  return { id, consultationId, status: value.status, version: value.version,
    sentAt, items, ...(value.alreadySent === undefined ? {} : { alreadySent: value.alreadySent }) };
}

function parseRecommendationItem(value: unknown, route: 'read' | 'save'): ApiRecommendationItem {
  if (!isRecord(value) || !(value.productId === null || isUuid(value.productId))
    || !textWithin(value.title, 160) || !value.title.trim()
    || !textWithin(value.instructions, 2000) || !textWithin(value.note, 2000)
    || (route === 'read' && !isUuid(value.id))) throw invalidResponse('Item rekomendasi tersimpan tidak valid.');
  return { productId: value.productId, title: value.title,
    instructions: value.instructions, note: value.note };
}
