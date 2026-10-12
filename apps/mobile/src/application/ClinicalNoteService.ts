import type { IdFactory } from './ports/AuthRepository';
import type { BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityKind, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { assertClinicalNoteEditable, assertClinicalNoteFinalizable } from '../domain/policies';
import {
  clinicalNoteFieldsFrom,
  clinicalNoteSnapshot,
  validateClinicalNoteDraft,
  type ClinicalNoteFields,
  type ClinicalNoteSnapshot,
} from '../domain/clinicalNotes';

export class ClinicalNoteService {
  constructor(
    private readonly storage: BookingRepository,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole, consultationId: string): Promise<ClinicalNoteSnapshot | null> {
    const context = await this.access(this.storage.read, userId, role, consultationId);
    const note = await this.noteFor(this.storage.read, context.consultation);
    if (!note) return null;
    if (role === 'farmer' && note.payload.status !== 'final') return null;
    return clinicalNoteSnapshot(note);
  }

  async saveDraft(
    userId: string,
    consultationId: string,
    expectedVersion: number | null,
    input: ClinicalNoteFields,
  ): Promise<ClinicalNoteSnapshot> {
    const fields = validateClinicalNoteDraft(input);
    return this.storage.transaction(async (unit) => {
      const { consultation, animalId, vetId } = await this.access(unit, userId, 'vet', consultationId);
      await this.assertEditableContext(unit, userId, consultation, 'draft');
      const current = await this.noteFor(unit, consultation);
      if (current && current.payload.status === 'final') throw new DomainError('IMMUTABLE_RECORD', 'Catatan final hanya dapat dibaca.');
      if (current && current.payload.status !== 'draft') throw new DomainError('INVALID_STATE', 'Status draft catatan tidak valid.');
      if (!current) {
        if (expectedVersion !== null) throw new DomainError('VERSION_CONFLICT', 'Draft catatan sudah tidak tersedia. Muat ulang sebelum melanjutkan.');
        const note = this.entity('clinicalNote', vetId, consultationId, {
          consultationId,
          animalId,
          vetId,
          ...fields,
          status: 'draft',
          finalizedAt: null,
          finalizedBy: null,
        });
        await unit.repository.create(note, noteRelations(note.id, consultationId, animalId, vetId));
        return clinicalNoteSnapshot(note);
      }
      if (expectedVersion === null || current.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Draft catatan sudah berubah. Muat ulang sebelum menyimpan.');
      assertClinicalNoteEditable('draft');
      if (JSON.stringify(clinicalNoteFieldsFrom(current)) === JSON.stringify(fields)) return clinicalNoteSnapshot(current);
      const updated = this.updated(current, { ...fields, contextId: consultation.id });
      await unit.repository.update(updated, current.version);
      return clinicalNoteSnapshot(updated);
    });
  }

  async finalize(userId: string, consultationId: string, expectedVersion: number): Promise<ClinicalNoteSnapshot> {
    return this.storage.transaction(async (unit) => {
      const { consultation, animalId, vetId, farmerId } = await this.access(unit, userId, 'vet', consultationId);
      const notes = await this.notesFor(unit, consultation.id);
      if (notes.length !== 1) throw new DomainError('INVALID_STATE', 'Simpan draft catatan sebelum meninjau finalisasi.');
      const note = notes[0];
      await this.assertNoteRelations(unit, note, consultation, animalId, vetId);
      if (note.payload.status !== 'draft') throw new DomainError('IMMUTABLE_RECORD', 'Catatan final hanya dapat dibaca.');
      const operationKey = `clinical-finalize:${note.id}:${expectedVersion}`;
      const fingerprint = JSON.stringify({ consultationId, noteId: note.id, expectedVersion, action: 'finalize_note' });
      const prior = await this.findAction(unit, operationKey);
      if (prior) {
        if (prior.ownerId !== userId || prior.contextId !== consultationId || prior.payload.fingerprint !== fingerprint || prior.payload.role !== 'vet') {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas finalisasi sudah dipakai untuk perubahan lain.');
        }
        const finalized = await unit.repository.findById('clinicalNote', note.id);
        if (!finalized || finalized.payload.status !== 'final') throw new DomainError('INVALID_STATE', 'Hasil finalisasi tidak ditemukan.');
        return clinicalNoteSnapshot(finalized);
      }
      await this.assertEditableContext(unit, userId, consultation, 'draft');
      if (note.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Catatan berubah setelah ditinjau. Periksa ulang isi sebelum finalisasi.');
      assertClinicalNoteEditable('draft');
      const fields = clinicalNoteFieldsFrom(note);
      assertClinicalNoteFinalizable(fields);
      const finalizedAt = this.now().toISOString();
      const finalized = this.updated(note, { ...fields, contextId: consultation.id, status: 'final', finalizedAt, finalizedBy: vetId });
      await unit.repository.update(finalized, note.version);

      const healthEventId = `clinical-event:${note.id}`;
      if (await unit.repository.findById('healthEvent', healthEventId)) throw new DomainError('INVALID_STATE', 'Riwayat pemeriksaan sudah memiliki proyeksi.');
      const healthEvent = this.entity('healthEvent', farmerId, animalId, {
        animalId,
        kind: 'examination',
        occurredAt: finalizedAt,
        description: fields.complaint || fields.findings,
        actorId: vetId,
        clinicalNoteId: note.id,
        provenance: 'clinical_note',
        sourceKey: `clinical-note:${note.id}`,
      }, healthEventId);
      await unit.repository.create(healthEvent, [
        { sourceId: healthEvent.id, relationship: 'animal', targetId: animalId },
        { sourceId: healthEvent.id, relationship: 'clinicalNote', targetId: note.id },
      ]);
      const action = this.entity('consultationAction', userId, consultationId, {
        operationKey,
        fingerprint,
        role: 'vet',
        action: 'finalize_note',
        fromStatus: String(consultation.payload.status),
        toStatus: String(consultation.payload.status),
        noteId: note.id,
        noteVersion: finalized.version,
      });
      await unit.repository.create(action, [{ sourceId: action.id, relationship: 'consultation', targetId: consultationId }]);
      return clinicalNoteSnapshot(finalized);
    });
  }

  async complete(userId: string, command: {
    consultationId: string;
    consultationVersion: number;
    noteVersion: number;
    visitVersion: number | null;
    operationKey: string;
    confirmed: boolean;
  }): Promise<void> {
    await this.storage.transaction(async (unit) => {
      const { consultation, vetId } = await this.access(unit, userId, 'vet', command.consultationId);
      if (command.confirmed !== true) throw new DomainError('INVALID_STATE', 'Penyelesaian layanan memerlukan konfirmasi Dokter.');
      if (!command.operationKey.trim() || command.operationKey.length > 200) throw new DomainError('VALIDATION_FAILED', 'Identitas penyelesaian tidak valid.');
      const fingerprint = JSON.stringify(command);
      const prior = await this.findAction(unit, command.operationKey);
      if (prior) {
        if (prior.ownerId !== userId || prior.contextId !== consultation.id || prior.payload.fingerprint !== fingerprint || prior.payload.role !== 'vet') {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas penyelesaian sudah dipakai untuk perubahan lain.');
        }
        return;
      }
      await this.assertEditableContext(unit, userId, consultation, 'final');
      if (consultation.version !== command.consultationVersion) throw new DomainError('VERSION_CONFLICT', 'Layanan berubah. Muat ulang sebelum menyelesaikannya.');
      const note = await this.noteFor(unit, consultation);
      if (note?.payload.status === 'final' && note.version !== command.noteVersion) throw new DomainError('VERSION_CONFLICT', 'Catatan final berubah. Muat ulang sebelum menyelesaikan layanan.');
      if (!note || note.payload.status !== 'final' || note.payload.finalizedBy !== vetId) {
        throw new DomainError('INVALID_STATE', 'Catatan final terbaru diperlukan sebelum menyelesaikan layanan.');
      }
      let visit: DomainEntity | null = null;
      if (consultation.payload.type === 'visit') {
        const visits = await unit.repository.listByRelated('visit', consultation.id, 'consultation');
        if (visits.length !== 1 || visits[0].ownerId !== vetId || visits[0].payload.stage !== 'examining') throw new DomainError('INVALID_STATE', 'Kunjungan harus berada pada tahap pemeriksaan sebelum diselesaikan.');
        visit = visits[0];
        if (command.visitVersion !== visit.version) throw new DomainError('VERSION_CONFLICT', 'Progres kunjungan berubah. Muat ulang sebelum menyelesaikannya.');
      } else if (command.visitVersion !== null) {
        throw new DomainError('INVALID_STATE', 'Konsultasi chat tidak memiliki tahap kunjungan.');
      }

      const fee = consultation.payload.feeSnapshot;
      const commission = consultation.payload.commissionSnapshot;
      if (!Number.isSafeInteger(fee) || !Number.isSafeInteger(commission) || (fee as number) <= (commission as number) || (commission as number) < 0) {
        throw new DomainError('INVALID_STATE', 'Snapshot biaya atau komisi layanan tidak valid.');
      }
      const payment = (await unit.repository.listByRelated('payment', consultation.id, 'payable')).find((item) =>
        item.ownerId === consultation.ownerId && item.payload.payableType === 'consultation'
        && item.payload.payableId === consultation.id && item.payload.status === 'succeeded'
        && Number.isSafeInteger(item.payload.amount) && item.payload.amount === fee,
      );
      if (!payment) throw new DomainError('INVALID_STATE', 'Pembayaran berhasil yang sesuai diperlukan untuk mencatat pendapatan.');
      const timestamp = this.now().toISOString();
      const completed = this.updated(consultation, { status: 'completed', completionAt: timestamp });
      await unit.repository.update(completed, consultation.version);
      if (visit) await unit.repository.update(this.updated(visit, { stage: 'completed', completedAt: timestamp }), visit.version);
      await this.createPendingEarning(unit, consultation, vetId, payment.id, fee as number, commission as number, timestamp);
      const action = this.entity('consultationAction', userId, consultation.id, {
        operationKey: command.operationKey,
        fingerprint,
        role: 'vet',
        action: 'complete',
        fromStatus: 'in_progress',
        toStatus: 'completed',
        noteId: note.id,
        visitStage: visit ? 'examining → completed' : null,
      });
      await unit.repository.create(action, [{ sourceId: action.id, relationship: 'consultation', targetId: consultation.id }]);
    });
  }

  private async access(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string) {
    const aggregate = await unit.profiles.loadProfile(userId, role);
    if (aggregate.profile.ownerId !== userId || aggregate.profile.kind !== (role === 'vet' ? 'vetProfile' : 'farmerProfile')) throw new DomainError('FORBIDDEN', 'Profil tidak sesuai dengan peran aktif.');
    const consultation = await unit.repository.findById('consultation', consultationId);
    if (!consultation || consultation.kind !== 'consultation') throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    const farmerId = stringValue(consultation.payload.farmerId);
    const vetId = stringValue(consultation.payload.vetId);
    const animalId = stringValue(consultation.payload.animalId);
    if ((role === 'farmer' ? userId !== farmerId || consultation.ownerId !== userId : userId !== vetId || consultation.ownerId !== farmerId)) {
      throw new DomainError('FORBIDDEN', 'Catatan ini bukan milik atau penugasan akun ini.');
    }
    const [farmers, vets, animals, animal] = await Promise.all([
      unit.repository.listRelated('consultation', consultation.id, 'farmer'),
      unit.repository.listRelated('consultation', consultation.id, 'veterinarian'),
      unit.repository.listRelated('consultation', consultation.id, 'animal'),
      unit.repository.findById('livestock', animalId),
    ]);
    if (!farmers.some((item) => item.id === farmerId) || !vets.some((item) => item.id === vetId) || !animals.some((item) => item.id === animalId) || animal?.ownerId !== farmerId) {
      throw new DomainError('FORBIDDEN', 'Relasi pasien dan layanan tidak valid.');
    }
    return { consultation, farmerId, vetId, animalId, verificationStatus: aggregate.profile.payload.verificationStatus };
  }

  private async assertEditableContext(unit: BookingUnit, userId: string, consultation: DomainEntity, noteStatus: 'draft' | 'final'): Promise<void> {
    if (consultation.payload.vetId !== userId || consultation.payload.status !== 'in_progress') throw new DomainError('INVALID_STATE', 'Catatan hanya dapat disimpan ketika layanan sedang berlangsung.');
    const aggregate = await unit.profiles.loadProfile(userId, 'vet');
    if (aggregate.profile.payload.verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi untuk mengelola catatan layanan.');
    if (!(await this.isPaid(unit, consultation))) throw new DomainError('INVALID_STATE', 'Pembayaran layanan belum berhasil.');
    if (consultation.payload.type === 'visit') {
      const visits = await unit.repository.listByRelated('visit', consultation.id, 'consultation');
      if (visits.length !== 1 || visits[0].ownerId !== userId || visits[0].payload.consultationId !== consultation.id) throw new DomainError('FORBIDDEN', 'Kunjungan tidak terkait dengan dokter layanan.');
      if (noteStatus === 'draft' && visits[0].payload.stage !== 'examining') throw new DomainError('INVALID_STATE', 'Mulai pemeriksaan kunjungan sebelum membuat catatan.');
      if (noteStatus === 'final' && visits[0].payload.stage !== 'examining') throw new DomainError('INVALID_STATE', 'Kunjungan harus berada pada tahap pemeriksaan sebelum diselesaikan.');
    }
  }

  private async isPaid(unit: BookingUnit, consultation: DomainEntity): Promise<boolean> {
    const payments = await unit.repository.listByRelated('payment', consultation.id, 'payable');
    return payments.some((payment) => payment.ownerId === consultation.ownerId && payment.payload.payableType === 'consultation'
      && payment.payload.payableId === consultation.id && payment.payload.status === 'succeeded'
      && Number.isSafeInteger(payment.payload.amount) && payment.payload.amount === consultation.payload.feeSnapshot);
  }

  private async noteFor(unit: BookingUnit, consultation: DomainEntity): Promise<DomainEntity | null> {
    const notes = await this.notesFor(unit, consultation.id);
    if (notes.length > 1) throw new DomainError('INVALID_STATE', 'Layanan memiliki lebih dari satu catatan pemeriksaan.');
    if (!notes.length) return null;
    const context = {
      animalId: stringValue(consultation.payload.animalId),
      vetId: stringValue(consultation.payload.vetId),
    };
    await this.assertNoteRelations(unit, notes[0], consultation, context.animalId, context.vetId);
    return notes[0];
  }

  private async notesFor(unit: BookingUnit, consultationId: string): Promise<DomainEntity[]> {
    return (await unit.repository.listByRelated('clinicalNote', consultationId, 'consultation')).filter((item) => item.kind === 'clinicalNote');
  }

  private async assertNoteRelations(unit: BookingUnit, note: DomainEntity, consultation: DomainEntity, animalId: string, vetId: string): Promise<void> {
    if (note.kind !== 'clinicalNote' || note.ownerId !== vetId || (note.contextId !== null && note.contextId !== consultation.id)
      || note.payload.consultationId !== consultation.id || note.payload.animalId !== animalId || note.payload.vetId !== vetId) {
      throw new DomainError('FORBIDDEN', 'Catatan tidak sesuai dengan layanan, pasien, dan dokter.');
    }
    const [consultations, animals, vets] = await Promise.all([
      unit.repository.listRelated('clinicalNote', note.id, 'consultation'),
      unit.repository.listRelated('clinicalNote', note.id, 'animal'),
      unit.repository.listRelated('clinicalNote', note.id, 'veterinarian'),
    ]);
    if (!consultations.some((item) => item.id === consultation.id) || !animals.some((item) => item.id === animalId) || !vets.some((item) => item.id === vetId)) {
      throw new DomainError('FORBIDDEN', 'Relasi catatan pemeriksaan tidak valid.');
    }
  }

  private async findAction(unit: BookingUnit, operationKey: string): Promise<DomainEntity | null> {
    return (await unit.repository.listByKind('consultationAction')).find((item) => item.payload.operationKey === operationKey) ?? null;
  }

  private async createPendingEarning(unit: BookingUnit, consultation: DomainEntity, vetId: string, paymentId: string, gross: number, commission: number, timestamp: string): Promise<void> {
    const existing = (await unit.repository.listByRelated('earningTransaction', consultation.id, 'consultation'))
      .find((item) => item.ownerId === vetId && item.payload.consultationId === consultation.id);
    if (existing) throw new DomainError('INVALID_STATE', 'Pendapatan layanan ini sudah tercatat.');
    const net = gross - commission;
    const earning = this.entity('earningTransaction', vetId, consultation.id, {
      vetId, consultationId: consultation.id, paymentId, gross, commission, net, status: 'pending', earnedAt: timestamp,
    });
    await unit.repository.create(earning, [{ sourceId: earning.id, relationship: 'consultation', targetId: consultation.id }]);
    const ledger = this.entity('ledgerEntry', vetId, earning.id, {
      vetId, earningId: earning.id, kind: 'earn_pending', amount: net,
      operationKey: `consultation-complete:${consultation.id}:earn-pending`, occurredAt: timestamp,
    });
    await unit.repository.create(ledger, [{ sourceId: ledger.id, relationship: 'earning', targetId: earning.id }]);
  }

  private updated(record: DomainEntity, changes: Record<string, unknown>): DomainEntity {
    return { ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, ...changes } };
  }

  private entity(kind: EntityKind, ownerId: string, contextId: string, payload: Record<string, unknown>, id = this.ids.create()): DomainEntity {
    const timestamp = this.now().toISOString();
    return { id, kind, ownerId, contextId, payload, version: 1, createdAt: timestamp, updatedAt: timestamp };
  }
}

function noteRelations(noteId: string, consultationId: string, animalId: string, vetId: string): EntityRelation[] {
  return [
    { sourceId: noteId, relationship: 'consultation', targetId: consultationId },
    { sourceId: noteId, relationship: 'animal', targetId: animalId },
    { sourceId: noteId, relationship: 'veterinarian', targetId: vetId },
  ];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
