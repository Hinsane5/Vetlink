import type { ApiConsultationReview, ApiReview, ApiReviewRepository } from '../../application/ports/ApiReviewRepository';
import { ApiClient } from './ApiClient';
import { DomainError } from '../../domain/errors';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isRecord, isUuid,
  parseReadPage, validateOpaqueCursor, validatePageLimit } from './apiReadValidation';

/** BE-13 immutable review write and public Vet review page. */
export class HttpApiReviewRepository implements ApiReviewRepository {
  constructor(private readonly api: ApiClient) {}

  async getForConsultation(consultationId: string): Promise<ApiConsultationReview | null> {
    const id = resourceId(consultationId);
    try {
      const value = await this.api.request<unknown>(`/v1/consultations/${id}/review`);
      if (!isRecord(value) || value.consultationId !== consultationId) throw invalidResponse('Ulasan tidak sesuai konsultasi.');
      return { ...parseReview(value), consultationId };
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  async create(consultationId: string, input: { stars: number; text?: string }): Promise<ApiConsultationReview> {
    const id = resourceId(consultationId);
    if (!isRecord(input) || !Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5
      || (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 1000)))
      throw invalidQuery('Bintang harus 1–5 dan komentar maksimal 1.000 karakter.');
    const body = { stars: input.stars, ...(input.text === undefined ? {} : { text: input.text }) };
    const value = await this.api.request<unknown>(`/v1/consultations/${id}/review`, { method: 'POST', body });
    if (!isRecord(value) || value.consultationId !== consultationId) throw invalidResponse('Ulasan tidak sesuai konsultasi.');
    return { ...parseReview(value), consultationId };
  }

  async listForVet(vetId: string, query: { cursor?: string; limit?: number } = {}) {
    const id = resourceId(vetId);
    validateOpaqueCursor(query.cursor, 'ulasan');
    validatePageLimit(query.limit, 'ulasan');
    const params = new URLSearchParams();
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return parseReadPage(await this.api.request<unknown>(`/v1/vets/${id}/reviews${params.size ? `?${params.toString()}` : ''}`),
      parseReview, 'ulasan');
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID server harus UUID.');
  return encodeURIComponent(value);
}

function parseReview(value: unknown): ApiReview {
  if (!isRecord(value) || !isUuid(value.id) || !Number.isInteger(value.stars)
    || Number(value.stars) < 1 || Number(value.stars) > 5
    || !(value.text === null || (typeof value.text === 'string' && value.text.length <= 1000))
    || !isIsoTimestampWithTimezone(value.submittedAt)) throw invalidResponse('Ulasan tidak sesuai kontrak BE-13.');
  return { id: value.id, stars: value.stars as number, text: value.text as string | null,
    submittedAt: value.submittedAt };
}
