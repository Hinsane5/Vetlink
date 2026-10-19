import { DomainError } from './errors';

export const reviewTextLimit = 1000;

export type ReviewInput = { stars: number; text: string };

export function validateReviewInput(stars: unknown, text: unknown): ReviewInput {
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new DomainError('VALIDATION_FAILED', 'Pilih rating 1 sampai 5 bintang.');
  }
  if (typeof text !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'Ulasan harus berupa teks.');
  }
  if (text.length > reviewTextLimit) {
    throw new DomainError('VALIDATION_FAILED', `Ulasan maksimal ${reviewTextLimit} karakter.`);
  }
  return { stars, text: text.trim() };
}
