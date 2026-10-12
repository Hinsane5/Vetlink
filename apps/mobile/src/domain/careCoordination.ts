import type { DomainEntity } from './entities';
import { DomainError } from './errors';
import { localTimestamp, validDate, validTime } from './availability';

export type ReminderKind = 'care' | 'follow_up';

export type FollowUpInput = {
  startsAt: string;
  endsAt: string;
  reason: string;
  operationKey: string;
};

export type ReminderInput = {
  consultationId: string;
  followUpId: string | null;
  kind: ReminderKind;
  dueAt: string;
  instructions: string;
  operationKey: string;
};

export type ProgressReportInput = {
  text: string;
  operationKey: string;
};

export type ReminderSnapshot = {
  record: DomainEntity;
  animalId: string;
  consultationId: string | null;
  followUpId: string | null;
  kind: ReminderKind;
  dueAt: string;
  instructions: string;
  careStatus: 'scheduled' | 'done';
  deliveryStatus: 'pending' | 'sent' | 'failed';
  completedAt: string | null;
};

export type ProgressReportSnapshot = {
  record: DomainEntity;
  followUpId: string;
  text: string;
  submittedAt: string;
  viewedAt: string | null;
};

export type CareCoordinationSnapshot = {
  consultationId: string;
  animalId: string;
  timezone: string;
  canScheduleFollowUp: boolean;
  followUps: DomainEntity[];
  reminders: ReminderSnapshot[];
  reports: ProgressReportSnapshot[];
};

export function validateFollowUpInput(input: FollowUpInput, timezone: string, now: Date) {
  if (!input || typeof input !== 'object') throw new DomainError('VALIDATION_FAILED', 'Jadwal tindak lanjut tidak valid.');
  const startsAt = parseLocalDateTime(input.startsAt, timezone, 'Waktu mulai');
  const endsAt = parseLocalDateTime(input.endsAt, timezone, 'Waktu selesai');
  const duration = (Date.parse(endsAt) - Date.parse(startsAt)) / 60_000;
  if (Date.parse(startsAt) <= now.getTime()) throw new DomainError('VALIDATION_FAILED', 'Tindak lanjut harus dijadwalkan pada waktu mendatang.');
  if (!Number.isInteger(duration) || duration < 5 || duration > 240) throw new DomainError('VALIDATION_FAILED', 'Durasi tindak lanjut harus 5–240 menit.');
  const reason = normalizeText(input.reason, 3, 1000, 'Alasan tindak lanjut');
  return { startsAt, endsAt, reason, operationKey: validateOperationKey(input.operationKey) };
}

export function validateReminderInput(input: ReminderInput, timezone: string, now: Date) {
  if (!input || typeof input !== 'object' || !['care', 'follow_up'].includes(input.kind)
    || typeof input.consultationId !== 'string' || !input.consultationId.trim()) {
    throw new DomainError('VALIDATION_FAILED', 'Jenis pengingat tidak valid.');
  }
  const dueAt = parseLocalDateTime(input.dueAt, timezone, 'Waktu pengingat');
  if (Date.parse(dueAt) <= now.getTime()) throw new DomainError('VALIDATION_FAILED', 'Pengingat baru harus dijadwalkan pada waktu mendatang.');
  return {
    consultationId: input.consultationId.trim(),
    followUpId: input.followUpId?.trim() || null,
    kind: input.kind,
    dueAt,
    instructions: normalizeText(input.instructions, 3, 500, 'Instruksi pengingat'),
    operationKey: validateOperationKey(input.operationKey),
  };
}

export function validateProgressReportInput(input: ProgressReportInput) {
  if (!input || typeof input !== 'object') throw new DomainError('VALIDATION_FAILED', 'Laporan perkembangan tidak valid.');
  return {
    text: normalizeText(input.text, 3, 2000, 'Laporan perkembangan'),
    operationKey: validateOperationKey(input.operationKey),
  };
}

export function parseLocalDateTime(value: string, timezone: string, label: string): string {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${label} harus berformat YYYY-MM-DD HH:mm.`);
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(trimmed);
  if (!match || !validDate(match[1]) || !validTime(match[2])) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berformat YYYY-MM-DD HH:mm.`);
  }
  return localTimestamp(trimmed, timezone);
}

function normalizeText(value: unknown, min: number, max: number, label: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < min || text.length > max) throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${min}–${max} karakter.`);
  return text;
}

function validateOperationKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(key)) throw new DomainError('VALIDATION_FAILED', 'Identitas tindakan tidak valid.');
  return key;
}
