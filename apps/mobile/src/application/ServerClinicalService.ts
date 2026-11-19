import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type {
  ApiClinicalNote,
  ApiClinicalNoteInput,
  ApiClinicalRepository,
  ApiRecommendation,
  ApiRecommendationInput,
} from './ports/ApiClinicalRepository';

const noteLimits = { complaint: 4000, findings: 8000, assessment: 8000, actions: 8000, careInstructions: 8000 } as const;

/** Keeps server clinical reads and writes behind role-specific application operations. */
export class ServerClinicalService {
  constructor(private readonly repository: ApiClinicalRepository) {}

  async getNote(role: AccountRole, consultationId: string): Promise<ApiClinicalNote | null> {
    this.requireServiceRole(role);
    try {
      const note = await this.repository.getNote(consultationId);
      if (role === 'farmer' && note.status !== 'final') {
        throw new DomainError('API_RESPONSE_INVALID', 'Server mengembalikan draft catatan klinis kepada Peternak.');
      }
      return note;
    } catch (cause) {
      if (role === 'farmer' && cause instanceof DomainError && cause.code === 'NOT_FOUND') return null;
      throw cause;
    }
  }

  async saveNote(role: AccountRole, consultationId: string, input: ApiClinicalNoteInput): Promise<ApiClinicalNote> {
    this.requireVet(role);
    this.requireVersion(input.expectedVersion);
    for (const [field, maximum] of Object.entries(noteLimits) as [keyof typeof noteLimits, number][]) {
      const value = input[field];
      if (value !== undefined && (typeof value !== 'string' || value.length > maximum)) {
        throw new DomainError('VALIDATION_FAILED', `Field ${field} catatan klinis melebihi batas.`);
      }
    }
    return this.repository.saveNote(consultationId, input);
  }

  async finalizeNote(role: AccountRole, consultationId: string, expectedVersion: number): Promise<ApiClinicalNote> {
    this.requireVet(role);
    this.requireVersion(expectedVersion);
    return this.repository.finalizeNote(consultationId, expectedVersion);
  }

  async getRecommendation(role: AccountRole, consultationId: string): Promise<ApiRecommendation | null> {
    this.requireServiceRole(role);
    try {
      const recommendation = await this.repository.getRecommendation(consultationId);
      if (role === 'farmer' && recommendation.status !== 'sent') {
        throw new DomainError('API_RESPONSE_INVALID', 'Server mengembalikan draft rekomendasi kepada Peternak.');
      }
      return recommendation;
    } catch (cause) {
      if (role === 'farmer' && cause instanceof DomainError && cause.code === 'NOT_FOUND') return null;
      throw cause;
    }
  }

  async saveRecommendation(role: AccountRole, consultationId: string, input: ApiRecommendationInput): Promise<ApiRecommendation> {
    this.requireVet(role);
    this.requireVersion(input.expectedVersion);
    if (!Array.isArray(input.items) || input.items.length > 50) {
      throw new DomainError('VALIDATION_FAILED', 'Rekomendasi harus memuat paling banyak 50 item.');
    }
    for (const item of input.items) {
      if (!item || typeof item !== 'object'
        || (item.title !== undefined && (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160))
        || (item.instructions !== undefined && (typeof item.instructions !== 'string' || item.instructions.length > 2000))
        || (item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 2000))
        || (item.productId === undefined && item.title === undefined)) {
        throw new DomainError('VALIDATION_FAILED', 'Judul dan isi item rekomendasi tidak valid.');
      }
    }
    return this.repository.saveRecommendation(consultationId, input);
  }

  async sendRecommendation(role: AccountRole, consultationId: string, expectedVersion: number): Promise<ApiRecommendation> {
    this.requireVet(role);
    this.requireVersion(expectedVersion);
    return this.repository.sendRecommendation(consultationId, expectedVersion);
  }

  private requireServiceRole(role: AccountRole): void {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membaca layanan klinis.');
  }

  private requireVet(role: AccountRole): void {
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter yang dapat mengubah catatan dan rekomendasi.');
  }

  private requireVersion(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('VALIDATION_FAILED', 'Versi data tidak valid.');
  }
}
