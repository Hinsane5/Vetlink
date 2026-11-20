import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import { validateFollowUpInput, validateProgressReportInput, validateReminderInput } from '../domain/careCoordination';
import type { ApiCareCompletion, ApiCareCoordinationRepository, ApiFollowUp, ApiProgressReport, ApiReminder } from './ports/ApiCareCoordinationRepository';
import type { ApiConsultationDetail } from './ports/ApiConsultationRepository';
import type { ServerVetScheduleService } from './ServerVetScheduleService';
import type { ApiMediaFile, ApiMediaRepository } from './ports/ApiMediaRepository';
import type { ServerChatMediaStore } from './ports/ServerChatMediaStore';
import type { SelectedAsset } from '../domain/profiles';
import type { ApiMessageAttachment } from './ports/ApiChatRepository';

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
  | { type: 'progress_report'; idempotencyKey: string; followUpId: string; text: string; attachments?: PendingCareReportAttachment[] }
  | { type: 'care_completion'; idempotencyKey: string; reminderId: string };

export interface PendingCareReportAttachment { file: ApiMediaFile; idempotencyKey: string; }

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
    private readonly media?: ApiMediaRepository,
    private readonly mediaStore?: ServerChatMediaStore,
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

  async submitReport(role: AccountRole, userId: string, consultation: ApiConsultationDetail, followUp: ApiFollowUp, input: { text: string; operationKey: string; attachments?: SelectedAsset[] }): Promise<ApiProgressReport> {
    this.requireConsultationAccess(role, userId, consultation);
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Laporan perkembangan hanya dapat dikirim Peternak.');
    this.assertFollowUp(followUp, consultation);
    const normalized = validateProgressReportInput(input);
    const attachments = await this.stageReportAttachments(userId, input.attachments ?? [], normalized.operationKey);
    const pending: PendingCareCoordinationOperation = {
      type: 'progress_report', idempotencyKey: normalized.operationKey, followUpId: followUp.id,
      text: normalized.text, ...(attachments.length ? { attachments } : {}),
    };
    try {
      const result = await this.withPending(userId, consultation.id, pending, async () => this.createReport(consultation, pending));
      await this.removeStagedReportFiles(attachments);
      return result;
    } catch (cause) {
      if (!isUncertain(cause)) {
        await this.removeStagedReportFiles(attachments);
      } else {
        try {
          const stored = await this.pending?.read(userId, consultation.id);
          if (!stored || stored.type !== 'progress_report' || JSON.stringify(stored) !== JSON.stringify(pending))
            await this.removeStagedReportFiles(attachments);
        } catch { /* Keep staged files when secure retry state cannot be read. */ }
      }
      throw cause;
    }
  }

  async downloadReportAttachment(role: AccountRole, userId: string, consultation: ApiConsultationDetail, report: ApiProgressReport, attachmentId: string): Promise<{ attachment: ApiMessageAttachment; localUri: string }> {
    this.requireConsultationAccess(role, userId, consultation);
    this.assertReport(report, consultation);
    if (!report.attachmentIds.includes(attachmentId)) throw new DomainError('FORBIDDEN', 'Lampiran tidak termasuk dalam laporan ini.');
    if (!this.media || !this.mediaStore) throw new DomainError('INVALID_STATE', 'Pembuka lampiran belum tersedia pada sesi ini.');
    const downloaded = await this.media.download(attachmentId);
    if (downloaded.attachment.uploadStatus !== 'committed') throw new DomainError('API_RESPONSE_INVALID', 'Lampiran laporan belum dikomit.');
    const attachment: ApiMessageAttachment = {
      id: downloaded.attachment.id, kind: downloaded.attachment.kind, mimeType: downloaded.attachment.mimeType,
      filename: downloaded.attachment.filename, byteSize: downloaded.attachment.byteSize, url: downloaded.attachment.url,
    };
    const localUri = await this.mediaStore.storeDownloadedFile(userId, attachment, downloaded.bytes);
    return { attachment, localUri };
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
      try {
        await this.withPending(userId, consultation.id, operation, async () => this.createReport(consultation, operation));
        await this.removeStagedReportFiles(operation.attachments ?? []);
      } catch (cause) {
        if (!isUncertain(cause)) await this.removeStagedReportFiles(operation.attachments ?? []);
        throw cause;
      }
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

  private assertReport(report: ApiProgressReport, consultation: ApiConsultationDetail): void {
    if (report.consultationId !== consultation.id || report.animalId !== consultation.animalId
      || report.farmerId !== consultation.farmerId || report.vetId !== consultation.vetId) {
      throw new DomainError('FORBIDDEN', 'Laporan tidak terkait dengan layanan yang dipilih.');
    }
  }

  private async createReport(consultation: ApiConsultationDetail, operation: Extract<PendingCareCoordinationOperation, { type: 'progress_report' }>): Promise<ApiProgressReport> {
    const attachmentIds = await this.uploadReportAttachments(consultation.id, operation.attachments ?? []);
    const result = await this.care.createProgressReport(operation.followUpId, {
      idempotencyKey: operation.idempotencyKey,
      payload: { text: operation.text, ...(attachmentIds.length ? { attachmentIds } : {}) },
    });
    this.assertReport(result, consultation);
    if (result.followUpId !== operation.followUpId || result.text !== operation.text
      || result.attachmentIds.length !== attachmentIds.length
      || result.attachmentIds.some((id, index) => id !== attachmentIds[index])) {
      throw new DomainError('API_RESPONSE_INVALID', 'Hasil laporan atau lampiran tidak cocok dengan permintaan tersimpan.');
    }
    return result;
  }

  private async stageReportAttachments(userId: string, selected: SelectedAsset[], operationKey: string): Promise<PendingCareReportAttachment[]> {
    if (!Array.isArray(selected) || selected.length > 5) throw new DomainError('VALIDATION_FAILED', 'Pilih maksimal lima lampiran laporan.');
    if (!selected.length) return [];
    if (!this.media || !this.mediaStore) throw new DomainError('INVALID_STATE', 'Unggah lampiran laporan belum tersedia pada sesi ini.');
    const staged: PendingCareReportAttachment[] = [];
    try {
      for (const asset of selected) {
        if (asset.kind === 'document' || !/^(file|content):\/\//.test(asset.uri)
          || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(asset.mimeType.toLowerCase())) {
          throw new DomainError('VALIDATION_FAILED', 'Laporan menerima foto atau video yang didukung.');
        }
        const file = await this.mediaStore.copyToPrivateStorage(userId, asset);
        const idempotencyKey = this.newOperationKey();
        if (idempotencyKey === operationKey || staged.some((item) => item.idempotencyKey === idempotencyKey)) {
          throw new DomainError('VALIDATION_FAILED', 'Kunci unggah lampiran harus unik.');
        }
        staged.push({ file, idempotencyKey });
      }
      return staged;
    } catch (cause) {
      await this.removeStagedReportFiles(staged);
      throw cause;
    }
  }

  private async uploadReportAttachments(consultationId: string, attachments: PendingCareReportAttachment[]): Promise<string[]> {
    if (!attachments.length) return [];
    if (!this.media) throw new DomainError('INVALID_STATE', 'Repository media laporan belum tersedia.');
    const ids: string[] = [];
    for (const item of attachments) {
      const metadata = await this.media.upload(consultationId, item.file, item.idempotencyKey);
      if (metadata.filename !== item.file.filename || metadata.mimeType !== item.file.mimeType || metadata.byteSize !== item.file.byteSize) {
        throw new DomainError('API_RESPONSE_INVALID', 'Metadata lampiran laporan tidak cocok dengan file yang dipilih.');
      }
      const committed = metadata.uploadStatus === 'committed' ? metadata : await this.media.commit(metadata.id);
      if (committed.id !== metadata.id || committed.uploadStatus !== 'committed'
        || committed.filename !== item.file.filename || committed.mimeType !== item.file.mimeType || committed.byteSize !== item.file.byteSize) {
        throw new DomainError('API_RESPONSE_INVALID', 'Lampiran laporan belum tersimpan sebagai file privat yang dikomit.');
      }
      ids.push(committed.id);
    }
    return ids;
  }

  private async removeStagedReportFiles(attachments: PendingCareReportAttachment[]): Promise<void> {
    if (!this.mediaStore) return;
    await Promise.all(attachments.map(({ file }) => this.mediaStore!.removePrivateFile(file.uri).catch(() => undefined)));
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

function isUncertain(cause: unknown): boolean {
  return cause instanceof DomainError && ['SERVICE_UNAVAILABLE', 'API_RESPONSE_INVALID', 'IDEMPOTENCY_CONFLICT', 'SESSION_STORAGE_FAILED'].includes(cause.code);
}
