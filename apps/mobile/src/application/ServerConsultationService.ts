import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationDetail, ApiConsultationListItem, ApiConsultationRepository, ApiConsultationVisit, ApiVisitStage } from './ports/ApiConsultationRepository';
import type { ApiClinicalNote } from './ports/ApiClinicalRepository';

/** Reads server-scoped consultations and applies guarded service actions. */
export class ServerConsultationService {
  private readonly actionLocks = new Set<string>();

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

  async respondToRequest(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    action: 'accept' | 'reject',
    reason = '',
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit | null }> {
    this.requireServiceRole(role);
    if (role !== 'vet' || consultation.vetId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat merespons permintaan layanan.');
    if (action !== 'accept' && action !== 'reject')
      throw new DomainError('VALIDATION_FAILED', 'Respons permintaan tidak dikenal.');
    const normalizedReason = reason.trim();
    if (consultation.status !== 'requested' || consultation.paymentStatus !== 'succeeded'
      || !Number.isSafeInteger(consultation.version)
      || (action === 'reject' && (normalizedReason.length < 3 || normalizedReason.length > 1000))) {
      throw new DomainError('INVALID_STATE', 'Permintaan layanan berubah atau alasan penolakan belum memenuhi batas.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan layanan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci respons layanan tidak valid.');
    this.actionLocks.add(lockKey);
    try {
      const operation = { idempotencyKey, payload: { expectedVersion: consultation.version } } as const;
      const result = action === 'accept'
        ? await this.consultations.accept(consultation.id, operation)
        : await this.consultations.reject(consultation.id, { idempotencyKey, payload: { expectedVersion: consultation.version, reason: normalizedReason } });
      const expectedStatus = action === 'accept' ? 'scheduled' : 'rejected';
      if (result.consultation.id !== consultation.id || result.consultation.status !== expectedStatus)
        throw new DomainError('API_RESPONSE_INVALID', 'Respons Dokter tidak sesuai status permintaan.');
      const current = await this.getDetail(role, consultation.id);
      if (current.consultation.status !== expectedStatus || current.consultation.version <= consultation.version
        || (action === 'accept' && consultation.serviceType === 'visit' && current.visit?.stage !== 'scheduled')) {
        throw new DomainError('API_RESPONSE_INVALID', 'Status permintaan terbaru server belum sesuai hasil tindakan.');
      }
      return current;
    } finally { this.actionLocks.delete(lockKey); }
  }

  async cancel(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    reason: string,
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit | null }> {
    this.requireServiceRole(role);
    const normalizedReason = reason.trim();
    if (role !== 'farmer' || consultation.farmerId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Peternak pemilik layanan dapat membatalkan konsultasi.');
    if (!['requested', 'scheduled', 'reschedule_pending'].includes(consultation.status)
      || consultation.paymentStatus !== 'succeeded' || !Number.isSafeInteger(consultation.version)
      || normalizedReason.length < 3 || normalizedReason.length > 1000) {
      throw new DomainError('INVALID_STATE', 'Layanan berubah, belum dibayar, sudah dimulai, atau alasan pembatalan tidak valid.');
    }
    const visitMustBeScheduled = consultation.serviceType === 'visit'
      && (consultation.status === 'scheduled'
        || (consultation.status === 'reschedule_pending' && consultation.reschedulePreviousStatus === 'scheduled'));
    if (consultation.serviceType === 'visit'
      && ((visitMustBeScheduled && consultation.visitStage !== 'scheduled')
        || (consultation.visitStage !== null && consultation.visitStage !== 'scheduled'))) {
      throw new DomainError('INVALID_STATE', 'Kunjungan tidak dapat dibatalkan setelah Dokter mulai perjalanan atau pemeriksaan.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan layanan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci pembatalan layanan tidak valid.');
    this.actionLocks.add(lockKey);
    try {
      const result = await this.consultations.cancel(consultation.id, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version, reason: normalizedReason },
      });
      if (result.consultation.id !== consultation.id || result.consultation.status !== 'cancelled')
        throw new DomainError('API_RESPONSE_INVALID', 'Respons pembatalan tidak sesuai layanan.');
      const current = await this.getDetail(role, consultation.id);
      if (current.consultation.status !== 'cancelled' || current.consultation.version <= consultation.version
        || current.consultation.cancellationReason !== normalizedReason || current.consultation.refundStatus !== 'refund_needed') {
        throw new DomainError('API_RESPONSE_INVALID', 'Pembatalan atau status pengembalian terbaru server belum sesuai hasil tindakan.');
      }
      return current;
    } finally { this.actionLocks.delete(lockKey); }
  }

  async respondToProposal(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    proposalId: string,
    decision: 'accept' | 'decline',
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit | null }> {
    this.requireServiceRole(role);
    if (role !== 'farmer' || consultation.farmerId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Peternak pemilik layanan dapat merespons usulan jadwal.');
    const pendingProposals = consultation.proposals.filter((item) => item.status === 'pending');
    const proposal = pendingProposals.find((item) => item.id === proposalId);
    if (consultation.status !== 'reschedule_pending' || pendingProposals.length !== 1 || !proposal
      || !Number.isSafeInteger(consultation.version)) {
      throw new DomainError('INVALID_STATE', 'Usulan jadwal sudah tidak aktif atau layanan berubah.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan layanan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci respons jadwal tidak valid.');
    this.actionLocks.add(lockKey);
    try {
      const expectedStatus = decision === 'accept' ? 'scheduled' : proposal.previousStatus;
      const result = await this.consultations.respondScheduleProposal(consultation.id, proposal.id, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version, decision, consent: decision === 'accept' },
      });
      if (result.consultation.id !== consultation.id || result.consultation.status !== expectedStatus)
        throw new DomainError('API_RESPONSE_INVALID', 'Respons usulan jadwal tidak sesuai layanan.');
      const current = await this.getDetail(role, consultation.id);
      const updatedProposal = current.consultation.proposals.find((item) => item.id === proposal.id);
      if (current.consultation.status !== expectedStatus || current.consultation.version <= consultation.version || !updatedProposal
        || updatedProposal.status !== (decision === 'accept' ? 'accepted' : 'declined')
        || (decision === 'accept' && current.consultation.startsAt !== proposal.startsAt)) {
        throw new DomainError('API_RESPONSE_INVALID', 'Keputusan jadwal terbaru server belum sesuai hasil tindakan.');
      }
      return current;
    } finally { this.actionLocks.delete(lockKey); }
  }

  async proposeSchedule(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    startsAt: string,
  ): Promise<{ consultation: ApiConsultationDetail; visit: ApiConsultationVisit | null }> {
    this.requireServiceRole(role);
    if (role !== 'vet' || consultation.vetId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat mengusulkan waktu baru.');
    const pendingProposals = consultation.proposals.filter((item) => item.status === 'pending');
    if (!['requested', 'scheduled'].includes(consultation.status) || consultation.paymentStatus !== 'succeeded'
      || !Number.isSafeInteger(consultation.version) || pendingProposals.length > 0
      || !isTimestamp(startsAt) || Date.parse(startsAt) === Date.parse(consultation.startsAt)) {
      throw new DomainError('INVALID_STATE', 'Layanan berubah, belum dibayar, memiliki usulan aktif, atau waktu usulan tidak valid.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan layanan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci usulan jadwal tidak valid.');
    this.actionLocks.add(lockKey);
    try {
      const result = await this.consultations.proposeSchedule(consultation.id, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version, startsAt },
      });
      if (result.consultation.id !== consultation.id || result.consultation.status !== 'reschedule_pending')
        throw new DomainError('API_RESPONSE_INVALID', 'Respons usulan jadwal tidak sesuai layanan.');
      const current = await this.getDetail(role, consultation.id);
      const pending = current.consultation.proposals.filter((item) => item.status === 'pending');
      if (current.consultation.status !== 'reschedule_pending' || current.consultation.version <= consultation.version
        || pending.length !== 1 || Date.parse(pending[0].startsAt) !== Date.parse(startsAt)) {
        throw new DomainError('API_RESPONSE_INVALID', 'Usulan jadwal terbaru server belum sesuai waktu yang diminta.');
      }
      return current;
    } finally { this.actionLocks.delete(lockKey); }
  }

  async startChat(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<ApiConsultationDetail> {
    this.requireServiceRole(role);
    if (role !== 'vet' || consultation.vetId !== userId)
      throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat memulai layanan chat.');
    if (consultation.serviceType !== 'chat' || consultation.status !== 'scheduled' || consultation.paymentStatus !== 'succeeded'
      || !Number.isSafeInteger(consultation.version)) {
      throw new DomainError('INVALID_STATE', 'Chat hanya dapat dimulai untuk layanan terjadwal yang sudah dibayar.');
    }
    const lockKey = `${userId}:${consultation.id}`;
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan layanan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci mulai chat tidak valid.');
    this.actionLocks.add(lockKey);
    try {
      const result = await this.consultations.startChat(consultation.id, {
        idempotencyKey,
        payload: { expectedVersion: consultation.version },
      });
      if (result.consultation.id !== consultation.id || result.consultation.status !== 'in_progress')
        throw new DomainError('API_RESPONSE_INVALID', 'Respons mulai chat tidak sesuai layanan.');
      const current = await this.getDetail(role, consultation.id);
      if (current.consultation.status !== 'in_progress' || current.consultation.version <= consultation.version)
        throw new DomainError('API_RESPONSE_INVALID', 'Status chat terbaru server belum berubah menjadi berlangsung.');
      return current.consultation;
    } finally { this.actionLocks.delete(lockKey); }
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
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan tahap kunjungan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci tindakan kunjungan tidak valid.');
    this.actionLocks.add(lockKey);
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
    } finally { this.actionLocks.delete(lockKey); }
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
    if (this.actionLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Perubahan tahap kunjungan sedang berlangsung.');
    const idempotencyKey = this.createId();
    if (!isUuid(idempotencyKey)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci penyelesaian kunjungan tidak valid.');
    this.actionLocks.add(lockKey);
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
    } finally { this.actionLocks.delete(lockKey); }
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
