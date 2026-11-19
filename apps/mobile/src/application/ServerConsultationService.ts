import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationDetail, ApiConsultationListItem, ApiConsultationRepository, ApiConsultationVisit } from './ports/ApiConsultationRepository';

/** Read-only consultation view; the API scopes rows to farmer ownership or vet assignment. */
export class ServerConsultationService {
  constructor(private readonly consultations: ApiConsultationRepository) {}

  async list(role: AccountRole): Promise<ApiConsultationListItem[]> {
    this.requireServiceRole(role);
    const rows = await this.consultations.list();
    const ids = new Set<string>();
    for (const row of rows) {
      if (ids.has(row.id)) throw new DomainError('API_RESPONSE_INVALID', 'Daftar konsultasi server memuat ID ganda.');
      ids.add(row.id);
    }
    return rows;
  }

  async getDetail(role: AccountRole, consultationId: string): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit | null }> {
    this.requireServiceRole(role);
    const consultation = await this.consultations.getById(consultationId);
    if (consultation.id !== consultationId) throw new DomainError('API_RESPONSE_INVALID', 'Detail konsultasi server tidak sesuai ID yang diminta.');
    const visit = consultation.serviceType === 'visit' ? await this.consultations.getVisit(consultation.id) : null;
    return { consultation, visit };
  }

  private requireServiceRole(role: AccountRole): void {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membaca konsultasi.');
  }
}
