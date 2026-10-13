import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal, UserRole } from '../auth/auth.types.js';
import type { MediaConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  AttachmentResponseDto,
  MessageAttachmentDto,
  MessagePageQueryDto,
  MessagePageResponseDto,
  MessageResponseDto,
  SendMessageDto,
  UploadAttachmentDto,
} from './communication.dto.js';
import { adapterFailed, type AdapterResult } from './adapter-result.js';
import { CHAT_DELIVERY_ADAPTER, type ChatDeliveryAdapter } from './chat-delivery.js';
import {
  MEDIA_CONFIG,
  MEDIA_STORAGE_ADAPTER,
  newStorageKey,
  type OpenPrivateMedia,
  type PrivateMediaStorageAdapter,
} from './media-storage.js';

const UPLOAD_LEASE_MS = 5 * 60 * 1000;

export interface IncomingMediaFile {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

interface ConsultationContext {
  id: string;
  farmer_id: string;
  vet_id: string;
  service_type: 'chat' | 'visit';
  status: string;
  fee_snapshot_idr: string;
  verification_status: string;
  payment_succeeded: boolean;
}

interface AttachmentRow {
  id: string;
  owner_id: string;
  consultation_id: string;
  kind: 'image' | 'video';
  mime_type: string;
  filename: string;
  byte_size: string | number;
  content_sha256: string;
  storage_key: string | null;
  upload_key: string;
  upload_fingerprint: string;
  upload_status: 'pending' | 'uploaded' | 'failed' | 'committed';
  upload_attempt: number;
  upload_attempted_at: Date | string;
  failure_code: string | null;
  committed_at: Date | string | null;
  created_at: Date | string;
}

interface MessageRow {
  id: string;
  consultation_id: string;
  sender_id: string;
  client_message_id: string;
  text: string | null;
  fingerprint: string;
  delivery_status: 'pending' | 'sent' | 'failed';
  delivery_attempt: number;
  delivery_attempt_at: Date | string;
  sent_at: Date | string | null;
  created_at: Date | string;
}

interface UploadClaim {
  row: AttachmentRow;
  attempt: number;
  claimed: boolean;
}

interface MessageClaim {
  messageId: string;
  attempt: number | null;
}

interface CursorValue {
  createdAt: string;
  id: string;
}

function validation(field: string, message: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Request validation failed',
    fieldErrors: { [field]: [message] },
  });
}

function conflict(message: string): never {
  throw new ConflictException({ code: 'CONFLICT', message });
}

function ruleViolation(message: string): never {
  throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message });
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeFilename(value: string | undefined): string {
  const candidate = basename((value ?? '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!candidate || [...candidate].length > 255) validation('file', 'Nama file harus berisi 1–255 karakter.');
  return candidate;
}

function detectMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

function attachmentDto(row: AttachmentRow): AttachmentResponseDto {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    filename: row.filename,
    byteSize: Number(row.byte_size),
    uploadStatus: row.upload_status === 'committed' ? 'committed' : 'uploaded',
    url: `/v1/attachments/${row.id}/content`,
    createdAt: iso(row.created_at)!,
  };
}

@Injectable()
export class CommunicationService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(MEDIA_CONFIG) private readonly mediaConfig: MediaConfig,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly mediaStorage: PrivateMediaStorageAdapter,
    @Inject(CHAT_DELIVERY_ADAPTER) private readonly delivery: ChatDeliveryAdapter,
  ) {}

  async uploadAttachment(
    principal: AuthenticatedPrincipal,
    input: UploadAttachmentDto,
    uploadKey: string | undefined,
    file: IncomingMediaFile | undefined,
  ): Promise<AttachmentResponseDto> {
    const key = this.requireUploadKey(uploadKey);
    const validated = this.validateMediaFile(file);
    const context = await this.consultation(principal.userId, principal.activeRole, input.consultationId);
    this.assertWritable(context, principal.activeRole);

    const fingerprint = sha256(JSON.stringify({
      consultationId: context.id,
      filename: validated.filename,
      mimeType: validated.mimeType,
      kind: validated.kind,
      contentSha256: validated.contentSha256,
    }));
    const claim = await this.claimUpload({
      principal,
      context,
      key,
      fingerprint,
      file: validated,
    });
    if (!claim.claimed) return attachmentDto(claim.row);

    const storageKey = newStorageKey();
    const outcome = await this.mediaStorage.store(storageKey, validated.bytes);
    if (outcome.status !== 'succeeded') {
      await this.markUploadFailed(claim.row.id, claim.attempt, outcome.status === 'failed' ? outcome.error.code : 'PRIVATE_STORAGE_PENDING');
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: outcome.status === 'failed' ? outcome.error.message : 'Penyimpanan media masih memproses berkas.',
      });
    }

    try {
      const stored = await this.database.query<AttachmentRow>(
        `UPDATE attachments
         SET storage_key = $3, upload_status = 'uploaded', failure_code = NULL, updated_at = now()
         WHERE id = $1 AND upload_attempt = $2 AND upload_status = 'pending'
         RETURNING *`,
        [claim.row.id, claim.attempt, storageKey],
      );
      if (!stored.rows[0]) {
        await this.mediaStorage.remove(storageKey);
        conflict('Permintaan unggah berubah; ulangi unggahan dengan kunci yang sama.');
      }
      return attachmentDto(stored.rows[0]);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.mediaStorage.remove(storageKey);
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Metadata media belum dapat disimpan; unggah dapat dicoba ulang.' });
    }
  }

  async commitAttachment(principal: AuthenticatedPrincipal, attachmentId: string): Promise<AttachmentResponseDto> {
    const initial = await this.database.query<AttachmentRow>(
      'SELECT * FROM attachments WHERE id = $1 AND owner_id = $2',
      [attachmentId, principal.userId],
    );
    const row = initial.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
    const context = await this.consultation(principal.userId, principal.activeRole, row.consultation_id);
    this.assertWritable(context, principal.activeRole);
    if (row.upload_status === 'committed') return attachmentDto(row);
    if (row.upload_status !== 'uploaded' || !row.storage_key) conflict('Lampiran belum berhasil diunggah.');

    const verification = await this.mediaStorage.open(row.storage_key);
    if (verification.status !== 'succeeded') {
      await this.markUploadFailed(row.id, row.upload_attempt, verification.status === 'failed' ? verification.error.code : 'PRIVATE_STORAGE_PENDING');
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Berkas media tidak dapat diverifikasi; unggah dapat dicoba ulang.' });
    }
    verification.value.stream.destroy();

    const committed = await this.database.query<AttachmentRow>(
      `UPDATE attachments
       SET upload_status = 'committed', committed_at = now(), updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND upload_status = 'uploaded'
       RETURNING *`,
      [row.id, principal.userId],
    );
    if (!committed.rows[0]) {
      const current = await this.database.query<AttachmentRow>('SELECT * FROM attachments WHERE id = $1 AND owner_id = $2', [row.id, principal.userId]);
      if (current.rows[0]?.upload_status === 'committed') return attachmentDto(current.rows[0]);
      conflict('Status lampiran berubah; muat ulang sebelum mencoba lagi.');
    }
    return attachmentDto(committed.rows[0]);
  }

  async attachmentMetadata(principal: AuthenticatedPrincipal, attachmentId: string): Promise<AttachmentResponseDto> {
    const row = await this.visibleAttachment(principal, attachmentId);
    if (row.upload_status !== 'committed') throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
    return attachmentDto(row);
  }

  async openAttachment(principal: AuthenticatedPrincipal, attachmentId: string): Promise<{ row: AttachmentRow; media: OpenPrivateMedia }> {
    const row = await this.visibleAttachment(principal, attachmentId);
    if (row.upload_status !== 'committed' || !row.storage_key) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
    const outcome = await this.mediaStorage.open(row.storage_key);
    if (outcome.status !== 'succeeded') {
      if (outcome.status === 'failed' && outcome.error.code === 'PRIVATE_MEDIA_NOT_FOUND') {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
      }
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Penyimpanan media tidak tersedia.' });
    }
    return { row, media: outcome.value };
  }

  async listMessages(
    principal: AuthenticatedPrincipal,
    consultationId: string,
    query: MessagePageQueryDto,
  ): Promise<MessagePageResponseDto> {
    const context = await this.consultation(principal.userId, principal.activeRole, consultationId);
    this.assertReadable(context);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const result = await this.database.query<MessageRow>(
      `SELECT m.*
       FROM consultation_messages m
       WHERE m.consultation_id = $1
         AND (m.sender_id = $2 OR m.delivery_status = 'sent')
         AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3::timestamptz, $4::uuid))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $5`,
      [context.id, principal.userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const descending = result.rows.slice(0, limit);
    const nextCursor = hasMore && descending.length > 0 ? this.encodeCursor(descending.at(-1)!) : null;
    const ids = descending.map((item) => item.id);
    const linked = ids.length > 0
      ? await this.database.query<{
          message_id: string;
          id: string;
          kind: 'image' | 'video';
          mime_type: string;
          filename: string;
          byte_size: string | number;
        }>(
          `SELECT ma.message_id, a.id, a.kind, a.mime_type, a.filename, a.byte_size
           FROM message_attachments ma
           JOIN attachments a ON a.id = ma.attachment_id
           WHERE ma.message_id = ANY($1::uuid[]) AND a.upload_status = 'committed'
           ORDER BY ma.message_id, ma.position`,
          [ids],
        )
      : { rows: [] };
    const attachmentsByMessage = new Map<string, MessageAttachmentDto[]>();
    for (const item of linked.rows) {
      const collection = attachmentsByMessage.get(item.message_id) ?? [];
      collection.push({
        id: item.id,
        kind: item.kind,
        mimeType: item.mime_type,
        filename: item.filename,
        byteSize: Number(item.byte_size),
        url: `/v1/attachments/${item.id}/content`,
      });
      attachmentsByMessage.set(item.message_id, collection);
    }

    return {
      items: descending.reverse().map((item) => this.messageDto(item, attachmentsByMessage.get(item.id) ?? [])),
      nextCursor,
      hasMore,
    };
  }

  async sendMessage(principal: AuthenticatedPrincipal, consultationId: string, input: SendMessageDto): Promise<MessageResponseDto> {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const attachmentIds = input.attachmentIds ?? [];
    if (!text && attachmentIds.length === 0) validation('text', 'Tulis pesan atau lampirkan media.');
    if (text.length > 4000) validation('text', 'Pesan maksimal 4.000 karakter.');
    if (attachmentIds.length > 5 || new Set(attachmentIds).size !== attachmentIds.length) {
      validation('attachmentIds', 'Pilih paling banyak lima lampiran berbeda.');
    }
    const fingerprint = sha256(JSON.stringify({ consultationId, senderId: principal.userId, text: text || null, attachmentIds }));
    let claim: MessageClaim;
    try {
      claim = await this.database.transaction(async (client) => {
        const context = await this.consultation(principal.userId, principal.activeRole, consultationId, client);
        this.assertWritable(context, principal.activeRole);

        const existing = await client.query<MessageRow>(
          `SELECT * FROM consultation_messages
           WHERE consultation_id = $1 AND sender_id = $2 AND client_message_id = $3
           FOR UPDATE`,
          [context.id, principal.userId, input.clientMessageId],
        );
        if (existing.rows[0]) {
          return this.claimExistingMessage(client, existing.rows[0], fingerprint);
        }

        if (attachmentIds.length > 0) {
          const attachments = await client.query<{ id: string }>(
            `SELECT id FROM attachments
             WHERE id = ANY($1::uuid[])
               AND consultation_id = $2
               AND owner_id = $3
               AND upload_status = 'committed'
             FOR UPDATE`,
            [attachmentIds, context.id, principal.userId],
          );
          if (attachments.rowCount !== attachmentIds.length) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan atau bukan milik pesan ini.' });
          }
        }

        const inserted = await client.query<MessageRow>(
          `INSERT INTO consultation_messages
             (consultation_id, sender_id, client_message_id, text, fingerprint, delivery_status, delivery_attempt, delivery_attempt_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', 1, now())
           ON CONFLICT (consultation_id, sender_id, client_message_id) DO NOTHING
           RETURNING *`,
          [context.id, principal.userId, input.clientMessageId, text || null, fingerprint],
        );
        if (!inserted.rows[0]) {
          const concurrent = await client.query<MessageRow>(
            `SELECT * FROM consultation_messages
             WHERE consultation_id = $1 AND sender_id = $2 AND client_message_id = $3
             FOR UPDATE`,
            [context.id, principal.userId, input.clientMessageId],
          );
          if (!concurrent.rows[0]) conflict('Pesan belum dapat disimpan; ulangi permintaan dengan clientMessageId yang sama.');
          return this.claimExistingMessage(client, concurrent.rows[0], fingerprint);
        }

        for (const [position, attachmentId] of attachmentIds.entries()) {
          await client.query(
            `INSERT INTO message_attachments (message_id, attachment_id, consultation_id, sender_id, owner_id, position)
             VALUES ($1, $2, $3, $4, $4, $5)`,
            [inserted.rows[0].id, attachmentId, context.id, principal.userId, position],
          );
        }
        return { messageId: inserted.rows[0].id, attempt: 1 };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') conflict('Salah satu lampiran sudah dipakai pesan lain.');
      throw error;
    }

    if (claim.attempt !== null) await this.attemptDelivery(claim.messageId, claim.attempt);
    return this.getMessage(principal, consultationId, claim.messageId);
  }

  async retryMessage(principal: AuthenticatedPrincipal, consultationId: string, messageId: string): Promise<MessageResponseDto> {
    const claim = await this.database.transaction(async (client) => {
      const context = await this.consultation(principal.userId, principal.activeRole, consultationId, client);
      this.assertWritable(context, principal.activeRole);
      const result = await client.query<MessageRow>(
        `SELECT * FROM consultation_messages
         WHERE id = $1 AND consultation_id = $2 AND sender_id = $3
         FOR UPDATE`,
        [messageId, context.id, principal.userId],
      );
      const message = result.rows[0];
      if (!message) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pesan tidak ditemukan.' });
      if (message.delivery_status === 'sent') return { messageId: message.id, attempt: null };

      const next = await client.query<MessageRow>(
        `UPDATE consultation_messages
         SET delivery_status = 'pending', delivery_attempt = delivery_attempt + 1,
             delivery_attempt_at = now(), sent_at = NULL, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [message.id],
      );
      return { messageId: message.id, attempt: next.rows[0].delivery_attempt };
    });

    if (claim.attempt !== null) await this.attemptDelivery(claim.messageId, claim.attempt);
    return this.getMessage(principal, consultationId, claim.messageId);
  }

  private async claimExistingMessage(client: PoolClient, message: MessageRow, fingerprint: string): Promise<MessageClaim> {
    if (message.fingerprint !== fingerprint) conflict('clientMessageId sudah digunakan untuk isi pesan yang berbeda.');
    if (message.delivery_status !== 'failed') return { messageId: message.id, attempt: null };
    const next = await client.query<MessageRow>(
      `UPDATE consultation_messages
       SET delivery_status = 'pending', delivery_attempt = delivery_attempt + 1,
           delivery_attempt_at = now(), sent_at = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [message.id],
    );
    return { messageId: message.id, attempt: next.rows[0].delivery_attempt };
  }

  private async attemptDelivery(messageId: string, attempt: number): Promise<void> {
    let outcome: AdapterResult<void>;
    try {
      outcome = await this.delivery.deliver(messageId, attempt);
    } catch {
      outcome = adapterFailed('LOCAL_DELIVERY_UNAVAILABLE', 'Pengiriman pesan sementara gagal.', true);
    }
    if (outcome.status !== 'failed') return;
    try {
      await this.database.query(
        `UPDATE consultation_messages
         SET delivery_status = 'failed', sent_at = NULL, updated_at = now()
         WHERE id = $1 AND delivery_attempt = $2 AND delivery_status = 'pending'`,
        [messageId, attempt],
      );
    } catch {
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Status pengiriman belum dapat disimpan; ulangi pesan dengan identitas yang sama.' });
    }
  }

  private async getMessage(principal: AuthenticatedPrincipal, consultationId: string, messageId: string): Promise<MessageResponseDto> {
    const result = await this.database.query<MessageRow>(
      `SELECT * FROM consultation_messages
       WHERE id = $1 AND consultation_id = $2
         AND (sender_id = $3 OR delivery_status = 'sent')`,
      [messageId, consultationId, principal.userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pesan tidak ditemukan.' });
    const linked = await this.database.query<{
      id: string;
      kind: 'image' | 'video';
      mime_type: string;
      filename: string;
      byte_size: string | number;
    }>(
      `SELECT a.id, a.kind, a.mime_type, a.filename, a.byte_size
       FROM message_attachments ma
       JOIN attachments a ON a.id = ma.attachment_id
       WHERE ma.message_id = $1 AND a.upload_status = 'committed'
       ORDER BY ma.position`,
      [messageId],
    );
    return this.messageDto(row, linked.rows.map((item) => ({
      id: item.id,
      kind: item.kind,
      mimeType: item.mime_type,
      filename: item.filename,
      byteSize: Number(item.byte_size),
      url: `/v1/attachments/${item.id}/content`,
    })));
  }

  private async visibleAttachment(principal: AuthenticatedPrincipal, attachmentId: string): Promise<AttachmentRow> {
    const result = await this.database.query<AttachmentRow>(
      `SELECT a.*
       FROM attachments a
       JOIN consultations c ON c.id = a.consultation_id
       WHERE a.id = $1
         AND (($2 = 'farmer' AND c.farmer_id = $3) OR ($2 = 'vet' AND c.vet_id = $3))`,
      [attachmentId, principal.activeRole, principal.userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
    const context = await this.consultation(principal.userId, principal.activeRole, row.consultation_id);
    this.assertReadable(context);

    if (row.owner_id !== principal.userId) {
      const link = await this.database.query(
        `SELECT 1
         FROM message_attachments ma
         JOIN consultation_messages m ON m.id = ma.message_id
         WHERE ma.attachment_id = $1 AND m.delivery_status = 'sent'
         LIMIT 1`,
        [row.id],
      );
      if (link.rowCount !== 1) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lampiran tidak ditemukan.' });
    }
    return row;
  }

  private async claimUpload(args: {
    principal: AuthenticatedPrincipal;
    context: ConsultationContext;
    key: string;
    fingerprint: string;
    file: { kind: 'image' | 'video'; mimeType: string; filename: string; byteSize: number; contentSha256: string };
  }): Promise<UploadClaim> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<AttachmentRow>(
        `SELECT * FROM attachments
         WHERE owner_id = $1 AND consultation_id = $2 AND upload_key = $3
         FOR UPDATE`,
        [args.principal.userId, args.context.id, args.key],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.upload_fingerprint !== args.fingerprint) conflict('Idempotency-Key sudah digunakan untuk berkas yang berbeda.');
        if (row.upload_status === 'uploaded' || row.upload_status === 'committed') {
          return { row, attempt: row.upload_attempt, claimed: false };
        }
        const attemptedAt = row.upload_attempted_at instanceof Date
          ? row.upload_attempted_at.getTime()
          : Date.parse(row.upload_attempted_at);
        const age = Date.now() - attemptedAt;
        if (row.upload_status === 'pending' && age < UPLOAD_LEASE_MS) conflict('Unggahan dengan kunci ini masih diproses; coba lagi sebentar.');
        const updated = await client.query<AttachmentRow>(
          `UPDATE attachments
           SET upload_status = 'pending', upload_attempt = upload_attempt + 1,
               upload_attempted_at = now(), failure_code = NULL, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [row.id],
        );
        return { row: updated.rows[0], attempt: updated.rows[0].upload_attempt, claimed: true };
      }

      const inserted = await client.query<AttachmentRow>(
        `INSERT INTO attachments
           (owner_id, consultation_id, kind, mime_type, filename, byte_size, content_sha256,
            upload_key, upload_fingerprint, upload_status, upload_attempt, upload_attempted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 1, now())
         RETURNING *`,
        [
          args.principal.userId,
          args.context.id,
          args.file.kind,
          args.file.mimeType,
          args.file.filename,
          args.file.byteSize,
          args.file.contentSha256,
          args.key,
          args.fingerprint,
        ],
      );
      return { row: inserted.rows[0], attempt: inserted.rows[0].upload_attempt, claimed: true };
    });
  }

  private async markUploadFailed(attachmentId: string, attempt: number, code: string): Promise<void> {
    try {
      await this.database.query(
        `UPDATE attachments
         SET upload_status = 'failed', storage_key = NULL, failure_code = $3, updated_at = now()
         WHERE id = $1 AND upload_attempt = $2 AND upload_status = 'pending'`,
        [attachmentId, attempt, code],
      );
    } catch {
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Hasil unggah belum dapat disimpan; ulangi dengan Idempotency-Key yang sama.' });
    }
  }

  private validateMediaFile(file: IncomingMediaFile | undefined): {
    bytes: Buffer;
    filename: string;
    mimeType: string;
    kind: 'image' | 'video';
    byteSize: number;
    contentSha256: string;
  } {
    if (!file || !Buffer.isBuffer(file.buffer)) validation('file', 'Pilih satu berkas media.');
    const bytes = file.buffer;
    const byteSize = bytes.length;
    if (byteSize < 1 || !Number.isSafeInteger(byteSize)) validation('file', 'Berkas media kosong atau ukurannya tidak valid.');

    const detected = detectMime(bytes);
    const declared = (file.mimetype ?? '').trim().toLowerCase();
    if (!detected || detected !== declared) validation('file', 'Tipe berkas tidak sesuai dengan MIME yang terdeteksi.');
    const kind = detected.startsWith('image/') ? 'image' : 'video';
    const maxBytes = kind === 'image' ? this.mediaConfig.imageMaxBytes : this.mediaConfig.videoMaxBytes;
    if (byteSize > maxBytes) {
      validation('file', `Ukuran ${kind === 'image' ? 'gambar' : 'video'} melebihi batas ${maxBytes} byte.`);
    }

    return {
      bytes,
      filename: safeFilename(file.originalname),
      mimeType: detected,
      kind,
      byteSize,
      contentSha256: sha256(bytes),
    };
  }

  private requireUploadKey(value: string | undefined): string {
    const key = value?.trim() ?? '';
    if (key.length < 8 || key.length > 128) validation('Idempotency-Key', 'Gunakan Idempotency-Key sepanjang 8–128 karakter.');
    return key;
  }

  private async consultation(
    userId: string,
    role: UserRole,
    consultationId: string,
    client?: PoolClient,
  ): Promise<ConsultationContext> {
    const sql =
      `SELECT c.id, c.farmer_id, c.vet_id, c.service_type, c.status,
              c.fee_snapshot_idr::text AS fee_snapshot_idr, vp.verification_status,
              EXISTS (
                SELECT 1 FROM payments p
                WHERE p.owner_id = c.farmer_id
                  AND p.payable_type = 'consultation'
                  AND p.payable_id = c.id
                  AND p.amount_idr = c.fee_snapshot_idr
                  AND p.status = 'succeeded'
              ) AS payment_succeeded
       FROM consultations c
       JOIN vet_profiles vp ON vp.user_id = c.vet_id
       WHERE c.id = $1
         AND (($2 = 'farmer' AND c.farmer_id = $3) OR ($2 = 'vet' AND c.vet_id = $3))`;
    const values = [consultationId, role, userId];
    const result = client
      ? await client.query<ConsultationContext>(sql, values)
      : await this.database.query<ConsultationContext>(sql, values);
    const context = result.rows[0];
    if (!context) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Konsultasi tidak ditemukan.' });
    if (context.service_type !== 'chat') ruleViolation('Percakapan hanya tersedia untuk konsultasi chat.');
    if (!context.payment_succeeded) ruleViolation('Chat tersedia setelah pembayaran layanan berhasil.');
    if (!['scheduled', 'in_progress', 'reschedule_pending', 'completed', 'cancelled'].includes(context.status)) {
      ruleViolation('Chat belum tersedia untuk status layanan ini.');
    }
    return context;
  }

  private assertReadable(context: ConsultationContext): void {
    if (!['scheduled', 'in_progress', 'reschedule_pending', 'completed', 'cancelled'].includes(context.status)) {
      ruleViolation('Chat belum tersedia untuk status layanan ini.');
    }
  }

  private assertWritable(context: ConsultationContext, role: UserRole): void {
    if (!['scheduled', 'in_progress'].includes(context.status)) ruleViolation('Percakapan ini hanya dapat dibaca.');
    if (context.verification_status !== 'verified') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Layanan tidak dapat dilanjutkan karena dokter belum terverifikasi.' });
    }
  }

  private decodeCursor(value: string): CursorValue {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) validation('cursor', 'Cursor paginasi tidak valid.');
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorValue>;
      const timestamp = typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : Number.NaN;
      if (!Number.isFinite(timestamp) || typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.id)) {
        validation('cursor', 'Cursor paginasi tidak valid.');
      }
      return { createdAt: new Date(timestamp).toISOString(), id: parsed.id };
    } catch {
      return validation('cursor', 'Cursor paginasi tidak valid.');
    }
  }

  private encodeCursor(row: MessageRow): string {
    return Buffer.from(JSON.stringify({ createdAt: iso(row.created_at), id: row.id })).toString('base64url');
  }

  private messageDto(row: MessageRow, attachments: MessageAttachmentDto[]): MessageResponseDto {
    return {
      id: row.id,
      clientMessageId: row.client_message_id,
      senderId: row.sender_id,
      text: row.text,
      attachments,
      deliveryStatus: row.delivery_status,
      deliveryAttempt: row.delivery_attempt,
      createdAt: iso(row.created_at)!,
      sentAt: iso(row.sent_at),
    };
  }
}
