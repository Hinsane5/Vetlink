import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityKind, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { localDisplay, overlaps, timezoneValid } from '../domain/availability';
import {
  validateFollowUpInput,
  validateProgressReportInput,
  validateReminderInput,
  type CareCoordinationSnapshot,
  type FollowUpInput,
  type ProgressReportInput,
  type ProgressReportSnapshot,
  type ReminderInput,
  type ReminderSnapshot,
} from '../domain/careCoordination';
import type { BookingRepository, BookingUnit } from './ports/BookingRepository';

type ConsultationAccess = {
  consultation: DomainEntity;
  farmerId: string;
  vetId: string;
  animalId: string;
};

/** Follow-ups, reminders, and farmer progress reports remain separate local records. */
export class CareCoordinationService {
  constructor(
    private readonly storage: BookingRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole, consultationId: string): Promise<CareCoordinationSnapshot> {
    if (role === 'vet') {
      return this.storage.transaction(async (unit) => {
        const access = await this.access(unit, userId, role, consultationId);
        const snapshot = await this.snapshot(unit, role, access);
        const timestamp = this.now().toISOString();
        for (const report of snapshot.reports) {
          if (report.viewedAt || report.record.payload.viewedAt) continue;
          const updated = this.updated(report.record, { viewedAt: timestamp });
          await unit.repository.update(updated, report.record.version);
          report.record = updated;
          report.viewedAt = timestamp;
        }
        return snapshot;
      });
    }
    const access = await this.access(this.storage.read, userId, role, consultationId);
    return this.snapshot(this.storage.read, role, access);
  }

  async getReminder(userId: string, reminderId: string): Promise<ReminderSnapshot> {
    const aggregate = await this.storage.read.profiles.loadProfile(userId, 'farmer');
    if (aggregate.profile.ownerId !== userId || aggregate.profile.kind !== 'farmerProfile') {
      throw new DomainError('FORBIDDEN', 'Pengingat bukan milik peran Peternak aktif.');
    }
    const reminder = await this.storage.read.repository.findById('reminder', reminderId);
    if (!reminder || reminder.ownerId !== userId) throw new DomainError('NOT_FOUND', 'Pengingat tidak ditemukan.');
    const animalId = stringValue(reminder.payload.animalId);
    const animal = await this.storage.read.repository.findById('livestock', animalId);
    const links = await this.storage.read.repository.listRelated('reminder', reminder.id, 'animal');
    if (!animal || animal.ownerId !== userId || !links.some((item) => item.id === animalId)) {
      throw new DomainError('FORBIDDEN', 'Pengingat tidak terkait dengan ternak milik akun ini.');
    }
    return reminderSnapshot(reminder);
  }

  async scheduleFollowUp(userId: string, consultationId: string, input: FollowUpInput): Promise<DomainEntity> {
    return this.storage.transaction(async (unit) => {
      const access = await this.access(unit, userId, 'vet', consultationId);
      const timezone = await this.timezone(unit, access.vetId);
      const normalized = validateFollowUpInput(input, timezone, this.now());
      await this.assertDoctorCanManage(unit, access);
      const fingerprint = JSON.stringify({ consultationId, ...normalized });
      const id = `follow-up:${userId}:${normalized.operationKey}`;
      const prior = await unit.repository.findById('followUp', id);
      if (prior) {
        if (prior.ownerId !== access.farmerId || prior.payload.fingerprint !== fingerprint
          || prior.payload.vetId !== access.vetId || prior.payload.consultationId !== consultationId) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas tindak lanjut sudah dipakai untuk jadwal lain.');
        }
        return prior;
      }
      await this.validateFollowUpSlot(unit, access, normalized.startsAt, normalized.endsAt, timezone);
      const record = this.entity('followUp', access.farmerId, consultationId, {
        consultationId,
        animalId: access.animalId,
        farmerId: access.farmerId,
        vetId: access.vetId,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        timezone,
        kind: 'recheck',
        status: 'scheduled',
        reason: normalized.reason,
        operationKey: normalized.operationKey,
        fingerprint,
      }, id);
      await unit.repository.create(record, [
        { sourceId: record.id, targetId: consultationId, relationship: 'consultation' },
        { sourceId: record.id, targetId: access.animalId, relationship: 'animal' },
        { sourceId: record.id, targetId: access.vetId, relationship: 'veterinarian' },
        { sourceId: record.id, targetId: access.farmerId, relationship: 'farmer' },
      ]);
      return record;
    });
  }

  async createReminder(userId: string, role: AccountRole, input: ReminderInput): Promise<ReminderSnapshot> {
    return this.storage.transaction(async (unit) => {
      const access = await this.access(unit, userId, role, input.consultationId);
      const timezone = await this.timezone(unit, access.vetId);
      const normalized = validateReminderInput(input, timezone, this.now());
      if (role === 'vet') await this.assertDoctorCanManage(unit, access);
      if (normalized.followUpId) {
        const followUps = await this.followUpsFor(unit, access);
        if (!followUps.some((item) => item.id === normalized.followUpId)) {
          throw new DomainError('FORBIDDEN', 'Pengingat hanya dapat ditautkan ke tindak lanjut layanan ini.');
        }
      }
      const fingerprint = JSON.stringify({ role, actorId: userId, ...normalized });
      const id = `reminder:${userId}:${normalized.operationKey}`;
      const prior = await unit.repository.findById('reminder', id);
      if (prior) {
        if (prior.ownerId !== access.farmerId || prior.payload.fingerprint !== fingerprint) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas pengingat sudah dipakai untuk isi lain.');
        }
        return reminderSnapshot(prior);
      }
      const record = this.entity('reminder', access.farmerId, access.animalId, {
        animalId: access.animalId,
        consultationId: access.consultation.id,
        followUpId: normalized.followUpId,
        ownerId: access.farmerId,
        createdBy: userId,
        kind: normalized.kind,
        dueAt: normalized.dueAt,
        instructions: normalized.instructions,
        careStatus: 'scheduled',
        deliveryStatus: 'pending',
        completedAt: null,
        operationKey: normalized.operationKey,
        fingerprint,
      }, id);
      const relations: EntityRelation[] = [
        { sourceId: record.id, targetId: access.animalId, relationship: 'animal' },
        { sourceId: record.id, targetId: access.consultation.id, relationship: 'consultation' },
      ];
      if (normalized.followUpId) relations.push({ sourceId: record.id, targetId: normalized.followUpId, relationship: 'followUp' });
      await unit.repository.create(record, relations);
      return reminderSnapshot(record);
    });
  }

  async submitProgressReport(userId: string, followUpId: string, input: ProgressReportInput): Promise<ProgressReportSnapshot> {
    return this.storage.transaction(async (unit) => {
      const followUp = await unit.repository.findById('followUp', followUpId);
      if (!followUp || followUp.kind !== 'followUp') throw new DomainError('NOT_FOUND', 'Tindak lanjut tidak ditemukan.');
      const consultationId = stringValue(followUp.payload.consultationId);
      const access = await this.access(unit, userId, 'farmer', consultationId);
      const followUpAccess = await this.validateFollowUp(unit, access, followUp);
      if (followUpAccess.payload.status === 'cancelled') throw new DomainError('INVALID_STATE', 'Laporan tidak dapat ditambahkan ke tindak lanjut yang dibatalkan.');
      const normalized = validateProgressReportInput(input);
      const fingerprint = JSON.stringify({ followUpId, consultationId, farmerId: userId, animalId: access.animalId, ...normalized });
      const id = `progress-report:${userId}:${normalized.operationKey}`;
      const prior = await unit.repository.findById('progressReport', id);
      if (prior) {
        if (prior.ownerId !== userId || prior.payload.fingerprint !== fingerprint) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas laporan sudah dipakai untuk isi lain.');
        }
        return progressReportSnapshot(prior);
      }
      const submittedAt = this.now().toISOString();
      const report = this.entity('progressReport', userId, followUpId, {
        consultationId,
        followUpId,
        farmerId: userId,
        animalId: access.animalId,
        text: normalized.text,
        attachmentIds: [],
        submittedAt,
        viewedAt: null,
        operationKey: normalized.operationKey,
        fingerprint,
      }, id);
      await unit.repository.create(report, [
        { sourceId: report.id, targetId: followUpId, relationship: 'followUp' },
        { sourceId: report.id, targetId: consultationId, relationship: 'consultation' },
        { sourceId: report.id, targetId: access.animalId, relationship: 'animal' },
      ]);
      return progressReportSnapshot(report);
    });
  }

  async completeCare(userId: string, reminderId: string): Promise<ReminderSnapshot> {
    return this.storage.transaction(async (unit) => {
      const aggregate = await unit.profiles.loadProfile(userId, 'farmer');
      if (aggregate.profile.ownerId !== userId || aggregate.profile.kind !== 'farmerProfile') {
        throw new DomainError('FORBIDDEN', 'Hanya Peternak pemilik yang dapat menyelesaikan perawatan.');
      }
      const reminder = await unit.repository.findById('reminder', reminderId);
      if (!reminder || reminder.kind !== 'reminder' || reminder.ownerId !== userId) {
        throw new DomainError('FORBIDDEN', 'Pengingat bukan milik Peternak ini.');
      }
      if (reminder.payload.kind !== 'care') throw new DomainError('INVALID_STATE', 'Pengingat ini bukan tindakan perawatan.');
      const animalId = stringValue(reminder.payload.animalId);
      const animal = await unit.repository.findById('livestock', animalId);
      const links = await unit.repository.listRelated('reminder', reminder.id, 'animal');
      if (!animal || animal.ownerId !== userId || !links.some((item) => item.id === animalId)) {
        throw new DomainError('FORBIDDEN', 'Pengingat tidak terkait dengan ternak milik akun ini.');
      }
      const eventId = `reminder-care:${reminder.id}`;
      const existingEvents = (await unit.repository.listByKind('healthEvent')).filter((item) => item.payload.sourceKey === `reminder:${reminder.id}`);
      if (existingEvents.some((item) => item.id !== eventId)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Pengingat sudah memiliki proyeksi perawatan yang berbeda.');
      const existing = await unit.repository.findById('healthEvent', eventId);
      if (existing) await this.validateCareEvent(unit, existing, reminder, animalId);
      if (reminder.payload.careStatus !== 'scheduled' && reminder.payload.careStatus !== 'done') {
        throw new DomainError('INVALID_STATE', 'Status perawatan pengingat tidak valid.');
      }
      if (reminder.payload.careStatus === 'done' && !existing) {
        const completedAt = validTimestamp(reminder.payload.completedAt) ?? this.now().toISOString();
        await unit.repository.create(this.careEvent(userId, animalId, reminderId, completedAt), [
          { sourceId: eventId, targetId: animalId, relationship: 'animal' },
          { sourceId: eventId, targetId: reminderId, relationship: 'reminder' },
        ]);
        return reminderSnapshot(reminder);
      }
      if (reminder.payload.careStatus === 'done') return reminderSnapshot(reminder);

      const completedAt = this.now().toISOString();
      const updatedReminder = this.updated(reminder, { careStatus: 'done', completedAt });
      await unit.repository.update(updatedReminder, reminder.version);
      if (!existing) {
        await unit.repository.create(this.careEvent(userId, animalId, reminderId, completedAt), [
          { sourceId: eventId, targetId: animalId, relationship: 'animal' },
          { sourceId: eventId, targetId: reminderId, relationship: 'reminder' },
        ]);
      }
      return reminderSnapshot(updatedReminder);
    });
  }

  private async snapshot(unit: BookingUnit, role: AccountRole, access: ConsultationAccess): Promise<CareCoordinationSnapshot> {
    const [followUps, allReminders, timezone] = await Promise.all([
      this.followUpsFor(unit, access),
      unit.repository.listByOwner('reminder', access.farmerId),
      this.timezone(unit, access.vetId),
    ]);
    const followUpIds = new Set(followUps.map((item) => item.id));
    const reminders: ReminderSnapshot[] = [];
    for (const item of allReminders) {
      if (item.payload.animalId !== access.animalId) continue;
      if (!['care', 'follow_up'].includes(String(item.payload.kind))) continue;
      const animalLinks = await unit.repository.listRelated('reminder', item.id, 'animal');
      if (!animalLinks.some((linked) => linked.id === access.animalId)) continue;
      const linkedConsultation = stringValue(item.payload.consultationId);
      const linkedFollowUp = stringValue(item.payload.followUpId);
      if (linkedConsultation && linkedConsultation !== access.consultation.id && !followUpIds.has(linkedFollowUp)) continue;
      if (linkedFollowUp && !followUpIds.has(linkedFollowUp) && role === 'vet') continue;
      reminders.push(reminderSnapshot(item));
    }
    reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.record.id.localeCompare(b.record.id));
    const reports: ProgressReportSnapshot[] = [];
    if (followUpIds.size) {
      for (const report of await unit.repository.listByKind('progressReport')) {
        const followUpId = stringValue(report.payload.followUpId);
        if (!followUpIds.has(followUpId) || report.ownerId !== access.farmerId
          || report.payload.consultationId !== access.consultation.id || report.payload.animalId !== access.animalId) continue;
        const [followUpLinks, consultationLinks, animalLinks] = await Promise.all([
          unit.repository.listRelated('progressReport', report.id, 'followUp'),
          unit.repository.listRelated('progressReport', report.id, 'consultation'),
          unit.repository.listRelated('progressReport', report.id, 'animal'),
        ]);
        if (!followUpLinks.some((item) => item.id === followUpId)
          || !consultationLinks.some((item) => item.id === access.consultation.id)
          || !animalLinks.some((item) => item.id === access.animalId)) continue;
        reports.push(progressReportSnapshot(report));
      }
    }
    reports.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.record.id.localeCompare(b.record.id));
    const canScheduleFollowUp = role === 'vet' && await this.canDoctorManage(unit, access);
    return {
      consultationId: access.consultation.id,
      animalId: access.animalId,
      timezone,
      canScheduleFollowUp,
      followUps,
      reminders,
      reports,
    };
  }

  private async access(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string): Promise<ConsultationAccess> {
    const aggregate = await unit.profiles.loadProfile(userId, role);
    if (aggregate.profile.ownerId !== userId || aggregate.profile.kind !== (role === 'vet' ? 'vetProfile' : 'farmerProfile')) {
      throw new DomainError('FORBIDDEN', 'Profil tidak sesuai dengan peran aktif.');
    }
    const consultation = await unit.repository.findById('consultation', consultationId);
    if (!consultation || consultation.kind !== 'consultation') throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    const farmerId = stringValue(consultation.payload.farmerId);
    const vetId = stringValue(consultation.payload.vetId);
    const animalId = stringValue(consultation.payload.animalId);
    if (!farmerId || !vetId || !animalId || consultation.ownerId !== farmerId
      || (role === 'farmer' ? userId !== farmerId : userId !== vetId || ['draft', 'awaiting_payment'].includes(String(consultation.payload.status)))) {
      throw new DomainError('FORBIDDEN', 'Tindak lanjut bukan milik atau penugasan akun ini.');
    }
    const [farmers, vets, animals, animal] = await Promise.all([
      unit.repository.listRelated('consultation', consultationId, 'farmer'),
      unit.repository.listRelated('consultation', consultationId, 'veterinarian'),
      unit.repository.listRelated('consultation', consultationId, 'animal'),
      unit.repository.findById('livestock', animalId),
    ]);
    if (!farmers.some((item) => item.id === farmerId) || !vets.some((item) => item.id === vetId)
      || !animals.some((item) => item.id === animalId) || animal?.ownerId !== farmerId) {
      throw new DomainError('FORBIDDEN', 'Relasi ternak dan layanan tidak valid.');
    }
    return { consultation, farmerId, vetId, animalId };
  }

  private async followUpsFor(unit: BookingUnit, access: ConsultationAccess): Promise<DomainEntity[]> {
    const linked = await unit.repository.listByRelated('followUp', access.consultation.id, 'consultation');
    const followUps: DomainEntity[] = [];
    for (const item of linked) {
      await this.validateFollowUp(unit, access, item);
      followUps.push(item);
    }
    return followUps.sort((a, b) => stringValue(a.payload.startsAt).localeCompare(stringValue(b.payload.startsAt)) || a.id.localeCompare(b.id));
  }

  private async validateFollowUp(unit: BookingUnit, access: ConsultationAccess, followUp: DomainEntity): Promise<DomainEntity> {
    const [consultationLinks, animalLinks] = await Promise.all([
      unit.repository.listRelated('followUp', followUp.id, 'consultation'),
      unit.repository.listRelated('followUp', followUp.id, 'animal'),
    ]);
    if (followUp.kind !== 'followUp' || followUp.ownerId !== access.farmerId
      || followUp.payload.consultationId !== access.consultation.id || followUp.payload.vetId !== access.vetId
      || followUp.payload.animalId !== access.animalId || !consultationLinks.some((item) => item.id === access.consultation.id)
      || !animalLinks.some((item) => item.id === access.animalId)) {
      throw new DomainError('FORBIDDEN', 'Tindak lanjut tidak terkait dengan layanan dan pasien ini.');
    }
    if (!['scheduled', 'completed', 'cancelled'].includes(String(followUp.payload.status))) {
      throw new DomainError('INVALID_STATE', 'Status tindak lanjut tidak valid.');
    }
    return followUp;
  }

  private async assertDoctorCanManage(unit: BookingUnit, access: ConsultationAccess): Promise<void> {
    if (!(await this.canDoctorManage(unit, access))) {
      const aggregate = await unit.profiles.loadProfile(access.vetId, 'vet');
      if (aggregate.profile.payload.verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi untuk mengelola tindak lanjut.');
      if (!['in_progress', 'completed'].includes(String(access.consultation.payload.status))) throw new DomainError('INVALID_STATE', 'Tindak lanjut memerlukan layanan yang sedang berlangsung atau selesai.');
      throw new DomainError('INVALID_STATE', 'Pembayaran berhasil dan catatan final diperlukan sebelum mengelola tindak lanjut.');
    }
  }

  private async canDoctorManage(unit: BookingUnit, access: ConsultationAccess): Promise<boolean> {
    const aggregate = await unit.profiles.loadProfile(access.vetId, 'vet');
    if (aggregate.profile.payload.verificationStatus !== 'verified'
      || !['in_progress', 'completed'].includes(String(access.consultation.payload.status))) return false;
    const [payments, notes] = await Promise.all([
      unit.repository.listByRelated('payment', access.consultation.id, 'payable'),
      unit.repository.listByRelated('clinicalNote', access.consultation.id, 'consultation'),
    ]);
    const fee = access.consultation.payload.feeSnapshot;
    const paid = payments.some((payment) => payment.ownerId === access.farmerId
      && payment.payload.payableType === 'consultation' && payment.payload.payableId === access.consultation.id
      && payment.payload.status === 'succeeded' && Number.isSafeInteger(payment.payload.amount) && payment.payload.amount === fee);
    const note = notes.length === 1 ? notes[0] : null;
    if (!paid || !note || note.kind !== 'clinicalNote' || note.ownerId !== access.vetId
      || note.payload.status !== 'final' || note.payload.finalizedBy !== access.vetId
      || note.payload.consultationId !== access.consultation.id || note.payload.animalId !== access.animalId) return false;
    const [consultationLinks, animalLinks, vetLinks] = await Promise.all([
      unit.repository.listRelated('clinicalNote', note.id, 'consultation'),
      unit.repository.listRelated('clinicalNote', note.id, 'animal'),
      unit.repository.listRelated('clinicalNote', note.id, 'veterinarian'),
    ]);
    return consultationLinks.some((item) => item.id === access.consultation.id)
      && animalLinks.some((item) => item.id === access.animalId) && vetLinks.some((item) => item.id === access.vetId);
  }

  private async validateFollowUpSlot(unit: BookingUnit, access: ConsultationAccess, startsAt: string, endsAt: string, timezone: string): Promise<void> {
    const availability = latest(await unit.repository.listByOwner('availability', access.vetId));
    if (!availability || !Array.isArray(availability.payload.weekdayRules)) {
      throw new DomainError('INVALID_STATE', 'Jam kerja dokter belum tersedia untuk menjadwalkan tindak lanjut.');
    }
    const startLocal = localDisplay(startsAt, timezone);
    const endLocal = localDisplay(endsAt, timezone);
    const [date, startTime] = startLocal.split(' ');
    const [endDate, endTime] = endLocal.split(' ');
    if (date !== endDate) throw new DomainError('VALIDATION_FAILED', 'Tindak lanjut harus berada pada hari kalender yang sama.');
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const withinHours = availability.payload.weekdayRules.some((value) => {
      if (!value || typeof value !== 'object') return false;
      const rule = value as Record<string, unknown>;
      return rule.weekday === weekday && typeof rule.start === 'string' && typeof rule.end === 'string'
        && startTime >= rule.start && endTime <= rule.end && rule.start < rule.end;
    });
    if (!withinHours) throw new DomainError('INVALID_STATE', 'Waktu tindak lanjut harus berada dalam jam kerja dokter.');

    const [blocked, consultations, followUps] = await Promise.all([
      unit.repository.listByOwner('blockedTime', access.vetId),
      unit.repository.listByRelated('consultation', access.vetId, 'veterinarian'),
      unit.repository.listByKind('followUp'),
    ]);
    const interval = { startsAt, endsAt };
    const conflicts = [
      ...blocked.filter((item) => item.payload.status !== 'cancelled'),
      ...consultations.filter((item) => item.id !== access.consultation.id
        && ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress'].includes(String(item.payload.status))),
      ...followUps.filter((item) => item.payload.vetId === access.vetId && item.payload.status === 'scheduled'),
    ].some((item) => {
      const start = stringValue(item.payload.startsAt);
      const end = stringValue(item.payload.endsAt);
      return Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && overlaps(interval, { startsAt: start, endsAt: end });
    });
    if (conflicts) throw new DomainError('INVALID_STATE', 'Jadwal tindak lanjut berbenturan dengan agenda atau blok waktu dokter.');
  }

  private async timezone(unit: BookingUnit, vetId: string): Promise<string> {
    const availability = latest(await unit.repository.listByOwner('availability', vetId));
    const timezone = typeof availability?.payload.timezone === 'string' ? availability.payload.timezone : 'Asia/Jakarta';
    timezoneValid(timezone);
    return timezone;
  }

  private async validateCareEvent(unit: BookingUnit, event: DomainEntity, reminder: DomainEntity, animalId: string): Promise<void> {
    const [animalLinks, reminderLinks] = await Promise.all([
      unit.repository.listRelated('healthEvent', event.id, 'animal'),
      unit.repository.listRelated('healthEvent', event.id, 'reminder'),
    ]);
    if (event.ownerId !== reminder.ownerId || event.payload.reminderId !== reminder.id
      || event.payload.animalId !== animalId || event.payload.kind !== 'care'
      || event.payload.provenance !== 'reminder' || event.payload.sourceKey !== `reminder:${reminder.id}`
      || !animalLinks.some((item) => item.id === animalId) || !reminderLinks.some((item) => item.id === reminder.id)) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Catatan perawatan tidak sesuai dengan pengingat ini.');
    }
  }

  private careEvent(userId: string, animalId: string, reminderId: string, occurredAt: string): DomainEntity {
    return this.entity('healthEvent', userId, animalId, {
      animalId,
      reminderId,
      kind: 'care',
      occurredAt,
      description: 'Peternak menandai pengingat perawatan selesai.',
      actorId: userId,
      provenance: 'reminder',
      sourceKey: `reminder:${reminderId}`,
    }, `reminder-care:${reminderId}`);
  }

  private updated(record: DomainEntity, changes: Record<string, unknown>): DomainEntity {
    return { ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, ...changes } };
  }

  private entity(kind: EntityKind, ownerId: string, contextId: string, payload: Record<string, unknown>, id: string): DomainEntity {
    const timestamp = this.now().toISOString();
    return { id, kind, ownerId, contextId, payload, version: 1, createdAt: timestamp, updatedAt: timestamp };
  }
}

function reminderSnapshot(record: DomainEntity): ReminderSnapshot {
  return {
    record,
    animalId: stringValue(record.payload.animalId),
    consultationId: nullableString(record.payload.consultationId),
    followUpId: nullableString(record.payload.followUpId),
    kind: record.payload.kind === 'follow_up' ? 'follow_up' : 'care',
    dueAt: stringValue(record.payload.dueAt),
    instructions: stringValue(record.payload.instructions),
    careStatus: record.payload.careStatus === 'done' ? 'done' : 'scheduled',
    deliveryStatus: record.payload.deliveryStatus === 'sent' || record.payload.deliveryStatus === 'failed' ? record.payload.deliveryStatus : 'pending',
    completedAt: validTimestamp(record.payload.completedAt),
  };
}

function progressReportSnapshot(record: DomainEntity): ProgressReportSnapshot {
  return {
    record,
    followUpId: stringValue(record.payload.followUpId),
    text: stringValue(record.payload.text),
    submittedAt: validTimestamp(record.payload.submittedAt) ?? record.createdAt,
    viewedAt: validTimestamp(record.payload.viewedAt),
  };
}

function latest(records: DomainEntity[]): DomainEntity | null {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version)[0] ?? null;
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function nullableString(value: unknown): string | null { const result = stringValue(value); return result || null; }
function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
