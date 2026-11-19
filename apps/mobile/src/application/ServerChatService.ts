import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationDetail } from './ports/ApiConsultationRepository';
import type { ApiChatMessage, ApiChatMessagePage, ApiChatRepository } from './ports/ApiChatRepository';

export interface PendingServerChatMessage { clientMessageId: string; text: string; }

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
  constructor(
    private readonly chat: ApiChatRepository,
    private readonly state: ServerChatStateStore,
    private readonly createId: () => string,
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
    this.requireAccess(role, userId, consultation);
    const normalized = text.trim();
    if (!normalized || normalized.length > 4000) throw new DomainError('VALIDATION_FAILED', 'Pesan wajib diisi dan maksimal 4.000 karakter.');
    let pending = await this.state.readPending(userId, consultation.id);
    if (pending) {
      if (pending.text !== normalized) throw new DomainError('INVALID_STATE', 'Pulihkan pesan tertunda yang sama sebelum menulis pesan baru.');
      const page = await this.chat.list(consultation.id, { limit: 50 });
      this.validatePage(page, consultation);
      const existing = page.items.find((message) => message.clientMessageId === pending?.clientMessageId);
      if (existing) {
        this.validatePendingResult(existing, pending, userId);
        await this.state.clearPending(userId, consultation.id);
        await this.state.clearDraft(userId, consultation.id);
        return existing;
      }
    } else {
      const clientMessageId = this.createId();
      if (!isUuid(clientMessageId)) throw new DomainError('SESSION_STORAGE_FAILED', 'ID pesan baru tidak valid.');
      pending = { clientMessageId, text: normalized };
      await this.state.writePending(userId, consultation.id, pending);
      await this.state.clearDraft(userId, consultation.id);
    }
    const message = await this.chat.send(consultation.id, { clientMessageId: pending.clientMessageId, text: pending.text });
    this.validatePendingResult(message, pending, userId);
    await this.state.clearPending(userId, consultation.id);
    return message;
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
    if (message.senderId !== userId || message.clientMessageId !== pending.clientMessageId || message.text !== pending.text
      || message.attachments.length !== 0)
      throw new DomainError('API_RESPONSE_INVALID', 'Respons pesan tidak cocok dengan operasi tersimpan.');
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
