import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { AuthenticatedPrincipal, UserRole } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { adapterFailed, type AdapterResult } from '../communication/adapter-result.js';
import type {
  CompleteCareDto,
  CreateFollowUpDto,
  CreateProgressReportDto,
  CreateReminderDto,
  UpdateFollowUpDto,
  UpdateReminderDto,
} from './care-coordination.dto.js';
import { REMINDER_DELIVERY_ADAPTER, type ReminderDeliveryAdapter } from './reminder-delivery.js';
import { NotificationsService, type NotificationCategory, type NotificationContextType } from '../notifications/notifications.service.js';

type Context = Record<string, unknown> & {
  id: string;
  farmer_id: string;
  vet_id: string;
  animal_id: string;
  status: string;
  fee_snapshot_idr: string | number;
  verification_status: string;
  timezone: string | null;
};

type FollowUpRow = {
  id: string; consultation_id: string; farmer_id: string; vet_id: string; animal_id: string;
  starts_at: Date | string; ends_at: Date | string; timezone: string; kind: 'recheck';
  status: 'scheduled' | 'completed' | 'cancelled'; reason: string; follow_up_consultation_id: string | null;
  version: number; created_at: Date | string; updated_at: Date | string;
};

type ReminderRow = {
  id: string; animal_id: string; farmer_id: string; consultation_id: string | null; vet_id: string | null;
  follow_up_id: string | null; created_by: string; kind: 'care' | 'follow_up'; due_at: Date | string;
  instructions: string; care_status: 'scheduled' | 'done'; delivery_status: 'pending' | 'sent' | 'failed';
  completed_at: Date | string | null; delivery_attempt: number; version: number;
  created_at: Date | string; updated_at: Date | string;
};

type ReportRow = {
  id: string; consultation_id: string; follow_up_id: string; farmer_id: string; vet_id: string; animal_id: string;
  text: string; submitted_at: Date | string; viewed_at: Date | string | null; attachment_ids: string[];
};

type TimeParts = { date: string; time: string; weekday: number };

const ACTIVE_CONSULTATION_STATUSES = ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress'];
const CARE_CONTEXT_STATUSES = new Set(['scheduled', 'in_progress', 'completed']);

function error(code: string, message: string) { return { code, message }; }

function validation(field: string, message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request validation failed', fieldErrors: { [field]: [message] } });
}

function conflict(message: string, code = 'CONFLICT'): never {
  throw new ConflictException({ code, message });
}

function ruleViolation(message: string, code = 'RULE_VIOLATION'): never {
  throw new UnprocessableEntityException({ code, message });
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function normalizeText(value: unknown, min: number, max: number, field: string): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const length = [...normalized].length;
  if (length < min || length > max) validation(field, `Harus berisi ${min}–${max} karakter setelah dirapikan.`);
  return normalized;
}

function requiredKey(value: string | undefined): string {
  const key = value?.trim() ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(key)) {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Header Idempotency-Key wajib berisi 8–128 karakter alfanumerik, tanda hubung, atau garis bawah.' });
  }
  return key;
}

function dateInput(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    validation(field, 'Gunakan timestamp ISO-8601 dengan zona waktu.');
  }
  return new Date(timestamp).toISOString();
}

function timeParts(value: string, timezone: string): TimeParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, weekday: weekdays[get('weekday')] ?? -1 };
  } catch {
    ruleViolation('Timezone IANA dokter tidak valid.', 'INVALID_TIMEZONE');
  }
}

function jsonValue<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function followUpDto(row: FollowUpRow) {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    farmerId: row.farmer_id,
    vetId: row.vet_id,
    animalId: row.animal_id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    timezone: row.timezone,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    followUpConsultationId: row.follow_up_consultation_id,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function reminderDto(row: ReminderRow) {
  return {
    id: row.id,
    animalId: row.animal_id,
    consultationId: row.consultation_id,
    followUpId: row.follow_up_id,
    ownerId: row.farmer_id,
    createdBy: row.created_by,
    kind: row.kind,
    dueAt: iso(row.due_at),
    instructions: row.instructions,
    careStatus: row.care_status,
    deliveryStatus: row.delivery_status,
    completedAt: iso(row.completed_at),
    deliveryAttempt: row.delivery_attempt,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function reportDto(row: ReportRow) {
  return {
    id: row.id,
    consultationId: row.consultation_id,
    followUpId: row.follow_up_id,
    farmerId: row.farmer_id,
    vetId: row.vet_id,
    animalId: row.animal_id,
    text: row.text,
    attachmentIds: row.attachment_ids ?? [],
    submittedAt: iso(row.submitted_at),
    viewedAt: iso(row.viewed_at),
  };
}

@Injectable()
export class CareCoordinationService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REMINDER_DELIVERY_ADAPTER) private readonly delivery: ReminderDeliveryAdapter,
    private readonly notifications: NotificationsService,
  ) {}

  async listFollowUps(principal: AuthenticatedPrincipal, consultationId: string) {
    await this.consultation(this.database, principal, consultationId);
    const rows = await this.database.query<FollowUpRow>(
      `SELECT * FROM follow_ups WHERE consultation_id=$1 ORDER BY starts_at,id`, [consultationId],
    );
    return { items: rows.rows.map(followUpDto) };
  }

  async createFollowUp(principal: AuthenticatedPrincipal, consultationId: string, rawKey: string | undefined, input: CreateFollowUpDto) {
    const key = requiredKey(rawKey);
    const startsAt = dateInput(input.startsAt, 'startsAt');
    const endsAt = dateInput(input.endsAt, 'endsAt');
    const reason = normalizeText(input.reason, 3, 1000, 'reason');
    const fingerprint = sha256({ consultationId, startsAt, endsAt, reason });
    const scope = `follow-up:create:${consultationId}`;

    return this.database.transaction(async (client) => {
      const context = await this.consultation(client, principal, consultationId);
      await this.lockVet(client, context.vet_id);
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      await this.assertCareContext(client, context, true);
      const availability = await client.query<{ timezone: string; weekday_rules: unknown }>(
        'SELECT timezone,weekday_rules FROM vet_availabilities WHERE vet_id=$1', [context.vet_id],
      );
      const schedule = availability.rows[0];
      if (!schedule) ruleViolation('Jam kerja dokter belum tersedia untuk menjadwalkan tindak lanjut.');
      this.assertFollowUpSlot(startsAt, endsAt, schedule.timezone, schedule.weekday_rules);
      const overlap = await client.query(
        `SELECT 1 FROM vet_blocked_times b
           WHERE b.vet_id=$1 AND b.status='active' AND b.starts_at<$3 AND b.ends_at>$2
         UNION ALL
         SELECT 1 FROM consultations c
           WHERE c.vet_id=$1 AND c.id<>$4 AND c.status=ANY($5::consultation_status[])
             AND c.starts_at<$3 AND c.ends_at>$2
         UNION ALL
         SELECT 1 FROM consultation_schedule_proposals p JOIN consultations c ON c.id=p.consultation_id
           WHERE c.vet_id=$1 AND p.status='pending' AND p.starts_at<$3 AND p.ends_at>$2
         UNION ALL
         SELECT 1 FROM follow_ups f
           WHERE f.vet_id=$1 AND f.status='scheduled' AND f.starts_at<$3 AND f.ends_at>$2
         LIMIT 1`,
        [context.vet_id, startsAt, endsAt, context.id, ACTIVE_CONSULTATION_STATUSES],
      );
      if (overlap.rowCount) conflict('Slot tindak lanjut berbenturan dengan janji, usulan jadwal, atau blok waktu dokter.', 'SLOT_CONFLICT');

      const inserted = await client.query<FollowUpRow>(
        `INSERT INTO follow_ups
           (consultation_id,farmer_id,vet_id,animal_id,starts_at,ends_at,timezone,reason,operation_key,request_fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [context.id, context.farmer_id, context.vet_id, context.animal_id, startsAt, endsAt, schedule.timezone, reason, key, fingerprint],
      );
      const followUp = inserted.rows[0];
      await this.storeNotification(client, {
        actorId: principal.userId, recipientId: context.farmer_id, type: 'follow_up_scheduled', category: 'reminders',
        contextType: 'follow_up', contextId: followUp.id, aggregateVersion: followUp.version,
        eventId: `follow-up-scheduled:${followUp.id}`, title: 'Tindak lanjut dijadwalkan',
        body: 'Dokter menjadwalkan pemeriksaan ulang untuk ternak Anda.',
      });
      const response = { ...followUpDto(followUp), operationId: randomUUID(), replayed: false };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'follow_up', followUp.id, response);
      return response;
    });
  }

  async updateFollowUp(principal: AuthenticatedPrincipal, followUpId: string, rawKey: string | undefined, input: UpdateFollowUpDto) {
    const key = requiredKey(rawKey);
    const scope = `follow-up:update:${followUpId}`;
    const fingerprint = sha256({ action: input.action, expectedVersion: input.expectedVersion });
    return this.database.transaction(async (client) => {
      const visible = await this.followUpContext(client, principal, followUpId);
      await this.lockVet(client, visible.vet_id);
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      const found = await client.query<FollowUpRow>('SELECT * FROM follow_ups WHERE id=$1 FOR UPDATE', [followUpId]);
      const row = found.rows[0];
      if (!row) throw new NotFoundException(error('NOT_FOUND', 'Tindak lanjut tidak ditemukan.'));
      if (row.version !== input.expectedVersion) conflict('Data tindak lanjut berubah sejak dibuka.', 'VERSION_CONFLICT');
      if (row.status === 'completed') ruleViolation('Tindak lanjut yang sudah diselesaikan tidak dapat dibatalkan.', 'INVALID_STATE');
      let updated = row;
      if (row.status === 'scheduled') {
        const result = await client.query<FollowUpRow>(
          `UPDATE follow_ups SET status='cancelled',version=version+1,updated_at=now()
           WHERE id=$1 AND version=$2 RETURNING *`, [followUpId, input.expectedVersion],
        );
        updated = result.rows[0];
        const actorIsVet = principal.userId === row.vet_id;
        await this.storeNotification(client, {
          actorId: principal.userId, recipientId: actorIsVet ? row.farmer_id : row.vet_id,
          type: 'follow_up_cancelled', category: 'reminders', contextType: 'follow_up', contextId: row.id,
          aggregateVersion: updated.version, eventId: `follow-up-cancelled:${row.id}`,
          title: 'Tindak lanjut dibatalkan', body: 'Jadwal pemeriksaan ulang telah dibatalkan.',
        });
      }
      const response = { ...followUpDto(updated), operationId: randomUUID(), replayed: false };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'follow_up', followUpId, response);
      return response;
    });
  }

  async listProgressReports(principal: AuthenticatedPrincipal, followUpId: string) {
    const followUp = await this.followUpContext(this.database, principal, followUpId);
    if (principal.activeRole === 'vet') {
      await this.database.query('UPDATE progress_reports SET viewed_at=COALESCE(viewed_at,now()) WHERE follow_up_id=$1', [followUpId]);
    }
    const rows = await this.database.query<ReportRow>(
      `SELECT r.*,COALESCE(array_agg(a.attachment_id ORDER BY a.position) FILTER(WHERE a.attachment_id IS NOT NULL),'{}') AS attachment_ids
       FROM progress_reports r LEFT JOIN progress_report_attachments a ON a.report_id=r.id
       WHERE r.follow_up_id=$1 AND r.farmer_id=$2 AND r.vet_id=$3 AND r.animal_id=$4
       GROUP BY r.id ORDER BY r.submitted_at,r.id`,
      [followUp.id, followUp.farmer_id, followUp.vet_id, followUp.animal_id],
    );
    return { items: rows.rows.map(reportDto) };
  }

  async createProgressReport(principal: AuthenticatedPrincipal, followUpId: string, rawKey: string | undefined, input: CreateProgressReportDto) {
    const key = requiredKey(rawKey);
    const text = normalizeText(input.text, 3, 2000, 'text');
    const attachmentIds = input.attachmentIds ?? [];
    if (new Set(attachmentIds).size !== attachmentIds.length) validation('attachmentIds', 'Lampiran tidak boleh berulang.');
    const fingerprint = sha256({ followUpId, text, attachmentIds: [...attachmentIds].sort() });
    const scope = `progress-report:create:${followUpId}`;
    return this.database.transaction(async (client) => {
      const followUp = await this.followUpContext(client, principal, followUpId);
      if (principal.activeRole !== 'farmer') throw new ForbiddenException(error('FORBIDDEN', 'Hanya Peternak pemilik yang dapat mengirim laporan perkembangan.'));
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      if (followUp.status === 'cancelled') ruleViolation('Laporan tidak dapat ditambahkan ke tindak lanjut yang dibatalkan.', 'INVALID_STATE');

      if (attachmentIds.length) {
        const attachments = await client.query<{ id: string }>(
          `SELECT id FROM attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND consultation_id=$3
             AND upload_status='committed' ORDER BY id FOR UPDATE`,
          [attachmentIds, principal.userId, followUp.consultation_id],
        );
        if (attachments.rowCount !== attachmentIds.length) {
          throw new ForbiddenException(error('FORBIDDEN', 'Lampiran harus sudah diunggah, dikomit, dan dimiliki Peternak pada layanan ini.'));
        }
        const alreadyLinked = await client.query(
          `SELECT 1 FROM progress_report_attachments WHERE attachment_id=ANY($1::uuid[])
           UNION ALL SELECT 1 FROM message_attachments WHERE attachment_id=ANY($1::uuid[]) LIMIT 1`, [attachmentIds],
        );
        if (alreadyLinked.rowCount) ruleViolation('Lampiran sudah digunakan oleh record lain.', 'ATTACHMENT_ALREADY_USED');
      }

      const inserted = await client.query<ReportRow>(
        `INSERT INTO progress_reports
           (consultation_id,follow_up_id,farmer_id,vet_id,animal_id,text,operation_key,request_fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,ARRAY[]::uuid[] AS attachment_ids`,
        [followUp.consultation_id, followUp.id, principal.userId, followUp.vet_id, followUp.animal_id, text, key, fingerprint],
      );
      const report = inserted.rows[0];
      for (const [position, attachmentId] of attachmentIds.entries()) {
        await client.query(
          `INSERT INTO progress_report_attachments(report_id,attachment_id,consultation_id,farmer_id,position)
           VALUES($1,$2,$3,$4,$5)`, [report.id, attachmentId, followUp.consultation_id, principal.userId, position],
        );
      }
      const responseDto = reportDto({ ...report, attachment_ids: attachmentIds });
      await this.storeNotification(client, {
        actorId: principal.userId, recipientId: followUp.vet_id, type: 'progress_report_submitted', category: 'reminders',
        contextType: 'progress_report', contextId: report.id, aggregateVersion: 1,
        eventId: `progress-report-submitted:${report.id}`, title: 'Laporan perkembangan baru',
        body: 'Peternak mengirim laporan perkembangan ternak.',
      });
      const response = { ...responseDto, operationId: randomUUID(), replayed: false };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'progress_report', report.id, response);
      return response;
    });
  }

  async listReminders(principal: AuthenticatedPrincipal) {
    const rows = principal.activeRole === 'farmer'
      ? await this.database.query<ReminderRow>('SELECT * FROM reminders WHERE farmer_id=$1 ORDER BY due_at,id', [principal.userId])
      : await this.database.query<ReminderRow>('SELECT * FROM reminders WHERE vet_id=$1 ORDER BY due_at,id', [principal.userId]);
    return { items: rows.rows.map(reminderDto) };
  }

  async createReminder(principal: AuthenticatedPrincipal, rawKey: string | undefined, input: CreateReminderDto) {
    const key = requiredKey(rawKey);
    const dueAt = dateInput(input.dueAt, 'dueAt');
    const instructions = normalizeText(input.instructions, 3, 500, 'instructions');
    if (Date.parse(dueAt) <= Date.now()) ruleViolation('Pengingat baru harus dijadwalkan pada waktu mendatang.', 'REMINDER_IN_PAST');
    const scope = 'reminder:create';
    return this.database.transaction(async (client) => {
      const linkedFollowUp = input.followUpId ? await this.followUpContext(client, principal, input.followUpId) : null;
      let context: Context | null = null;
      if (input.consultationId) context = await this.consultation(client, principal, input.consultationId);
      if (linkedFollowUp && context && linkedFollowUp.consultation_id !== context.id) throw new ForbiddenException(error('FORBIDDEN', 'Tindak lanjut tidak terkait dengan layanan ini.'));
      if (!context && linkedFollowUp) context = await this.consultation(client, principal, linkedFollowUp.consultation_id);
      if (principal.activeRole === 'vet' && !context) validation('consultationId', 'Dokter harus mengaitkan pengingat dengan layanan yang ditugaskan.');

      let animalId = input.animalId?.trim() || context?.animal_id || linkedFollowUp?.animal_id || '';
      if (!animalId) validation('animalId', 'Pilih ternak untuk pengingat.');
      if (context && context.animal_id !== animalId) throw new ForbiddenException(error('FORBIDDEN', 'Ternak tidak sesuai dengan layanan ini.'));
      if (linkedFollowUp && (linkedFollowUp.animal_id !== animalId || linkedFollowUp.consultation_id !== context?.id)) {
        throw new ForbiddenException(error('FORBIDDEN', 'Tindak lanjut tidak terkait dengan ternak dan layanan ini.'));
      }
      const animal = await client.query<{ farmer_id: string; timezone: string }>(
        `SELECT l.farmer_id,f.timezone FROM livestock l JOIN farms f ON f.id=l.farm_id
         WHERE l.id=$1 AND l.farmer_id=$2`, [animalId, context?.farmer_id ?? principal.userId],
      );
      if (!animal.rows[0]) throw new NotFoundException(error('NOT_FOUND', 'Ternak tidak ditemukan.'));
      const farmerId = animal.rows[0].farmer_id;
      if (context && (context.farmer_id !== farmerId || context.animal_id !== animalId)) throw new ForbiddenException(error('FORBIDDEN', 'Relasi ternak dan layanan tidak valid.'));
      if (context) {
        if (!CARE_CONTEXT_STATUSES.has(context.status)) ruleViolation('Pengingat terkait layanan hanya dapat dibuat setelah layanan terjadwal.', 'INVALID_STATE');
        if (principal.activeRole === 'vet') await this.assertCareContext(client, context, true);
        else await this.assertCareContext(client, context, false);
      }
      if (linkedFollowUp?.status === 'cancelled') ruleViolation('Pengingat tidak dapat ditautkan ke tindak lanjut yang dibatalkan.', 'INVALID_STATE');

      const normalized = {
        animalId, consultationId: context?.id ?? null, followUpId: linkedFollowUp?.id ?? null,
        kind: input.kind, dueAt, instructions,
      };
      const fingerprint = sha256({ actorRole: principal.activeRole, actorId: principal.userId, ...normalized });
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      const reminderId = randomUUID();
      const added = await client.query<ReminderRow>(
        `INSERT INTO reminders(id,animal_id,farmer_id,consultation_id,vet_id,follow_up_id,created_by,kind,due_at,instructions,operation_key,request_fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [reminderId, animalId, farmerId, context?.id ?? null, context?.vet_id ?? null, linkedFollowUp?.id ?? null,
          principal.userId, input.kind, dueAt, instructions, key, fingerprint],
      );
      let reminder = added.rows[0];
      const attempt = 1;
      const outcome = await this.deliver({ reminderId, recipientId: farmerId, dueAt, attempt });
      await this.storeReminderDelivery(client, reminder, principal.userId, sha256({ scope: 'create', key }), outcome, attempt);
      const refreshed = await client.query<ReminderRow>('SELECT * FROM reminders WHERE id=$1', [reminderId]);
      reminder = refreshed.rows[0];
      await this.storeNotification(client, {
        actorId: principal.userId, recipientId: farmerId, type: 'reminder_created', category: 'reminders',
        contextType: 'reminder', contextId: reminder.id, aggregateVersion: reminder.version,
        eventId: `reminder-created:${reminder.id}`, title: 'Pengingat perawatan baru',
        body: 'Pengingat perawatan ternak telah dijadwalkan.',
      });
      const response = { ...reminderDto(reminder), deliveryOutcome: outcome, operationId: randomUUID(), replayed: false };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'reminder', reminder.id, response);
      return response;
    });
  }

  async retryReminderDelivery(principal: AuthenticatedPrincipal, reminderId: string, rawKey: string | undefined, input: UpdateReminderDto) {
    const key = requiredKey(rawKey);
    const scope = `reminder:delivery:${reminderId}`;
    const fingerprint = sha256({ action: input.action });
    return this.database.transaction(async (client) => {
      let reminder = await this.reminderForPrincipal(client, principal, reminderId);
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      await client.query('SELECT id FROM reminders WHERE id=$1 FOR UPDATE', [reminderId]);
      reminder = await this.reminderForPrincipal(client, principal, reminderId);
      if (reminder.delivery_status === 'sent') {
        const response = { ...reminderDto(reminder), operationId: randomUUID(), replayed: false };
        await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'reminder', reminder.id, response);
        return response;
      }
      const attempt = reminder.delivery_attempt + 1;
      const outcome = await this.deliver({ reminderId, recipientId: reminder.farmer_id, dueAt: iso(reminder.due_at)!, attempt });
      await this.storeReminderDelivery(client, reminder, principal.userId, sha256({ scope: 'retry', key }), outcome, attempt);
      const current = (await client.query<ReminderRow>('SELECT * FROM reminders WHERE id=$1', [reminderId])).rows[0];
      const response = { ...reminderDto(current), deliveryOutcome: outcome, operationId: randomUUID(), replayed: false };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'reminder', reminderId, response);
      return response;
    });
  }

  async completeCare(principal: AuthenticatedPrincipal, reminderId: string, rawKey: string | undefined, input: CompleteCareDto) {
    const key = requiredKey(rawKey);
    if (input.confirmation !== true) ruleViolation('Konfirmasi bahwa perawatan dilakukan wajib diberikan.', 'CONFIRMATION_REQUIRED');
    const scope = `reminder:care-complete:${reminderId}`;
    const fingerprint = sha256({ confirmation: true });
    return this.database.transaction(async (client) => {
      const reminder = await this.reminderForPrincipal(client, principal, reminderId);
      if (principal.activeRole !== 'farmer' || reminder.farmer_id !== principal.userId) {
        throw new ForbiddenException(error('FORBIDDEN', 'Hanya Peternak pemilik yang dapat menyelesaikan perawatan.'));
      }
      if (reminder.kind !== 'care') ruleViolation('Pengingat ini bukan tindakan perawatan.', 'INVALID_STATE');
      const replay = await this.replay(client, principal.userId, scope, key, fingerprint);
      if (replay) return replay;
      await client.query('SELECT id FROM reminders WHERE id=$1 FOR UPDATE', [reminderId]);
      const eventKey = `reminder:${reminderId}`;
      const completedAt = reminder.care_status === 'done' ? iso(reminder.completed_at) : new Date().toISOString();
      let healthEvent = await client.query<{ id: string; occurred_at: Date | string; description: string; actor_id: string; animal_id: string }>(
        `INSERT INTO health_events(animal_id,kind,occurred_at,description,actor_id,provenance,source_key)
         VALUES($1,'care',$2,$3,$4,'reminder',$5)
         ON CONFLICT (provenance,source_key) DO NOTHING
         RETURNING id,occurred_at,description,actor_id,animal_id`,
        [reminder.animal_id, completedAt, reminder.instructions, principal.userId, eventKey],
      );
      if (!healthEvent.rows[0]) {
        healthEvent = await client.query<{ id: string; occurred_at: Date | string; description: string; actor_id: string; animal_id: string }>(
          `SELECT id,occurred_at,description,actor_id,animal_id FROM health_events WHERE provenance='reminder' AND source_key=$1`, [eventKey],
        );
      }
      const event = healthEvent.rows[0];
      if (!event || event.animal_id !== reminder.animal_id || event.actor_id !== principal.userId || event.description !== reminder.instructions) {
        conflict('HealthEvent pengingat memiliki isi atau pemilik yang berbeda.', 'IDEMPOTENCY_CONFLICT');
      }
      const current = (await client.query<ReminderRow>(
        `UPDATE reminders SET care_status='done',completed_at=$2,version=version+1,updated_at=now()
         WHERE id=$1 AND care_status='scheduled' RETURNING *`, [reminderId, iso(event.occurred_at)],
      )).rows[0] ?? (await client.query<ReminderRow>('SELECT * FROM reminders WHERE id=$1', [reminderId])).rows[0];
      if (current.consultation_id && current.vet_id) {
        await this.storeNotification(client, {
          actorId: principal.userId, recipientId: current.vet_id, type: 'care_completed', category: 'reminders',
          contextType: 'reminder', contextId: current.id, aggregateVersion: current.version,
          eventId: `care-completed:${current.id}`, title: 'Perawatan ditandai dilakukan',
          body: 'Peternak mengonfirmasi bahwa perawatan ternak telah dilakukan.',
        });
      }
      const response = {
        reminder: reminderDto(current), healthEventId: event.id, operationId: randomUUID(), replayed: false,
      };
      await this.saveOperation(client, principal.userId, scope, key, fingerprint, 'reminder', reminderId, response);
      return response;
    });
  }

  private async consultation(db: DatabaseService | PoolClient, principal: AuthenticatedPrincipal, consultationId: string): Promise<Context> {
    const column = principal.activeRole === 'vet' ? 'vet_id' : 'farmer_id';
    const result = await this.query<Context>(db,
      `SELECT c.id,c.farmer_id,c.vet_id,c.animal_id,c.status,c.fee_snapshot_idr,
              v.verification_status,a.timezone
       FROM consultations c JOIN vet_profiles v ON v.user_id=c.vet_id
       LEFT JOIN vet_availabilities a ON a.vet_id=c.vet_id
       WHERE c.id=$1 AND c.${column}=$2`, [consultationId, principal.userId],
    );
    if (!result.rows[0]) throw new NotFoundException(error('NOT_FOUND', 'Layanan tidak ditemukan.'));
    return result.rows[0];
  }

  private async followUpContext(db: DatabaseService | PoolClient, principal: AuthenticatedPrincipal, followUpId: string) {
    const column = principal.activeRole === 'vet' ? 'vet_id' : 'farmer_id';
    const result = await this.query<FollowUpRow>(db,
      `SELECT f.* FROM follow_ups f JOIN consultations c ON c.id=f.consultation_id
       WHERE f.id=$1 AND f.${column}=$2 AND c.${principal.activeRole === 'vet' ? 'vet_id' : 'farmer_id'}=$2`,
      [followUpId, principal.userId],
    );
    if (!result.rows[0]) throw new NotFoundException(error('NOT_FOUND', 'Tindak lanjut tidak ditemukan.'));
    return result.rows[0];
  }

  private async assertCareContext(client: PoolClient, context: Context, requireVerifiedVet: boolean) {
    if (!CARE_CONTEXT_STATUSES.has(context.status)) ruleViolation('Tindakan ini memerlukan layanan terjadwal, berlangsung, atau selesai.', 'INVALID_STATE');
    if (requireVerifiedVet && context.verification_status !== 'verified') {
      throw new ForbiddenException(error('VET_NOT_VERIFIED', 'Dokter harus terverifikasi untuk mengelola tindak lanjut atau pengingat layanan.'));
    }
    const fee = Number(context.fee_snapshot_idr);
    if (!Number.isSafeInteger(fee) || fee < 0) ruleViolation('Snapshot biaya layanan tidak valid.', 'INVALID_STATE');
    const [payment, note] = await Promise.all([
      client.query(
        `SELECT 1 FROM payments WHERE owner_id=$1 AND payable_type='consultation' AND payable_id=$2
           AND status='succeeded' AND amount_idr=$3 LIMIT 1`, [context.farmer_id, context.id, fee],
      ),
      client.query("SELECT 1 FROM clinical_notes WHERE consultation_id=$1 AND status='final' AND finalized_by=$2", [context.id, context.vet_id]),
    ]);
    if (!payment.rowCount || !note.rowCount) ruleViolation('Layanan harus dibayar dan memiliki catatan final sebelum tindak lanjut dikelola.', 'CARE_CONTEXT_NOT_READY');
  }

  private assertFollowUpSlot(startsAt: string, endsAt: string, timezone: string, rawRules: unknown) {
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    const duration = (end - start) / 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.now() || start >= end
      || !Number.isInteger(duration) || duration < 5 || duration > 240 || start % 60_000 !== 0 || end % 60_000 !== 0) {
      ruleViolation('Slot tindak lanjut harus di masa depan dan berdurasi 5–240 menit dalam menit penuh.', 'INVALID_FOLLOW_UP_SLOT');
    }
    const localStart = timeParts(startsAt, timezone);
    const localEnd = timeParts(endsAt, timezone);
    if (localStart.date !== localEnd.date || localStart.weekday < 0) {
      ruleViolation('Tindak lanjut harus berada pada satu hari kalender lokal dokter.', 'INVALID_FOLLOW_UP_SLOT');
    }
    const rules = typeof rawRules === 'string' ? JSON.parse(rawRules) as unknown : rawRules;
    const list = Array.isArray(rules) ? rules : [];
    const allowed = list.some((rule) => {
      if (!rule || typeof rule !== 'object') return false;
      const item = rule as Record<string, unknown>;
      return item.weekday === localStart.weekday && typeof item.start === 'string' && typeof item.end === 'string'
        && item.start < item.end && localStart.time >= item.start && localEnd.time <= item.end;
    });
    if (!allowed) ruleViolation('Slot tindak lanjut harus berada dalam jam kerja dokter.', 'OUTSIDE_VET_HOURS');
  }

  private async reminderForPrincipal(client: PoolClient, principal: AuthenticatedPrincipal, reminderId: string): Promise<ReminderRow> {
    const column = principal.activeRole === 'vet' ? 'vet_id' : 'farmer_id';
    const result = await client.query<ReminderRow>(
      `SELECT r.* FROM reminders r LEFT JOIN consultations c ON c.id=r.consultation_id
       WHERE r.id=$1 AND r.${column}=$2 AND (r.consultation_id IS NULL OR c.${principal.activeRole === 'vet' ? 'vet_id' : 'farmer_id'}=$2)`,
      [reminderId, principal.userId],
    );
    if (!result.rows[0]) throw new NotFoundException(error('NOT_FOUND', 'Pengingat tidak ditemukan.'));
    return result.rows[0];
  }

  private async deliver(input: { reminderId: string; recipientId: string; dueAt: string; attempt: number }): Promise<AdapterResult<void>> {
    try {
      return await this.delivery.deliver(input);
    } catch {
      return adapterFailed('LOCAL_REMINDER_DELIVERY_UNAVAILABLE', 'Pengiriman pengingat sementara gagal.', true);
    }
  }

  private async storeReminderDelivery(
    client: PoolClient, reminder: ReminderRow, actorId: string, key: string, outcome: AdapterResult<void>, attempt: number,
  ) {
    const fingerprint = sha256({ reminderId: reminder.id, recipientId: reminder.farmer_id, attempt });
    await client.query(
      `INSERT INTO reminder_delivery_attempts
         (reminder_id,actor_id,attempt,idempotency_key,request_fingerprint,operation_id,outcome,error,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [reminder.id, actorId, attempt, key, fingerprint, outcome.operationId, outcome.status,
        outcome.status === 'failed' ? JSON.stringify(outcome.error) : null, outcome.occurredAt],
    );
    await client.query(
      `UPDATE reminders SET delivery_status=$2,delivery_attempt=$3,delivery_operation_id=$4,delivery_error=$5::jsonb,
         version=version+1,updated_at=now() WHERE id=$1`,
      [reminder.id, outcome.status === 'succeeded' ? 'sent' : outcome.status, attempt, outcome.operationId,
        outcome.status === 'failed' ? JSON.stringify(outcome.error) : null],
    );
  }

  private async operationLock(client: PoolClient, actorId: string, scope: string, key: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`care:${actorId}:${scope}:${key}`]);
  }

  private async replay(client: PoolClient, actorId: string, scope: string, key: string, fingerprint: string) {
    await this.operationLock(client, actorId, scope, key);
    const result = await client.query<{ request_fingerprint: string; response_json: unknown }>(
      `SELECT request_fingerprint,response_json FROM care_coordination_operations
       WHERE actor_id=$1 AND operation_scope=$2 AND idempotency_key=$3 FOR UPDATE`, [actorId, scope, key],
    );
    const prior = result.rows[0];
    if (!prior) return null;
    if (prior.request_fingerprint !== fingerprint) conflict('Idempotency-Key sudah digunakan untuk payload berbeda.', 'IDEMPOTENCY_CONFLICT');
    return { ...jsonValue<Record<string, unknown>>(prior.response_json), replayed: true };
  }

  private async saveOperation(
    client: PoolClient, actorId: string, scope: string, key: string, fingerprint: string,
    resourceType: string, resourceId: string, response: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO care_coordination_operations
         (actor_id,operation_scope,idempotency_key,request_fingerprint,resource_type,resource_id,response_json)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [actorId, scope, key, fingerprint, resourceType, resourceId, JSON.stringify(response)],
    );
  }

  private async storeNotification(client: PoolClient, input: {
    actorId: string; recipientId: string; type: string; category: NotificationCategory;
    contextType: NotificationContextType; contextId: string; aggregateVersion: number; eventId: string;
    title: string; body: string;
  }) {
    await this.notifications.recordEvent(client, input);
  }

  private async lockVet(client: PoolClient, vetId: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [vetId]);
  }

  private query<Row extends QueryResultRow>(db: DatabaseService | PoolClient, sql: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
    if (db instanceof DatabaseService) return db.query<Row>(sql, values);
    return db.query<Row>(sql, [...values]);
  }
}
