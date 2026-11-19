import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import { validateFollowUpInput, validateProgressReportInput, validateReminderInput } from '../domain/careCoordination';
import type { ApiCareCompletion, ApiCareCoordinationRepository, ApiFollowUp, ApiProgressReport, ApiReminder } from './ports/ApiCareCoordinationRepository';
import type { ApiConsultationDetail } from './ports/ApiConsultationRepository';
import type { ServerVetScheduleService } from './ServerVetScheduleService';

export interface ServerCareCoordinationSnapshot {
  timezone: string;
  followUps: ApiFollowUp[];
  reminders: ApiReminder[];
  reports: ApiProgressReport[];
  pending: PendingCareCoordinationOperation | null;
}

export type PendingCareCoordinationOperation =
  | { type: 'follow_up'; idempotencyKey: string; startsAt: string; endsAt: string; reason: string }
  | { type: 'reminder'; idempotencyKey: string; followUpId: string | null; kind: 'care' | 'follow_up'; dueAt: string; instructions: string }
  | { type: 'progress_report'; idempotencyKey: string; followUpId: string; text: string }
  | { type: 'care_completion'; idempotencyKey: string; reminderId: string };

export interface PendingCareCoordinationStore {
  read(userId: string, consultationId: string): Promise<PendingCareCoordinationOperation | null>;
  write(userId: string, consultationId: string, operation: PendingCareCoordinationOperation): Promise<void>;
  clear(userId: string, consultationId: string): Promise<void>;
}

/** Keeps BE-09 reads and writes on the server's assigned-service boundary. */
export class ServerCareCoordinationService {
  constructor(
    private readonly care: ApiCareCoordinationRepository,
    private readonly schedule: ServerVetScheduleService,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly pending?: PendingCareCoordinationStore,
  ) {}

  newOperationKey(): string {
    const key = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(key)) throw new DomainError('VALIDATION_FAILED', 'Generator identitas operasi menghasilkan nilai tidak valid.');
    return key;
  }

  async load(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<ServerCareCoordinationSnapshot> {
    this.requireConsultationAccess(role, userId, consultation);
    const [timezone, followUps, reminders] = await Promise.all([
      this.schedule.timezoneFor(role, userId, consultation.vetId),
      this.care.listFollowUps(consultation.id),
      this.care.listReminders(),
    ]);
    for (const followUp of followUps) {
      if (followUp.consultationId !== consultation.id || followUp.animalId !== consultation.animalId
        || followUp.farmerId !== consultation.farmerId || followUp.vetId !== consultation.vetId) {
        throw new DomainError('API_RESPONSE_INVALID', 'Tindak lanjut server tidak terhubung ke layanan yang dipilih.');
      }
    }
    const reports = (await Promise.all(followUps.map((item) => this.care.listProgressReports(item.id)))).flat();
    if (reports.some((report) => !followUps.some((followUp) => followUp.id === report.followUpId)
      || report.consultationId !== consultation.id || report.animalId !== consultation.animalId
      || report.farmerId !== consultation.farmerId || report.vetId !== consultation.vetId)) {
      throw new DomainError('API_RESPONSE_INVALID', 'Laporan perkembangan server tidak terhubung ke layanan yang dipilih.');
    }
    const matchingReminders = reminders.filter((item) => item.consultationId === consultation.id);
    if (matchingReminders.some((item) => item.animalId !== consultation.animalId || item.ownerId !== consultation.farmerId)) {
      throw new DomainError('API_RESPONSE_INVALID', 'Pengingat server tidak terhubung ke ternak layanan yang dipilih.');
    }
    const pending = await this.pending?.read(userId, consultation.id) ?? null;
    if (pending?.type === 'progress_report' && !followUps.some((item) => item.id === pending.followUpId)) {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Laporan tertunda tidak cocok dengan tindak lanjut server.');
    }
    if (pending?.type === 'care_completion' && !matchingReminders.some((item) => item.id === pending.reminderId)) {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Konfirmasi perawatan tertunda tidak cocok dengan pengingat server.');
    }
    if (pending?.type === 'reminder' && pending.followUpId && !followUps.some((item) => item.id === pending.followUpId)) {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Pengingat tertunda tidak cocok dengan tindak lanjut server.');
    }
    return {
      timezone,
      followUps: [...followUps].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
      reminders: [...matchingReminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)),
      reports: [...reports].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id)),
      pending,
    };
  }

  async scheduleFollowUp(role: AccountRole, userId: string, consultation: ApiConsultationDetail, timezone: string, input: { startsAt: string; endsAt: string; reason: string; operationKey: string }): Promise<ApiFollowUp> {
    this.requireConsultationAccess(role, userId, consultation);
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter yang ditugaskan dapat menjadwalkan tindak lanjut.');
    const normalized = validateFollowUpInput(input, timezone, this.now());
    const pending: PendingCareCoordinationOperation = { type: 'follow_up', idempotencyKey: normalized.operationKey, startsAt: normalized.startsAt, endsAt: normalized.endsAt, reason: normalized.reason };
    return this.withPending(userId, consultation.id, pending, async () => {
      const result = await this.care.createFollowUp(consultation.id, {
        idempotencyKey: normalized.operationKey,
        payload: { startsAt: normalized.startsAt, endsAt: normalized.endsAt, reason: normalized.reason },
      });
      this.assertFollowUp(result, consultation);
      return result;
    });
  }

  async createReminder(role: AccountRole, userId: string, consultation: ApiConsultationDetail, timezone: string, input: { followUpId: string | null; kind: 'care' | 'follow_up'; dueAt: string; instructions: string; operationKey: string }): Promise<ApiReminder> {
    this.requireConsultationAccess(role, userId, consultation);
    const normalized = validateReminderInput({ ...input, consultationId: consultation.id }, timezone, this.now());
    const pending: PendingCareCoordinationOperation = { type: 'reminder', idempotencyKey: normalized.operationKey, followUpId: normalized.followUpId, kind: normalized.kind, dueAt: normalized.dueAt, instructions: normalized.instructions };
    return this.withPending(userId, consultation.id, pending, async () => {
      const result = await this.care.createReminder({
        idempotencyKey: normalized.operationKey,
        payload: { animalId: consultation.animalId, consultationId: consultation.id, ...(normalized.followUpId ? { followUpId: normalized.followUpId } : {}), kind: normalized.kind, dueAt: normalized.dueAt, instructions: normalized.instructions },
      });
      if (result.consultationId !== consultation.id || result.animalId !== consultation.animalId || result.ownerId !== consultation.farmerId) {
        throw new DomainError('API_RESPONSE_INVALID', 'Pengingat tersimpan di luar konteks layanan yang dipilih.');
      }
      return result;
    });
  }

  async submitReport(role: AccountRole, userId: string, consultation: ApiConsultationDetail, followUp: ApiFollowUp, input: { text: string; operationKey: string }): Promise<ApiProgressReport> {
    this.requireConsultationAccess(role, userId, consultation);
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Laporan perkembangan hanya dapat dikirim Peternak.');
    this.assertFollowUp(followUp, consultation);
    const normalized = validateProgressReportInput(input);
    const pending: PendingCareCoordinationOperation = { type: 'progress_report', idempotencyKey: normalized.operationKey, followUpId: followUp.id, text: normalized.text };
    return this.withPending(userId, consultation.id, pending, async () => {
      const result = await this.care.createProgressReport(followUp.id, {
        idempotencyKey: normalized.operationKey,
        payload: { text: normalized.text },
      });
      if (result.followUpId !== followUp.id || result.consultationId !== consultation.id
        || result.farmerId !== userId || result.vetId !== consultation.vetId || result.animalId !== consultation.animalId) {
        throw new DomainError('API_RESPONSE_INVALID', 'Laporan tersimpan di luar tindak lanjut yang dipilih.');
      }
      return result;
    });
  }

  async completeCare(role: AccountRole, userId: string, consultation: ApiConsultationDetail, reminder: ApiReminder, operationKey: string): Promise<ApiCareCompletion> {
    this.requireConsultationAccess(role, userId, consultation);
    if (role !== 'farmer' || reminder.ownerId !== userId || reminder.consultationId !== consultation.id || reminder.animalId !== consultation.animalId || reminder.kind !== 'care') {
      throw new DomainError('FORBIDDEN', 'Hanya Peternak pemilik dapat mengonfirmasi perawatan pada layanan ini.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(operationKey)) throw new DomainError('VALIDATION_FAILED', 'Identitas tindakan tidak valid.');
    const pending: PendingCareCoordinationOperation = { type: 'care_completion', idempotencyKey: operationKey, reminderId: reminder.id };
    return this.withPending(userId, consultation.id, pending, async () => {
      const result = await this.care.completeCare(reminder.id, { idempotencyKey: operationKey, payload: { confirmation: true } });
      if (result.reminder.id !== reminder.id || result.reminder.careStatus !== 'done' || !result.healthEventId) {
        throw new DomainError('API_RESPONSE_INVALID', 'Server belum mengonfirmasi perawatan dan catatan kesehatannya.');
      }
      return result;
    });
  }

  async retryPending(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<void> {
    this.requireConsultationAccess(role, userId, consultation);
    if (!this.pending) throw new DomainError('SESSION_STORAGE_FAILED', 'Penyimpanan retry tindak lanjut belum tersedia.');
    const operation = await this.pending.read(userId, consultation.id);
    if (!operation) throw new DomainError('NOT_FOUND', 'Tidak ada operasi tindak lanjut tertunda.');
    if (operation.type === 'follow_up') {
      if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter yang dapat mengirim tindak lanjut.');
      await this.withPending(userId, consultation.id, operation, async () => {
        const result = await this.care.createFollowUp(consultation.id, {
          idempotencyKey: operation.idempotencyKey,
          payload: { startsAt: operation.startsAt, endsAt: operation.endsAt, reason: operation.reason },
        });
        this.assertFollowUp(result, consultation);
      });
      return;
    }
    if (operation.type === 'reminder') {
      if (operation.followUpId) this.assertFollowUp(await this.care.getFollowUp(operation.followUpId), consultation);
      await this.withPending(userId, consultation.id, operation, async () => {
        const result = await this.care.createReminder({
          idempotencyKey: operation.idempotencyKey,
          payload: { animalId: consultation.animalId, consultationId: consultation.id, ...(operation.followUpId ? { followUpId: operation.followUpId } : {}), kind: operation.kind, dueAt: operation.dueAt, instructions: operation.instructions },
        });
        if (result.consultationId !== consultation.id || result.animalId !== consultation.animalId || result.ownerId !== consultation.farmerId) {
          throw new DomainError('API_RESPONSE_INVALID', 'Pengingat tersimpan di luar konteks layanan yang dipilih.');
        }
      });
      return;
    }
    if (operation.type === 'progress_report') {
      if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak yang dapat mengirim laporan perkembangan.');
      this.assertFollowUp(await this.care.getFollowUp(operation.followUpId), consultation);
      await this.withPending(userId, consultation.id, operation, async () => {
        const result = await this.care.createProgressReport(operation.followUpId, {
          idempotencyKey: operation.idempotencyKey, payload: { text: operation.text },
        });
        if (result.followUpId !== operation.followUpId || result.consultationId !== consultation.id
          || result.farmerId !== userId || result.vetId !== consultation.vetId || result.animalId !== consultation.animalId) {
          throw new DomainError('API_RESPONSE_INVALID', 'Laporan tersimpan di luar tindak lanjut yang dipilih.');
        }
      });
      return;
    }
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak yang dapat mengonfirmasi perawatan.');
    const reminder = await this.care.getReminder(operation.reminderId);
    if (reminder.ownerId !== userId || reminder.consultationId !== consultation.id || reminder.animalId !== consultation.animalId || reminder.kind !== 'care') {
      throw new DomainError('FORBIDDEN', 'Pengingat perawatan tertunda tidak terkait dengan akun ini.');
    }
    await this.withPending(userId, consultation.id, operation, async () => {
      const result = await this.care.completeCare(operation.reminderId, { idempotencyKey: operation.idempotencyKey, payload: { confirmation: true } });
      if (result.reminder.id !== operation.reminderId || result.reminder.careStatus !== 'done' || !result.healthEventId) {
        throw new DomainError('API_RESPONSE_INVALID', 'Server belum mengonfirmasi perawatan dan catatan kesehatannya.');
      }
    });
  }

  private requireConsultationAccess(role: AccountRole, userId: string, consultation: ApiConsultationDetail): void {
    if ((role === 'farmer' && consultation.farmerId !== userId) || (role === 'vet' && consultation.vetId !== userId)) {
      throw new DomainError('FORBIDDEN', 'Akun ini tidak terhubung dengan layanan yang dipilih.');
    }
  }

  private assertFollowUp(followUp: ApiFollowUp, consultation: ApiConsultationDetail): void {
    if (followUp.consultationId !== consultation.id || followUp.animalId !== consultation.animalId
      || followUp.farmerId !== consultation.farmerId || followUp.vetId !== consultation.vetId) {
      throw new DomainError('FORBIDDEN', 'Tindak lanjut tidak terkait dengan layanan yang dipilih.');
    }
  }

  private async withPending<T>(userId: string, consultationId: string, operation: PendingCareCoordinationOperation, action: () => Promise<T>): Promise<T> {
    if (!this.pending) throw new DomainError('SESSION_STORAGE_FAILED', 'Penyimpanan retry tindak lanjut belum tersedia.');
    await this.pending.write(userId, consultationId, operation);
    let result: T;
    try {
      result = await action();
    } catch (cause) {
      if (cause instanceof DomainError && !['SERVICE_UNAVAILABLE', 'API_RESPONSE_INVALID', 'IDEMPOTENCY_CONFLICT'].includes(cause.code)) {
        await this.pending.clear(userId, consultationId);
      }
      throw cause;
    }
    await this.pending.clear(userId, consultationId);
    return result;
  }
}
