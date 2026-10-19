import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { validateReviewInput, type ReviewInput } from '../domain/reviews';
import type { BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { IdFactory } from './ports/AuthRepository';
import type { ProfileService } from './ProfileService';

export type ReviewContext = {
  consultation: DomainEntity;
  veterinarianName: string;
  review: DomainEntity | null;
};

export class ReviewService {
  constructor(
    private readonly storage: BookingRepository,
    private readonly profiles: Pick<ProfileService, 'load'>,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole, consultationId: string): Promise<ReviewContext> {
    return this.context(this.storage.read, userId, role, consultationId);
  }

  async submit(
    userId: string,
    role: AccountRole,
    consultationId: string,
    stars: number,
    text: string,
  ): Promise<ReviewContext> {
    const input = validateReviewInput(stars, text);
    return this.storage.transaction(async (unit) => {
      const context = await this.context(unit, userId, role, consultationId);
      if (context.review) {
        if (sameReview(context.review, input)) return context;
        throw new DomainError('IMMUTABLE_RECORD', 'Ulasan untuk layanan ini sudah tersimpan.');
      }

      const timestamp = this.now().toISOString();
      const reviewId = this.ids.create();
      const review: DomainEntity = {
        id: reviewId,
        kind: 'review',
        ownerId: userId,
        contextId: consultationId,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        payload: {
          consultationId,
          farmerId: userId,
          vetId: String(context.consultation.payload.vetId),
          ...input,
          submittedAt: timestamp,
          operationKey: `review:${consultationId}`,
        },
      };
      const relations: EntityRelation[] = [
        { sourceId: reviewId, relationship: 'consultation', targetId: consultationId },
        { sourceId: reviewId, relationship: 'farmer', targetId: userId },
        { sourceId: reviewId, relationship: 'veterinarian', targetId: String(context.consultation.payload.vetId) },
      ];
      await unit.repository.create(review, relations);
      return { ...context, review };
    });
  }

  private async context(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string): Promise<ReviewContext> {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak pemilik layanan yang dapat memberi ulasan.');
    await this.profiles.load(userId, 'farmer');

    const repository = unit.repository;
    const consultation = await repository.findById('consultation', consultationId);
    if (!consultation) throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    if (consultation.ownerId !== userId || consultation.payload.farmerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Anda hanya dapat mengulas layanan milik akun sendiri.');
    }
    if (consultation.payload.status !== 'completed') {
      throw new DomainError('INVALID_STATE', 'Ulasan tersedia setelah layanan selesai.');
    }

    const vetId = typeof consultation.payload.vetId === 'string' ? consultation.payload.vetId : '';
    if (!vetId) throw new DomainError('INVALID_STATE', 'Dokter pada layanan ini tidak valid.');
    const [farmers, veterinarians, veterinarian, byKind, byRelation] = await Promise.all([
      repository.listRelated('consultation', consultationId, 'farmer'),
      repository.listRelated('consultation', consultationId, 'veterinarian'),
      repository.findById('user', vetId),
      repository.listByKind('review'),
      repository.listByRelated('review', consultationId, 'consultation'),
    ]);
    if (farmers.length !== 1 || farmers[0].id !== userId || veterinarians.length !== 1 || veterinarians[0].id !== vetId
      || !Array.isArray(veterinarian?.payload.roles) || !veterinarian.payload.roles.includes('vet')) {
      throw new DomainError('INVALID_STATE', 'Relasi Peternak atau Dokter pada layanan tidak valid.');
    }

    const existingReviews = new Map<string, DomainEntity>();
    for (const record of byKind) {
      if (record.payload.consultationId === consultationId || record.contextId === consultationId) existingReviews.set(record.id, record);
    }
    for (const record of byRelation) existingReviews.set(record.id, record);
    if (existingReviews.size > 1) throw new DomainError('INVALID_STATE', 'Layanan ini memiliki lebih dari satu ulasan tersimpan.');
    const review = [...existingReviews.values()][0] ?? null;
    if (review && (review.ownerId !== userId || review.payload.consultationId !== consultationId || review.payload.farmerId !== userId || review.payload.vetId !== vetId
      || !Number.isInteger(review.payload.stars) || Number(review.payload.stars) < 1 || Number(review.payload.stars) > 5
      || typeof review.payload.text !== 'string')) {
      throw new DomainError('INVALID_STATE', 'Ulasan tersimpan tidak sesuai dengan layanan ini.');
    }
    return {
      consultation,
      veterinarianName: typeof veterinarian.payload.name === 'string' ? veterinarian.payload.name : 'Dokter Hewan',
      review,
    };
  }
}

function sameReview(review: DomainEntity, input: ReviewInput): boolean {
  return review.payload.stars === input.stars && review.payload.text === input.text;
}
