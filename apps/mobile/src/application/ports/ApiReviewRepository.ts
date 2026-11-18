import type { ReadPage } from '../../data/remote/apiReadValidation';

export interface ApiReview {
  id: string;
  stars: number;
  text: string | null;
  submittedAt: string;
}

export interface ApiConsultationReview extends ApiReview {
  consultationId: string;
}

export interface ApiReviewRepository {
  create(consultationId: string, input: { stars: number; text?: string }): Promise<ApiConsultationReview>;
  listForVet(vetId: string, query?: { cursor?: string; limit?: number }): Promise<ReadPage<ApiReview>>;
}
