import type { BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { AttachmentMedia } from './ports/ProfileRepository';
import type { IdFactory } from './ports/AuthRepository';
import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityKind } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { assertVisitTransition, type VisitStage } from '../domain/policies';
import { projectDirectorySlots } from '../domain/directory';
import type { ConsultationCommand, ConsultationDetail, ProposalInput, VisitAction, VisitCommand } from '../domain/consultations';
import { ProfileService } from './ProfileService';
import { VetDirectoryService } from './VetDirectoryService';

/** All status, proposal, visit and audit writes share the booking transaction queue. */
export class ConsultationService {
  constructor(private readonly storage: BookingRepository, private readonly media: AttachmentMedia, private readonly ids: IdFactory, private readonly now: () => Date = () => new Date()) {}

  async list(userId: string, role: AccountRole): Promise<ConsultationDetail[]> {
    await this.profile(this.storage.read, userId, role);
    const repo = this.storage.read.repository;
    const records = role === 'farmer' ? await repo.listByOwner('consultation', userId) : await repo.listByRelated('consultation', userId, 'veterinarian');
    const visible = records.filter((item) => role === 'farmer' || !['draft', 'awaiting_payment'].includes(String(item.payload.status)));
    return Promise.all(visible.sort((a, b) => String(b.payload.startsAt).localeCompare(String(a.payload.startsAt))).map((item) => this.detail(userId, role, item.id)));
  }

  async detail(userId: string, role: AccountRole, id: string): Promise<ConsultationDetail> {
    const unit = this.storage.read;
    const record = await this.access(unit, userId, role, id);
    const repo = unit.repository;
    const [animal, other, vet, proposals, visits, history, attachments, paid, availability] = await Promise.all([
      repo.findById('livestock', String(record.payload.animalId)),
      repo.findById('user', String(role === 'farmer' ? record.payload.vetId : record.payload.farmerId)),
      this.profile(unit, String(record.payload.vetId), 'vet'),
      repo.listByRelated('scheduleProposal', id, 'consultation'), repo.listByRelated('visit', id, 'consultation'),
      repo.listByRelated('consultationAction', id, 'consultation'), repo.listRelated('consultation', id, 'attachment'), this.paid(unit, record), repo.listByOwner('availability', String(record.payload.vetId)),
    ]);
    const media: DomainEntity[] = [];
    for (const item of attachments) {
      if (item.kind !== 'attachment' || item.ownerId !== record.ownerId || item.payload.uploadStatus !== 'local' || !['image', 'video'].includes(String(item.payload.kind)) || !String(item.payload.mimeType).startsWith(`${String(item.payload.kind)}/`) || !String(item.payload.localUri).startsWith('file://')) continue;
      if (!Array.isArray(record.payload.attachmentIds) || !record.payload.attachmentIds.includes(item.id)) continue;
      const draft = item.contextId ? await repo.findById('bookingDraft', item.contextId) : null;
      if (item.contextId !== record.id && (!draft || draft.ownerId !== record.ownerId || draft.payload.status !== 'submitted' || draft.payload.consultationId !== record.id)) continue;
      media.push(item);
    }
    availability.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version);
    const timezone = validTimezone(record.payload.timezone ?? availability[0]?.payload.timezone);
    return {
      record, timezone, animalName: String(animal?.payload.name ?? 'Ternak'), otherPartyName: String(other?.payload.name ?? 'Akun'), verified: vet.verificationStatus === 'verified', paid,
      proposal: proposals.find((item) => item.payload.status === 'pending' && item.ownerId === record.payload.vetId && item.payload.consultationId === id) ?? null,
      visit: visits.find((item) => item.ownerId === record.payload.vetId && item.payload.consultationId === id) ?? null,
      history: history.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
      attachments: media.map((item) => ({ id: item.id, filename: String(item.payload.filename), kind: String(item.payload.kind), localUri: String(item.payload.localUri) })),
    };
  }

  async slots(userId: string, id: string) {
    const record = await this.access(this.storage.read, userId, 'vet', id);
    return this.availableSlots(this.storage.read, record);
  }

  async draft(userId: string, id: string): Promise<DomainEntity | null> {
    await this.access(this.storage.read, userId, 'vet', id);
    return (await this.storage.read.repository.listByOwner('consultationDraft', userId)).find((item) => item.contextId === id && item.payload.status === 'draft') ?? null;
  }

  async saveDraft(userId: string, id: string, draft: DomainEntity | null, input: ProposalInput): Promise<DomainEntity> {
    if (input.reason.length > 1000) throw new DomainError('VALIDATION_FAILED', 'Alasan maksimal 1.000 karakter.');
    return this.storage.transaction(async (unit) => {
      const record = await this.access(unit, userId, 'vet', id);
      await this.editable(unit, record);
      const current = (await unit.repository.listByOwner('consultationDraft', userId)).find((item) => item.contextId === id && item.payload.status === 'draft');
      if (current && (current.id !== draft?.id || current.version !== draft.version)) throw new DomainError('VERSION_CONFLICT', 'Draft sudah berubah. Buka kembali formulir.');
      if (draft && !current) throw new DomainError('VERSION_CONFLICT', 'Draft sudah tidak aktif.');
      const next = current ? this.updated(current, { input }) : this.entity('consultationDraft', userId, id, { status: 'draft', input });
      if (current) await unit.repository.update(next, current.version); else await unit.repository.create(next, [{ sourceId: next.id, targetId: id, relationship: 'consultation' }]);
      return next;
    });
  }

  async discardDraft(userId: string, id: string, draft: DomainEntity | null): Promise<void> {
    await this.storage.transaction(async (unit) => {
      await this.access(unit, userId, 'vet', id);
      if (!draft) return;
      const current = await unit.repository.findById('consultationDraft', draft.id);
      if (!current || current.ownerId !== userId || current.contextId !== id) throw new DomainError('FORBIDDEN', 'Draft tidak dapat diakses.');
      if (current.version !== draft.version) throw new DomainError('VERSION_CONFLICT', 'Draft sudah berubah.');
      await unit.repository.update(this.updated(current, { status: 'discarded' }), current.version);
    });
  }

  async act(userId: string, role: AccountRole, command: ConsultationCommand): Promise<void> {
    await this.storage.transaction(async (unit) => {
      const record = await this.access(unit, userId, role, command.id);
      const fingerprint = JSON.stringify({ ...command, reason: command.reason?.trim() });
      if (!command.operationKey.trim() || command.operationKey.length > 200) throw new DomainError('VALIDATION_FAILED', 'Identitas tindakan tidak valid.');
      const prior = (await unit.repository.listByKind('consultationAction')).find((item) => item.payload.operationKey === command.operationKey);
      if (prior) {
        if (prior.ownerId !== userId || prior.contextId !== record.id || prior.payload.fingerprint !== fingerprint || prior.payload.role !== role) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Tindakan ini sudah digunakan untuk perubahan lain.');
        return;
      }
      if (record.version !== command.version) throw new DomainError('VERSION_CONFLICT', 'Layanan sudah berubah. Muat ulang sebelum melanjutkan.');
      const status = String(record.payload.status);
      const doctorAction = ['accept', 'reject', 'propose'].includes(command.action);
      if (doctorAction ? role !== 'vet' : role !== 'farmer') throw new DomainError('FORBIDDEN', 'Peran ini tidak dapat melakukan tindakan tersebut.');
      if (doctorAction && (await this.profile(unit, userId, 'vet')).verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi.');
      const pending = (await unit.repository.listByRelated('scheduleProposal', record.id, 'consultation')).filter((item) => item.payload.status === 'pending');
      const paid = await this.paid(unit, record);
      if (command.action !== 'cancel' && !paid) throw new DomainError('INVALID_STATE', 'Pembayaran layanan belum berhasil.');
      let nextStatus = status;
      const changes: Record<string, unknown> = {};
      if (!record.payload.timezone) {
        const availability = await unit.repository.listByOwner('availability', String(record.payload.vetId));
        availability.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version);
        changes.timezone = validTimezone(availability[0]?.payload.timezone);
      }
      let reason = command.reason?.trim() ?? '';
      if (['reject', 'propose', 'cancel'].includes(command.action) && (reason.length < 3 || reason.length > 1000)) throw new DomainError('VALIDATION_FAILED', 'Alasan harus berisi 3–1.000 karakter.');
      if (command.action === 'accept' || command.action === 'reject') {
        if (status !== 'requested' || pending.length) throw new DomainError('INVALID_STATE', 'Permintaan sudah tidak dapat ditanggapi.');
        await this.editable(unit, record);
        if (command.action === 'accept') {
          await this.validateSlot(unit, record, String(record.payload.startsAt), String(record.payload.endsAt));
          nextStatus = 'scheduled';
        } else { nextStatus = 'rejected'; changes.rejectionReason = reason; }
      } else if (command.action === 'propose') {
        await this.editable(unit, record);
        if (pending.length) throw new DomainError('INVALID_STATE', 'Tunggu respons Peternak pada usulan sebelumnya.');
        await this.validateSlot(unit, record, command.startsAt ?? '', command.endsAt ?? '');
        if (command.startsAt === record.payload.startsAt && command.endsAt === record.payload.endsAt) throw new DomainError('VALIDATION_FAILED', 'Pilih waktu berbeda dari jadwal saat ini.');
        const proposal = this.entity('scheduleProposal', userId, record.id, { consultationId: record.id, proposedByVetId: userId, previousStatus: status, status: 'pending', startsAt: command.startsAt, endsAt: command.endsAt, reason });
        await unit.repository.create(proposal, [{ sourceId: proposal.id, targetId: record.id, relationship: 'consultation' }]);
        nextStatus = 'reschedule_pending';
        changes.previousStatus = status;
        for (const draft of await unit.repository.listByOwner('consultationDraft', userId)) {
          if (draft.contextId === record.id && draft.payload.status === 'draft') await unit.repository.update(this.updated(draft, { status: 'submitted' }), draft.version);
        }
      } else if (command.action === 'approve' || command.action === 'decline') {
        // FE-02 legacy fixtures attach a pending proposal to a scheduled appointment.
        if (!['reschedule_pending', 'scheduled'].includes(status) || pending.length !== 1 || pending[0].id !== command.proposalId) throw new DomainError('INVALID_STATE', 'Usulan sudah ditanggapi atau tidak tersedia.');
        await this.notStarted(unit, record);
        const proposal = pending[0];
        if (proposal.ownerId !== record.payload.vetId || proposal.payload.consultationId !== record.id) throw new DomainError('FORBIDDEN', 'Usulan bukan milik dokter layanan.');
        const previous = String(proposal.payload.previousStatus ?? record.payload.previousStatus ?? 'scheduled');
        if (!['requested', 'scheduled'].includes(previous)) throw new DomainError('INVALID_STATE', 'Status awal usulan tidak valid.');
        if (command.action === 'approve') {
          await this.validateSlot(unit, record, String(proposal.payload.startsAt), String(proposal.payload.endsAt));
          changes.startsAt = proposal.payload.startsAt; changes.endsAt = proposal.payload.endsAt;
          nextStatus = 'scheduled';
        } else { nextStatus = previous; }
        reason = String(proposal.payload.reason);
        await unit.repository.update(this.updated(proposal, { status: command.action === 'approve' ? 'accepted' : 'declined', respondedAt: this.now().toISOString(), respondedBy: userId }), proposal.version);
        changes.previousStatus = null;
      } else if (command.action === 'cancel') {
        if (!['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending'].includes(status)) throw new DomainError('INVALID_STATE', 'Layanan ini sudah tidak dapat dibatalkan.');
        await this.notStarted(unit, record);
        for (const proposal of pending) await unit.repository.update(this.updated(proposal, { status: 'superseded' }), proposal.version);
        nextStatus = 'cancelled'; changes.cancellationReason = reason;
      } else { throw new DomainError('VALIDATION_FAILED', 'Tindakan tidak dikenal.'); }
      if (['rejected', 'cancelled'].includes(nextStatus) && paid) changes.refundStatus = 'refund_needed';
      if (nextStatus === 'scheduled' && record.payload.type === 'visit') {
        const visits = await unit.repository.listByRelated('visit', record.id, 'consultation');
        if (!visits.length) {
          const visit = this.entity('visit', String(record.payload.vetId), record.id, { consultationId: record.id, stage: 'scheduled', departureAt: null, arrivalAt: null, examinationStartedAt: null });
          await unit.repository.create(visit, [{ sourceId: visit.id, targetId: record.id, relationship: 'consultation' }]);
        }
      }
      await unit.repository.update(this.updated(record, { ...changes, status: nextStatus }), record.version);
      const audit = this.entity('consultationAction', userId, record.id, { operationKey: command.operationKey, fingerprint, role, action: command.action, fromStatus: status, toStatus: nextStatus, reason, startsAt: changes.startsAt ?? command.startsAt ?? record.payload.startsAt, endsAt: changes.endsAt ?? command.endsAt ?? record.payload.endsAt });
      await unit.repository.create(audit, [{ sourceId: audit.id, targetId: record.id, relationship: 'consultation' }]);
    });
  }

  async advanceVisit(userId: string, role: AccountRole, command: VisitCommand): Promise<void> {
    await this.storage.transaction(async (unit) => {
      const record = await this.access(unit, userId, role, command.consultationId);
      if (role !== 'vet' || record.payload.type !== 'visit') throw new DomainError('FORBIDDEN', 'Hanya dokter yang ditugaskan dapat memperbarui kunjungan.');
      if ((await this.profile(unit, userId, 'vet')).verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi sebelum memulai kunjungan.');
      if (!await this.paid(unit, record)) throw new DomainError('INVALID_STATE', 'Pembayaran kunjungan belum berhasil.');
      const address = typeof record.payload.visitAddressSnapshot === 'string' ? record.payload.visitAddressSnapshot.trim() : '';
      if (!address) throw new DomainError('INVALID_STATE', 'Alamat kunjungan belum tersimpan pada booking.');
      if (!command.operationKey.trim() || command.operationKey.length > 200) throw new DomainError('VALIDATION_FAILED', 'Identitas tindakan tidak valid.');

      const visits = await unit.repository.listByRelated('visit', record.id, 'consultation');
      if (visits.length !== 1 || visits[0].ownerId !== userId || visits[0].payload.consultationId !== record.id) throw new DomainError('FORBIDDEN', 'Data kunjungan tidak terkait dengan dokter layanan.');
      const visit = visits[0];
      const fingerprint = JSON.stringify(command);
      const prior = (await unit.repository.listByKind('consultationAction')).find((item) => item.payload.operationKey === command.operationKey);
      if (prior) {
        if (prior.ownerId !== userId || prior.contextId !== record.id || prior.payload.fingerprint !== fingerprint || prior.payload.role !== role) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Tindakan ini sudah digunakan untuk perubahan lain.');
        return;
      }
      if (record.version !== command.consultationVersion || visit.version !== command.visitVersion) throw new DomainError('VERSION_CONFLICT', 'Progres kunjungan sudah berubah. Muat ulang sebelum melanjutkan.');
      if ((await unit.repository.listByRelated('scheduleProposal', record.id, 'consultation')).some((item) => item.payload.status === 'pending')) throw new DomainError('INVALID_STATE', 'Tunggu respons Peternak pada usulan jadwal sebelum memulai kunjungan.');
      const fromStage = String(visit.payload.stage) as VisitStage;
      const nextStage = nextVisitStage(command.action);
      const currentStatus = String(record.payload.status);
      if ((fromStage === 'scheduled' && currentStatus !== 'scheduled') || (fromStage !== 'scheduled' && currentStatus !== 'in_progress')) throw new DomainError('INVALID_STATE', 'Status layanan tidak cocok dengan tahap kunjungan.');
      if (!['scheduled', 'in_progress'].includes(currentStatus)) throw new DomainError('INVALID_STATE', 'Kunjungan ini tidak dapat dilanjutkan.');
      assertVisitTransition({ current: fromStage, next: nextStage, clinicalNoteFinal: false, userConfirmedCompletion: false });

      const timestamp = this.now().toISOString();
      const visitChanges: Record<string, unknown> = { stage: nextStage };
      if (command.action === 'depart') visitChanges.departureAt = timestamp;
      if (command.action === 'arrive') visitChanges.arrivalAt = timestamp;
      if (command.action === 'start_examination') visitChanges.examinationStartedAt = timestamp;
      await unit.repository.update(this.updated(visit, visitChanges), visit.version);
      const nextStatus = command.action === 'depart' ? 'in_progress' : currentStatus;
      await unit.repository.update(this.updated(record, { status: nextStatus }), record.version);
      const audit = this.entity('consultationAction', userId, record.id, {
        operationKey: command.operationKey, fingerprint, role, action: command.action,
        fromStatus: currentStatus, toStatus: nextStatus, fromStage, toStage: nextStage,
        reason: '', startsAt: record.payload.startsAt, endsAt: record.payload.endsAt,
      });
      await unit.repository.create(audit, [{ sourceId: audit.id, targetId: record.id, relationship: 'consultation' }]);
    });
  }

  private async access(unit: BookingUnit, userId: string, role: AccountRole, id: string): Promise<DomainEntity> {
    await this.profile(unit, userId, role);
    const record = await unit.repository.findById('consultation', id);
    if (!record) throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    const payload = record.payload;
    if (record.ownerId !== payload.farmerId || (role === 'farmer' ? record.ownerId !== userId : payload.vetId !== userId || ['draft', 'awaiting_payment'].includes(String(payload.status)))) throw new DomainError('FORBIDDEN', 'Layanan bukan milik atau penugasan akun ini.');
    const [farmers, vets, animals, animal] = await Promise.all([
      unit.repository.listRelated('consultation', id, 'farmer'), unit.repository.listRelated('consultation', id, 'veterinarian'), unit.repository.listRelated('consultation', id, 'animal'), unit.repository.findById('livestock', String(payload.animalId)),
    ]);
    if (!farmers.some((item) => item.id === payload.farmerId) || !vets.some((item) => item.id === payload.vetId) || !animals.some((item) => item.id === payload.animalId) || animal?.ownerId !== payload.farmerId) throw new DomainError('FORBIDDEN', 'Hubungan akun dan pasien tidak valid.');
    return record;
  }
  private profile(unit: BookingUnit, userId: string, role: AccountRole) { return new ProfileService(unit.profiles, this.media, this.ids, this.now).load(userId, role); }
  private async paid(unit: BookingUnit, record: DomainEntity) {
    const payments = await unit.repository.listByRelated('payment', record.id, 'payable');
    return payments.some((item) => item.ownerId === record.ownerId && item.payload.payableType === 'consultation' && item.payload.payableId === record.id && item.payload.status === 'succeeded' && Number.isSafeInteger(item.payload.amount) && item.payload.amount === record.payload.feeSnapshot);
  }
  private async editable(unit: BookingUnit, record: DomainEntity) {
    if (!['requested', 'scheduled'].includes(String(record.payload.status))) throw new DomainError('INVALID_STATE', 'Layanan tidak dapat dijadwalkan ulang.');
    await this.notStarted(unit, record);
    if (Date.parse(String(record.payload.startsAt)) <= this.now().getTime()) throw new DomainError('INVALID_STATE', 'Waktu permintaan sudah lewat.');
  }
  private async notStarted(unit: BookingUnit, record: DomainEntity) {
    const visits = await unit.repository.listByRelated('visit', record.id, 'consultation');
    if (visits.some((item) => item.ownerId !== record.payload.vetId || item.payload.consultationId !== record.id)) throw new DomainError('FORBIDDEN', 'Kunjungan bukan milik dokter layanan.');
    if (visits.some((item) => item.payload.stage !== 'scheduled')) throw new DomainError('INVALID_STATE', 'Dokter sudah memulai kunjungan.');
  }
  private async availableSlots(unit: BookingUnit, record: DomainEntity) {
    const vetId = String(record.payload.vetId);
    const directory = new VetDirectoryService(unit.repository, new ProfileService(unit.profiles, this.media, this.ids, this.now), this.now);
    const vet = await directory.get(vetId);
    const [availability, blocked, consultations, followUps] = await Promise.all([unit.repository.listByOwner('availability', vetId), unit.repository.listByOwner('blockedTime', vetId), unit.repository.listByRelated('consultation', vetId, 'veterinarian'), unit.repository.listByKind('followUp')]);
    availability.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version);
    // Availability off affects new bookings; existing assigned requests retain their slots.
    return projectDirectorySlots({ ...vet, accepting: true }, record.payload.type === 'visit' ? 'visit' : 'chat', availability[0], [...blocked, ...consultations.filter((item) => item.id !== record.id), ...followUps.filter((item) => item.payload.vetId === vetId)], this.now());
  }
  private async validateSlot(unit: BookingUnit, record: DomainEntity, startsAt: string, endsAt: string) {
    if ((await this.profile(unit, String(record.payload.vetId), 'vet')).verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi.');
    if (!(await this.availableSlots(unit, record)).slots.some((slot) => slot.startsAt === startsAt && slot.endsAt === endsAt)) throw new DomainError('INVALID_STATE', 'Waktu tidak tersedia lagi. Pilih jadwal lain.');
  }
  private updated(record: DomainEntity, changes: Record<string, unknown>): DomainEntity { return { ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, ...changes } }; }
  private entity(kind: EntityKind, ownerId: string, contextId: string, payload: Record<string, unknown>): DomainEntity { const timestamp = this.now().toISOString(); return { id: this.ids.create(), kind, ownerId, contextId, payload, version: 1, createdAt: timestamp, updatedAt: timestamp }; }
}

function nextVisitStage(action: VisitAction): VisitStage {
  switch (action) {
    case 'depart': return 'en_route';
    case 'arrive': return 'arrived';
    case 'start_examination': return 'examining';
  }
}

function validTimezone(value: unknown): string {
  if (typeof value !== 'string') return 'Asia/Jakarta';
  try { new Intl.DateTimeFormat('id-ID', { timeZone: value }).format(new Date(0)); return value; } catch { return 'Asia/Jakarta'; }
}
