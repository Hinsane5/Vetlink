import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationDetail, ApiConsultationListItem, ApiConsultationRepository, ApiConsultationVisit, ApiVisitStage } from './ports/ApiConsultationRepository';
import type { ApiClinicalNote } from './ports/ApiClinicalRepository';

/** Reads server-scoped consultations and applies guarded Visit actions. */
export class ServerConsultationService {
  private readonly visitLocks = new Set<string>();

  constructor(private readonly consultations: ApiConsultationRepository, private readonly createId: () => string = () => '') {}

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

  async advanceVisit(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    visit: ApiConsultationVisit,
    action: 'depart' | 'arrive' | 'start-examination',
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit }> {
    this.requireServiceRole(role);
    const fromStages: Record<typeof action, ApiVisitStage> = { depart: 'scheduled', arrive: 'en_route', 'start-examination': 'arrived' };
    const toStages: Record<typeof action, ApiVisitStage> = { depart: 'en_route', arrive: 'arrived', 'start-examination': 'examining' };
    if (role !== 'vet' || consultation.vetId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat memperbarui kunjungan.');
    if (consultation.serviceType !== 'visit' || consultation.status !== 'scheduled' || consultation.paymentStatus !== 'succeeded'
      || !visit || visit.consultationId !== consultation.id || visit.stage !== fromStages[action]
      || !Number.isSafeInteger(consultation.version) || !Number.isSafeInteger(visit.version)) {
      throw new DomainError('INVALID_STATE', 'Tahap kunjungan berubah atau belum memenuhi syarat untuk dilanjutkan.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.visitLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan tahap kunjungan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci tindakan kunjungan tidak valid.');
    this.visitLocks.add(lockKey);
    try {
      const result = await this.consultations.advanceVisit(consultation.id, action, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version, expectedVisitVersion: visit.version },
      });
      if (result.consultation.id !== consultation.id || result.visit && result.visit.stage !== toStages[action])
        throw new DomainError('API_RESPONSE_INVALID', 'Respons tahap kunjungan tidak sesuai tindakan.');
      const current = await this.getDetail(role, consultation.id);
      if (!current.visit || current.visit.stage !== toStages[action] || current.visit.version <= visit.version
        || (action === 'start-examination' ? current.consultation.status !== 'in_progress' : current.consultation.status !== 'scheduled')) {
        throw new DomainError('API_RESPONSE_INVALID', 'Tahap kunjungan terbaru belum sesuai hasil tindakan server.');
      }
      return { consultation: current.consultation, visit: current.visit };
    } finally { this.visitLocks.delete(lockKey); }
  }

  async completeVisit(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    visit: ApiConsultationVisit,
    note: ApiClinicalNote,
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit }> {
    this.requireServiceRole(role);
    if (role !== 'vet' || consultation.vetId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat menyelesaikan kunjungan.');
    if (consultation.serviceType !== 'visit' || consultation.status !== 'in_progress' || consultation.paymentStatus !== 'succeeded'
      || !visit || visit.consultationId !== consultation.id || visit.stage !== 'examining'
      || note.consultationId !== consultation.id || note.status !== 'final' || !note.id || !isTimestamp(note.finalizedAt)
      || !Number.isSafeInteger(consultation.version) || !Number.isSafeInteger(visit.version)) {
      throw new DomainError('INVALID_STATE', 'Kunjungan memerlukan pembayaran berhasil, tahap pemeriksaan, dan catatan final.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.visitLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan tahap kunjungan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci penyelesaian kunjungan tidak valid.');
    this.visitLocks.add(lockKey);
    try {
      const result = await this.consultations.complete(consultation.id, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version, expectedVisitVersion: visit.version, confirmation: true },
      });
      if (result.consultation.id !== consultation.id || result.consultation.status !== 'completed')
        throw new DomainError('API_RESPONSE_INVALID', 'Respons penyelesaian tidak sesuai layanan.');
      const current = await this.getDetail(role, consultation.id);
      if (current.consultation.status !== 'completed' || !isTimestamp(current.consultation.completionAt)
        || !current.visit || current.visit.stage !== 'completed' || current.visit.version <= visit.version) {
        throw new DomainError('API_RESPONSE_INVALID', 'Status terbaru server belum menunjukkan kunjungan selesai.');
      }
      return { consultation: current.consultation, visit: current.visit };
    } finally { this.visitLocks.delete(lockKey); }
  }

  private requireServiceRole(role: AccountRole): void {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membaca konsultasi.');
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: string | null): boolean {
  return value !== null && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}
