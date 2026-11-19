import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationDetail } from './ports/ApiConsultationRepository';
import type { ApiChatMessage, ApiChatMessagePage, ApiChatRepository, ApiMessageAttachment } from './ports/ApiChatRepository';
import type { ApiMediaAttachment, ApiMediaFile, ApiMediaRepository } from './ports/ApiMediaRepository';
import type { SelectedAsset } from '../domain/profiles';
import type { ServerChatMediaStore } from './ports/ServerChatMediaStore';

export interface PendingServerChatAttachment {
  file: ApiMediaFile;
  idempotencyKey: string;
  attachmentId?: string;
  committed?: boolean;
}

export interface PendingServerChatMessage {
  clientMessageId: string;
  text: string;
  /** Optional to read pending text messages saved by earlier app versions. */
  attachments?: PendingServerChatAttachment[];
}

export interface ServerChatStateStore {
  readPending(userId: string, consultationId: string): Promise<PendingServerChatMessage | null>;
  writePending(userId: string, consultationId: string, value: PendingServerChatMessage): Promise<void>;
  clearPending(userId: string, consultationId: string): Promise<void>;
  readDraft(userId: string, consultationId: string): Promise<string | null>;
  writeDraft(userId: string, consultationId: string, value: string): Promise<void>;
  clearDraft(userId: string, consultationId: string): Promise<void>;
}

/** Server chat is limited to the assigned, paid, active chat consultation. */
export class ServerChatService {
  private readonly sendLocks = new Set<string>();

  constructor(
    private readonly chat: ApiChatRepository,
    private readonly state: ServerChatStateStore,
    private readonly createId: () => string,
    private readonly media?: ApiMediaRepository,
    private readonly mediaStore?: ServerChatMediaStore,
  ) {}

  async list(role: AccountRole, userId: string, consultation: ApiConsultationDetail, cursor?: string): Promise<ApiChatMessagePage> {
    this.requireAccess(role, userId, consultation);
    const page = await this.chat.list(consultation.id, { limit: 50, ...(cursor ? { cursor } : {}) });
    this.validatePage(page, consultation);
    if (!cursor) await this.reconcilePending(userId, consultation, page.items);
    return page;
  }

  async getPending(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<PendingServerChatMessage | null> {
    this.requireAccess(role, userId, consultation);
    return this.state.readPending(userId, consultation.id);
  }

  async readDraft(role: AccountRole, userId: string, consultation: ApiConsultationDetail): Promise<string | null> {
    this.requireAccess(role, userId, consultation);
    return this.state.readDraft(userId, consultation.id);
  }

  async saveDraft(role: AccountRole, userId: string, consultation: ApiConsultationDetail, text: string): Promise<void> {
    this.requireAccess(role, userId, consultation);
    if (text.length > 4000) throw new DomainError('VALIDATION_FAILED', 'Draft pesan maksimal 4.000 karakter.');
    if (await this.state.readPending(userId, consultation.id))
      throw new DomainError('INVALID_STATE', 'Pulihkan pengiriman tertunda sebelum menyimpan draft lain.');
    if (text.trim()) await this.state.writeDraft(userId, consultation.id, text);
    else await this.state.clearDraft(userId, consultation.id);
  }

  async send(role: AccountRole, userId: string, consultation: ApiConsultationDetail, text: string): Promise<ApiChatMessage> {
    return this.sendWithMedia(role, userId, consultation, text, []);
  }

  async sendWithMedia(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    text: string,
    selectedFiles: SelectedAsset[],
  ): Promise<ApiChatMessage> {
    const lockKey = `${userId}:${consultation.id}`;
    if (this.sendLocks.has(lockKey)) throw new DomainError('INVALID_STATE', 'Pengiriman pesan ini sedang berlangsung.');
    this.sendLocks.add(lockKey);
    try { return await this.sendWithMediaOnce(role, userId, consultation, text, selectedFiles); }
    finally { this.sendLocks.delete(lockKey); }
  }

  private async sendWithMediaOnce(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    text: string,
    selectedFiles: SelectedAsset[],
  ): Promise<ApiChatMessage> {
    this.requireAccess(role, userId, consultation);
    const normalized = text.trim();
    if (normalized.length > 4000) throw new DomainError('VALIDATION_FAILED', 'Pesan maksimal 4.000 karakter.');
    if (!Array.isArray(selectedFiles) || selectedFiles.length > 5 || (!normalized && selectedFiles.length === 0))
      throw new DomainError('VALIDATION_FAILED', 'Tulis pesan atau pilih maksimal lima foto/video.');
    let pending = await this.state.readPending(userId, consultation.id);
    if (pending) {
      if (pending.text !== normalized || selectedFiles.length > 0)
        throw new DomainError('INVALID_STATE', 'Pulihkan pesan dan lampiran tertunda yang sama sebelum mengirim pesan baru.');
      const page = await this.chat.list(consultation.id, { limit: 50 });
      this.validatePage(page, consultation);
      const existing = page.items.find((message) => message.clientMessageId === pending?.clientMessageId);
      if (existing) {
        this.validatePendingResult(existing, pending, userId);
        await this.state.clearPending(userId, consultation.id);
        await this.state.clearDraft(userId, consultation.id);
        await this.removeStagedFiles((pending.attachments ?? []).map(({ file }) => file.uri));
        return existing;
      }
    } else {
      const clientMessageId = this.createStableId('ID pesan baru tidak valid.');
      const stagedUris: string[] = [];
      const attachments: PendingServerChatAttachment[] = [];
      try {
        for (const selected of selectedFiles) {
          validateSelectedFile(selected);
          if (!this.mediaStore || !this.media) throw new DomainError('INVALID_STATE', 'Lampiran belum tersedia pada sesi ini.');
          const file = await this.mediaStore.copyToPrivateStorage(userId, selected);
          stagedUris.push(file.uri);
          validateApiMediaFile(file);
          const idempotencyKey = this.createStableId('Kunci upload media tidak valid.');
          if (idempotencyKey === clientMessageId || attachments.some((item) => item.idempotencyKey === idempotencyKey))
            throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci operasi media harus unik.');
          attachments.push({ file, idempotencyKey });
        }
        pending = { clientMessageId, text: normalized, ...(attachments.length ? { attachments } : {}) };
        await this.state.writePending(userId, consultation.id, pending);
        await this.state.clearDraft(userId, consultation.id);
      } catch (cause) {
        // A SecureStore write can fail after persisting. Preserve bytes if the
        // stored operation cannot be read back with certainty.
        let definitelyNotPending = false;
        try { definitelyNotPending = (await this.state.readPending(userId, consultation.id))?.clientMessageId !== clientMessageId; }
        catch { /* Preserve staged files while SecureStore state is uncertain. */ }
        if (definitelyNotPending) await this.removeStagedFiles(stagedUris);
        throw cause;
      }
    }
    return this.resumePending(userId, consultation, pending);
  }

  async downloadAttachment(
    role: AccountRole,
    userId: string,
    consultation: ApiConsultationDetail,
    message: ApiChatMessage,
    attachment: ApiMessageAttachment,
  ): Promise<{ attachment: ApiMessageAttachment; localUri: string }> {
    this.requireAccess(role, userId, consultation);
    if (!this.media || !this.mediaStore) throw new DomainError('INVALID_STATE', 'Lampiran belum tersedia pada sesi ini.');
    if (!message || !isUuid(message.id) || !Array.isArray(message.attachments)
      || !attachment || !isUuid(attachment.id) || ![consultation.farmerId, consultation.vetId].includes(message.senderId)
      || !message.attachments.some((item) => sameAttachment(item, attachment))) {
      throw new DomainError('FORBIDDEN', 'Lampiran tidak termasuk dalam pesan konsultasi ini.');
    }
    const downloaded = await this.media.download(attachment.id);
    if (downloaded.attachment.uploadStatus !== 'committed' || !sameMediaAttachment(downloaded.attachment, attachment))
      throw new DomainError('API_RESPONSE_INVALID', 'Metadata lampiran unduhan tidak cocok dengan pesan server.');
    const localUri = await this.mediaStore.storeDownloadedFile(userId, attachment, downloaded.bytes);
    return { attachment, localUri };
  }

  async retryFailed(role: AccountRole, userId: string, consultation: ApiConsultationDetail, message: ApiChatMessage): Promise<ApiChatMessage> {
    this.requireAccess(role, userId, consultation);
    if (message.senderId !== userId || message.deliveryStatus !== 'failed')
      throw new DomainError('FORBIDDEN', 'Hanya pesan gagal milik akun ini yang dapat dicoba lagi.');
    const result = await this.chat.retry(consultation.id, message.id);
    if (result.id !== message.id || result.clientMessageId !== message.clientMessageId || result.senderId !== userId)
      throw new DomainError('API_RESPONSE_INVALID', 'Hasil retry tidak sesuai dengan pesan server.');
    return result;
  }

  private async reconcilePending(userId: string, consultation: ApiConsultationDetail, messages: ApiChatMessage[]): Promise<void> {
    const pending = await this.state.readPending(userId, consultation.id);
    if (!pending) return;
    const existing = messages.find((message) => message.clientMessageId === pending.clientMessageId);
    if (!existing) return;
    this.validatePendingResult(existing, pending, userId);
    await this.state.clearPending(userId, consultation.id);
    await this.state.clearDraft(userId, consultation.id);
    await this.removeStagedFiles((pending.attachments ?? []).map(({ file }) => file.uri));
  }

  private validatePage(page: ApiChatMessagePage, consultation: ApiConsultationDetail): void {
    if (!Array.isArray(page.items) || !Number.isSafeInteger(page.items.length) || page.items.length > 50
      || (page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor))
      || (!page.hasMore && page.nextCursor !== null)) {
      throw new DomainError('API_RESPONSE_INVALID', 'Halaman chat server tidak valid.');
    }
    const ids = new Set<string>();
    const clientIds = new Set<string>();
    for (const message of page.items) {
      if (ids.has(message.id) || clientIds.has(message.clientMessageId))
        throw new DomainError('API_RESPONSE_INVALID', 'Halaman chat server memuat pesan ganda.');
      if (message.senderId !== consultation.farmerId && message.senderId !== consultation.vetId)
        throw new DomainError('API_RESPONSE_INVALID', 'Pesan chat berasal dari akun di luar konsultasi.');
      ids.add(message.id); clientIds.add(message.clientMessageId);
    }
  }

  private validatePendingResult(message: ApiChatMessage, pending: PendingServerChatMessage, userId: string): void {
    if (message.senderId !== userId || message.clientMessageId !== pending.clientMessageId || message.text !== (pending.text || null)
      || !sameAttachmentIds(message.attachments, pending.attachments ?? []))
      throw new DomainError('API_RESPONSE_INVALID', 'Respons pesan tidak cocok dengan operasi tersimpan.');
  }

  private async resumePending(
    userId: string,
    consultation: ApiConsultationDetail,
    initial: PendingServerChatMessage,
  ): Promise<ApiChatMessage> {
    let pending = initial;
    const attachments = pending.attachments ?? [];
    if (attachments.length > 0 && (!this.media || !this.mediaStore))
      throw new DomainError('INVALID_STATE', 'Upload lampiran tidak tersedia pada sesi ini.');
    for (let index = 0; index < attachments.length; index += 1) {
      const current = pending.attachments![index];
      let metadata = current.attachmentId
        ? await this.media!.get(current.attachmentId)
        : await this.media!.upload(consultation.id, current.file, current.idempotencyKey);
      validateUploadedAttachment(metadata, current.file, current.attachmentId);
      if (pending.attachments!.some((item, otherIndex) => otherIndex !== index && item.attachmentId === metadata.id))
        throw new DomainError('API_RESPONSE_INVALID', 'Server mengembalikan ID media yang sama untuk file berbeda.');
      if (current.committed && metadata.uploadStatus !== 'committed')
        throw new DomainError('API_RESPONSE_INVALID', 'Status commit media berubah setelah tersimpan.');
      if (!current.attachmentId) {
        pending = replacePendingAttachment(pending, index, { ...current, attachmentId: metadata.id, committed: false });
        await this.state.writePending(userId, consultation.id, pending);
      }
      if (!current.committed) {
        metadata = metadata.uploadStatus === 'committed' ? metadata : await this.media!.commit(metadata.id);
        validateUploadedAttachment(metadata, current.file, current.attachmentId ?? metadata.id);
        if (metadata.uploadStatus !== 'committed') throw new DomainError('API_RESPONSE_INVALID', 'Media belum berstatus committed.');
        pending = replacePendingAttachment(pending, index, { ...pending.attachments![index], attachmentId: metadata.id, committed: true });
        await this.state.writePending(userId, consultation.id, pending);
      }
    }
    const attachmentIds = (pending.attachments ?? []).map((item) => item.attachmentId);
    if (attachmentIds.some((id) => !id)) throw new DomainError('API_RESPONSE_INVALID', 'ID lampiran committed belum tersedia.');
    const message = await this.chat.send(consultation.id, {
      clientMessageId: pending.clientMessageId,
      ...(pending.text ? { text: pending.text } : {}),
      ...(attachmentIds.length ? { attachmentIds: attachmentIds as string[] } : {}),
    });
    this.validatePendingResult(message, pending, userId);
    await this.state.clearPending(userId, consultation.id);
    await this.removeStagedFiles((pending.attachments ?? []).map(({ file }) => file.uri));
    return message;
  }

  private createStableId(message: string): string {
    const value = this.createId();
    if (!isUuid(value)) throw new DomainError('SESSION_STORAGE_FAILED', message);
    return value;
  }

  private async removeStagedFiles(uris: string[]): Promise<void> {
    if (!this.mediaStore) return;
    await Promise.all(uris.map((uri) => this.mediaStore!.removePrivateFile(uri).catch(() => {})));
  }

  private requireAccess(role: AccountRole, userId: string, consultation: ApiConsultationDetail): void {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membuka chat.');
    const expectedUser = role === 'farmer' ? consultation.farmerId : consultation.vetId;
    if (userId !== expectedUser) throw new DomainError('FORBIDDEN', 'Konsultasi ini bukan milik atau penugasan akun aktif.');
    if (consultation.serviceType !== 'chat' || consultation.status !== 'in_progress' || consultation.paymentStatus !== 'succeeded')
      throw new DomainError('INVALID_STATE', 'Chat hanya tersedia untuk konsultasi chat yang sudah dibayar dan sedang berlangsung.');
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateSelectedFile(file: SelectedAsset): void {
  const mimeType = typeof file?.mimeType === 'string' ? file.mimeType.toLowerCase() : '';
  const imageMimes = ['image/jpeg', 'image/png', 'image/webp'];
  const validMime = file?.kind === 'image' ? imageMimes.includes(mimeType) : file?.kind === 'video' && mimeType === 'video/mp4';
  const maximumBytes = file?.kind === 'video' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (!file || !['image', 'video'].includes(file.kind) || !validMime
    || typeof file.uri !== 'string' || !/^(file|content):\/\//.test(file.uri)
    || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 255
    || (file.byteSize !== null && (!Number.isSafeInteger(file.byteSize) || file.byteSize < 1 || file.byteSize > maximumBytes))) {
    throw new DomainError('VALIDATION_FAILED', 'Pilih JPG, PNG, WebP hingga 10 MiB atau MP4 hingga 50 MiB.');
  }
}

function validateApiMediaFile(file: ApiMediaFile): void {
  const maximumBytes = file?.mimeType === 'video/mp4' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (!file || typeof file.uri !== 'string' || !file.uri.startsWith('file://')
    || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 255
    || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.mimeType)
    || !Number.isSafeInteger(file.byteSize) || file.byteSize < 1 || file.byteSize > maximumBytes) {
    throw new DomainError('VALIDATION_FAILED', 'Berkas privat tidak sesuai jenis atau batas ukuran media.');
  }
}

function validateUploadedAttachment(metadata: ApiMediaAttachment, file: ApiMediaFile, expectedId?: string): void {
  const kind = file.mimeType === 'video/mp4' ? 'video' : 'image';
  if (!metadata || (expectedId && metadata.id !== expectedId) || metadata.kind !== kind
    || metadata.mimeType !== file.mimeType || metadata.filename !== file.filename
    || metadata.byteSize !== file.byteSize || !['uploaded', 'committed'].includes(metadata.uploadStatus)) {
    throw new DomainError('API_RESPONSE_INVALID', 'Media server tidak cocok dengan file lokal yang disimpan.');
  }
}

function replacePendingAttachment(
  pending: PendingServerChatMessage,
  index: number,
  attachment: PendingServerChatAttachment,
): PendingServerChatMessage {
  const attachments = [...(pending.attachments ?? [])];
  attachments[index] = attachment;
  return { ...pending, attachments };
}

function sameAttachmentIds(messageAttachments: ApiMessageAttachment[], pendingAttachments: PendingServerChatAttachment[]): boolean {
  return messageAttachments.length === pendingAttachments.length
    && messageAttachments.every((item, index) => item.id === pendingAttachments[index].attachmentId);
}

function sameAttachment(left: ApiMessageAttachment, right: ApiMessageAttachment): boolean {
  return left.id === right.id && left.kind === right.kind && left.mimeType === right.mimeType
    && left.filename === right.filename && left.byteSize === right.byteSize && left.url === right.url;
}

function sameMediaAttachment(left: ApiMediaAttachment, right: ApiMessageAttachment): boolean {
  return left.id === right.id && left.kind === right.kind && left.mimeType === right.mimeType
    && left.filename === right.filename && left.byteSize === right.byteSize && left.url === right.url;
}
