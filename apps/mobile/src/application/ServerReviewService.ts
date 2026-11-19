import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import { validateReviewInput } from '../domain/reviews';
import type { ApiConsultationReview, ApiReviewRepository } from './ports/ApiReviewRepository';
import type { ApiConsultationDetail } from './ports/ApiConsultationRepository';

/** Server reviews are immutable and can only be read or written by their Farmer owner. */
export class ServerReviewService {
  constructor(private readonly repository: ApiReviewRepository) {}

  async load(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<ApiConsultationReview | null> {
    assertEligibleOwner(role, userId, consultation);
    const review = await this.repository.getForConsultation(consultation.id);
    if (review) assertReview(review, consultation.id);
    return review;
  }

  async submit(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    stars: number,
    text: string,
  ): Promise<ApiConsultationReview> {
    assertEligibleOwner(role, userId, consultation);
    const input = validateReviewInput(stars, text);
    const existing = await this.repository.getForConsultation(consultation.id);
    if (existing) {
      assertReview(existing, consultation.id);
      if (existing.stars === input.stars && normalizeText(existing.text) === input.text) return existing;
      throw new DomainError('IMMUTABLE_RECORD', 'Ulasan untuk layanan ini sudah tersimpan.');
    }

    const saved = await this.repository.create(consultation.id, {
      stars: input.stars,
      ...(input.text ? { text: input.text } : {}),
    });
    assertReview(saved, consultation.id);
    if (saved.stars !== input.stars || normalizeText(saved.text) !== input.text) {
      throw new DomainError('API_RESPONSE_INVALID', 'Ulasan yang tersimpan berbeda dari isi yang dikirim.');
    }
    return saved;
  }
}

function assertEligibleOwner(role: AccountRole, userId: string, consultation: ApiConsultationDetail): void {
  if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak yang dapat membaca atau memberi ulasan.');
  if (!userId || consultation.farmerId !== userId) throw new DomainError('FORBIDDEN', 'Ulasan hanya tersedia bagi Peternak pemilik layanan.');
  if (consultation.status !== 'completed') throw new DomainError('INVALID_STATE', 'Ulasan tersedia setelah layanan selesai.');
}

function assertReview(review: ApiConsultationReview, consultationId: string): void {
  if (!review || review.consultationId !== consultationId || !review.id
    || !Number.isInteger(review.stars) || review.stars < 1 || review.stars > 5
    || !(review.text === null || typeof review.text === 'string')
    || !Number.isFinite(Date.parse(review.submittedAt))) {
    throw new DomainError('API_RESPONSE_INVALID', 'Ulasan server tidak cocok dengan konsultasi.');
  }
}

function normalizeText(value: string | null): string {
  return value?.trim() ?? '';
}
