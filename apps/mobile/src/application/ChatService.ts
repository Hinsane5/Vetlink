import type { AccountRole } from '../domain/auth';
import type { ChatAttachment, ChatConversation, ChatMessage, ChatSendInput, MessageDeliveryStatus, NormalizedChatInput } from '../domain/chat';
import { validateChatInput } from '../domain/chat';
import type { DomainEntity, EntityKind } from '../domain/entities';
import { DomainError } from '../domain/errors';
import type { SelectedAsset } from '../domain/profiles';
import type { BookingMedia, BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { IdFactory } from './ports/AuthRepository';
import { ProfileService } from './ProfileService';

export type MessageDeliveryRequest = {
  consultationId: string;
  messageId: string;
  clientMessageId: string;
  senderId: string;
};

/** The local adapter records delivery in this installation; it never contacts a service. */
export interface MessageDeliveryAdapter {
  deliver(request: MessageDeliveryRequest): Promise<MessageDeliveryStatus>;
}

const localDelivery: MessageDeliveryAdapter = { async deliver() { return 'sent'; } };
const stalePendingMilliseconds = 30_000;

export class ChatService {
  constructor(
    private readonly storage: BookingRepository,
    private readonly media: BookingMedia,
    private readonly ids: IdFactory,
    private readonly delivery: MessageDeliveryAdapter = localDelivery,
    private readonly now: () => Date = () => new Date(),
  ) {}

  newClientMessageId(): string { return this.ids.create(); }

  async conversation(userId: string, role: AccountRole, consultationId: string): Promise<ChatConversation> {
    return this.readConversation(this.storage.read, userId, role, consultationId);
  }

  async pickMedia(userId: string, role: AccountRole, consultationId: string): Promise<SelectedAsset[]> {
    const context = await this.authorize(this.storage.read, userId, role, consultationId);
    this.assertCanWrite(context.record, context.paid, role, context.vetProfile.verificationStatus);
    return this.media.pickBookingMedia();
  }

  async send(userId: string, role: AccountRole, consultationId: string, input: ChatSendInput): Promise<ChatConversation> {
    const normalized = validateChatInput(input);
    const copiedFiles: string[] = [];
    let persisted = false;
    try {
      const claim = await this.storage.transaction(async (unit) => {
        const context = await this.authorize(unit, userId, role, consultationId);
        this.assertCanWrite(context.record, context.paid, role, context.vetProfile.verificationStatus);
        const existing = (await unit.repository.listByOwner('message', userId)).find((message) => message.payload.clientMessageId === normalized.clientMessageId);
        if (existing) {
          this.assertSameMessage(existing, userId, consultationId, normalized);
          return { messageId: existing.id, attempt: null as number | null, created: false };
        }

        const messageId = this.ids.create();
        const storedAssets: { id: string; asset: SelectedAsset; stored: Awaited<ReturnType<BookingMedia['store']>> }[] = [];
        for (const asset of normalized.assets) {
          const attachmentId = this.ids.create();
          const stored = await this.media.store(asset, attachmentId);
          copiedFiles.push(stored.localUri);
          if (!stored.localUri.startsWith('file://') || !stored.mimeType.toLowerCase().startsWith(`${asset.kind}/`) || !Number.isSafeInteger(stored.byteSize) || stored.byteSize < 0) throw new DomainError('VALIDATION_FAILED', 'Lampiran yang disimpan tidak valid.');
          storedAssets.push({ id: attachmentId, asset, stored });
        }

        const timestamp = this.now().toISOString();
        const message = this.entity('message', userId, consultationId, {
          consultationId, senderId: userId, clientMessageId: normalized.clientMessageId,
          text: normalized.text, attachmentIds: storedAssets.map((item) => item.id),
          deliveryStatus: 'pending', sentAt: timestamp, fingerprint: normalized.fingerprint,
          deliveryAttempt: 1, deliveryAttemptAt: timestamp,
        }, messageId);
        await unit.repository.create(message, [{ sourceId: message.id, targetId: consultationId, relationship: 'consultation' }]);
        for (const item of storedAssets) {
          const attachment = this.entity('attachment', userId, messageId, {
            accessContext: 'consultation', uploadStatus: 'local', kind: item.asset.kind,
            filename: item.stored.filename, mimeType: item.stored.mimeType, byteSize: item.stored.byteSize,
            localUri: item.stored.localUri,
          }, item.id);
          await unit.repository.create(attachment, [{ sourceId: message.id, targetId: attachment.id, relationship: 'attachment' }]);
        }
        return { messageId: message.id, attempt: 1, created: true };
      });

      persisted = claim.created;
      if (claim.attempt !== null) await this.deliverAndRecord(userId, role, consultationId, claim.messageId, claim.attempt);
      return this.conversation(userId, role, consultationId);
    } catch (error) {
      if (!persisted) await Promise.all(copiedFiles.map((uri) => this.media.remove(uri).catch(() => {})));
      throw error;
    }
  }

  async retry(userId: string, role: AccountRole, consultationId: string, messageId: string): Promise<ChatConversation> {
    const claim = await this.storage.transaction(async (unit) => {
      const context = await this.authorize(unit, userId, role, consultationId);
      this.assertCanWrite(context.record, context.paid, role, context.vetProfile.verificationStatus);
      const message = await unit.repository.findById('message', messageId);
      if (!message || message.contextId !== consultationId || message.ownerId !== userId || message.payload.senderId !== userId || !(await unit.repository.listByRelated('message', consultationId, 'consultation')).some((item) => item.id === message.id)) {
        throw new DomainError('FORBIDDEN', 'Pesan tidak dapat dikirim ulang oleh akun ini.');
      }
      const state = String(message.payload.deliveryStatus);
      if (state === 'sent') return null;
      if (!['pending', 'failed'].includes(state)) throw new DomainError('INVALID_STATE', 'Status pengiriman pesan tidak valid.');
      const attemptAt = Date.parse(String(message.payload.deliveryAttemptAt ?? message.updatedAt));
      if (state === 'pending' && Number.isFinite(attemptAt) && this.now().getTime() - attemptAt < stalePendingMilliseconds) return null;
      const attempt = Number(message.payload.deliveryAttempt ?? 0) + 1;
      const next = this.updated(message, { deliveryStatus: 'pending', deliveryAttempt: attempt, deliveryAttemptAt: this.now().toISOString() });
      await unit.repository.update(next, message.version);
      return { messageId: message.id, attempt, created: false };
    });
    if (claim) await this.deliverAndRecord(userId, role, consultationId, claim.messageId, claim.attempt);
    return this.conversation(userId, role, consultationId);
  }

  /** Re-authorizes the consultation, message and relationship immediately before a file is opened. */
  async attachment(userId: string, role: AccountRole, consultationId: string, messageId: string, attachmentId: string): Promise<ChatAttachment> {
    const context = await this.authorize(this.storage.read, userId, role, consultationId);
    const message = (await context.unit.repository.listByRelated('message', consultationId, 'consultation')).find((item) => item.id === messageId && participantIds(context.record).includes(String(item.payload.senderId)) && item.ownerId === item.payload.senderId);
    if (!message || !Array.isArray(message.payload.attachmentIds) || !message.payload.attachmentIds.includes(attachmentId)) throw new DomainError('FORBIDDEN', 'Lampiran tidak termasuk dalam percakapan ini.');
    const attachment = (await context.unit.repository.listRelated('message', message.id, 'attachment')).find((item) => item.id === attachmentId);
    const safe = attachment && attachment.kind === 'attachment' && attachment.ownerId === message.ownerId && attachment.contextId === message.id && attachment.payload.accessContext === 'consultation' && attachment.payload.uploadStatus === 'local' && ['image', 'video'].includes(String(attachment.payload.kind)) && String(attachment.payload.mimeType).startsWith(`${String(attachment.payload.kind)}/`) && String(attachment.payload.localUri).startsWith('file://');
    if (!safe) throw new DomainError('FORBIDDEN', 'Berkas lokal tidak tersedia atau tidak aman.');
    return this.toAttachment(attachment);
  }

  private async deliverAndRecord(userId: string, role: AccountRole, consultationId: string, messageId: string, attempt: number): Promise<void> {
    const message = await this.storage.read.repository.findById('message', messageId);
    if (!message) throw new DomainError('NOT_FOUND', 'Pesan tidak ditemukan.');
    let status: MessageDeliveryStatus;
    try {
      status = await this.delivery.deliver({ consultationId, messageId, clientMessageId: String(message.payload.clientMessageId), senderId: userId });
      if (!['pending', 'sent', 'failed'].includes(status)) status = 'failed';
    } catch {
      status = 'failed';
    }
    await this.storage.transaction(async (unit) => {
      await this.authorize(unit, userId, role, consultationId);
      const current = await unit.repository.findById('message', messageId);
      if (!current || current.ownerId !== userId || current.contextId !== consultationId || current.payload.deliveryAttempt !== attempt || current.payload.deliveryStatus !== 'pending') return;
      if (status === 'pending') return;
      await unit.repository.update(this.updated(current, { deliveryStatus: status }), current.version);
    });
  }

  private async readConversation(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string): Promise<ChatConversation> {
    const context = await this.authorize(unit, userId, role, consultationId);
    const record = context.record;
    const related = await unit.repository.listByRelated('message', record.id, 'consultation');
    const visible = related.filter((item) => item.kind === 'message' && (item.contextId === record.id || item.contextId === null) && item.payload.consultationId === record.id && participantIds(record).includes(String(item.payload.senderId)) && item.ownerId === item.payload.senderId);
    visible.sort((a, b) => String(a.payload.sentAt ?? a.createdAt).localeCompare(String(b.payload.sentAt ?? b.createdAt)) || a.id.localeCompare(b.id));
    const messages: ChatMessage[] = [];
    for (const message of visible) {
      const linked = await unit.repository.listRelated('message', message.id, 'attachment');
      const allowed = linked.filter((item) => Array.isArray(message.payload.attachmentIds) && message.payload.attachmentIds.includes(item.id) && this.isSafeAttachment(item, message));
      messages.push({ record: message, attachments: allowed.map((item) => this.toAttachment(item)) });
    }
    const [other, animal, availability] = await Promise.all([
      unit.repository.findById('user', String(role === 'farmer' ? record.payload.vetId : record.payload.farmerId)),
      unit.repository.findById('livestock', String(record.payload.animalId)),
      unit.repository.listByOwner('availability', String(record.payload.vetId)),
    ]);
    availability.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version);
    return {
      consultation: record,
      otherPartyName: String(other?.payload.name ?? (role === 'farmer' ? 'Dokter' : 'Peternak')),
      animalName: String(animal?.payload.name ?? 'Ternak'),
      timezone: validTimezone(record.payload.timezone ?? availability[0]?.payload.timezone),
      readOnly: !canSendStatus(record) || (role === 'vet' && context.vetProfile.verificationStatus !== 'verified'),
      messages,
    };
  }

  private async authorize(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string) {
    const profiles = new ProfileService(unit.profiles, this.media, this.ids, this.now);
    await profiles.load(userId, role);
    const record = await unit.repository.findById('consultation', consultationId);
    if (!record) throw new DomainError('NOT_FOUND', 'Konsultasi tidak ditemukan.');
    const payload = record.payload;
    if (payload.type !== 'chat' || record.ownerId !== payload.farmerId || (role === 'farmer' ? record.ownerId !== userId : payload.vetId !== userId || ['draft', 'awaiting_payment'].includes(String(payload.status)))) throw new DomainError('FORBIDDEN', 'Konsultasi bukan milik atau penugasan akun ini.');
    const [farmers, vets, animals, animal, paid] = await Promise.all([
      unit.repository.listRelated('consultation', consultationId, 'farmer'),
      unit.repository.listRelated('consultation', consultationId, 'veterinarian'),
      unit.repository.listRelated('consultation', consultationId, 'animal'),
      unit.repository.findById('livestock', String(payload.animalId)),
      this.paid(unit, record),
    ]);
    if (!farmers.some((item) => item.id === payload.farmerId) || !vets.some((item) => item.id === payload.vetId) || !animals.some((item) => item.id === payload.animalId) || animal?.ownerId !== payload.farmerId) throw new DomainError('FORBIDDEN', 'Hubungan akun dan pasien tidak valid.');
    if (!paid) throw new DomainError('INVALID_STATE', 'Chat tersedia setelah pembayaran layanan berhasil.');
    if (!['scheduled', 'in_progress', 'reschedule_pending', 'completed', 'cancelled'].includes(String(payload.status))) throw new DomainError('INVALID_STATE', 'Chat tersedia setelah dokter menerima layanan.');
    const vetProfile = await profiles.load(String(payload.vetId), 'vet');
    return { unit, record, paid, vetProfile };
  }

  private assertCanWrite(record: DomainEntity, paid: boolean, role: AccountRole, verificationStatus: string | null): void {
    if (!paid) throw new DomainError('INVALID_STATE', 'Pembayaran layanan belum berhasil.');
    if (!canSendStatus(record)) throw new DomainError('INVALID_STATE', 'Percakapan ini hanya dapat dibaca.');
    if (role === 'vet' && verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi.');
  }

  private async paid(unit: BookingUnit, record: DomainEntity): Promise<boolean> {
    const payments = await unit.repository.listByRelated('payment', record.id, 'payable');
    return payments.some((item) => item.ownerId === record.ownerId && item.payload.payableType === 'consultation' && item.payload.payableId === record.id && item.payload.status === 'succeeded' && Number.isSafeInteger(item.payload.amount) && item.payload.amount === record.payload.feeSnapshot);
  }

  private assertSameMessage(message: DomainEntity, userId: string, consultationId: string, input: NormalizedChatInput): void {
    if (message.ownerId !== userId || message.payload.senderId !== userId || message.contextId !== consultationId || message.payload.consultationId !== consultationId || message.payload.fingerprint !== input.fingerprint) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas pesan ini sudah dipakai untuk isi atau layanan lain.');
  }

  private isSafeAttachment(item: DomainEntity, message: DomainEntity): boolean {
    const kind = String(item.payload.kind);
    return item.kind === 'attachment' && item.ownerId === message.ownerId && item.contextId === message.id && item.payload.accessContext === 'consultation' && item.payload.uploadStatus === 'local' && ['image', 'video'].includes(kind) && String(item.payload.mimeType).startsWith(`${kind}/`) && String(item.payload.localUri).startsWith('file://');
  }

  private toAttachment(item: DomainEntity): ChatAttachment {
    return { id: item.id, filename: String(item.payload.filename), mimeType: String(item.payload.mimeType), byteSize: Number(item.payload.byteSize), kind: String(item.payload.kind) as 'image' | 'video', localUri: String(item.payload.localUri) };
  }

  private entity(kind: EntityKind, ownerId: string, contextId: string, payload: Record<string, unknown>, id = this.ids.create()): DomainEntity {
    const timestamp = this.now().toISOString();
    return { id, kind, ownerId, contextId, payload, version: 1, createdAt: timestamp, updatedAt: timestamp };
  }

  private updated(record: DomainEntity, changes: Record<string, unknown>): DomainEntity {
    return { ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, ...changes } };
  }
}

function participantIds(record: DomainEntity): string[] { return [String(record.payload.farmerId), String(record.payload.vetId)]; }
function canSendStatus(record: DomainEntity): boolean {
  const status = String(record.payload.status);
  const effective = status === 'reschedule_pending' ? String(record.payload.previousStatus ?? 'scheduled') : status;
  return ['scheduled', 'in_progress'].includes(effective) && !['completed', 'cancelled'].includes(status);
}
function validTimezone(value: unknown): string {
  if (typeof value !== 'string') return 'Asia/Jakarta';
  try { new Intl.DateTimeFormat('id-ID', { timeZone: value }).format(new Date(0)); return value; } catch { return 'Asia/Jakarta'; }
}
