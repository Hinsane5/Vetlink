import type { ApiChatMessage, ApiChatRepository, ApiSendMessageInput, ApiMessageAttachment } from '../../application/ports/ApiChatRepository';
import { ApiClient } from './ApiClient';
import {
  invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid,
  parseReadPage, validateOpaqueCursor, validatePageLimit,
} from './apiReadValidation';

const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] as const;
const STATUSES = ['pending', 'sent', 'failed'] as const;

/** BE-07 polling chat boundary; server controls participant scope and delivery state. */
export class HttpApiChatRepository implements ApiChatRepository {
  constructor(private readonly api: ApiClient) {}

  async list(consultationId: string, query: { limit?: number; cursor?: string } = {}) {
    const id = resourceId(consultationId, 'konsultasi');
    if (!isRecord(query)) throw invalidQuery('Filter pesan tidak valid.');
    const input = query as { limit?: number; cursor?: string };
    validatePageLimit(input.limit, 'pesan');
    validateOpaqueCursor(input.cursor, 'pesan');
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    const value = await this.api.request<unknown>(`/v1/consultations/${id}/messages${params.size ? `?${params}` : ''}`);
    const page = parseReadPage(value, parseMessage, 'pesan');
    for (let index = 1; index < page.items.length; index += 1) {
      if (Date.parse(page.items[index - 1].createdAt) > Date.parse(page.items[index].createdAt)) {
        throw invalidResponse('Urutan pesan harus lama ke baru pada setiap halaman.');
      }
    }
    return page;
  }

  async send(consultationId: string, input: ApiSendMessageInput): Promise<ApiChatMessage> {
    const id = resourceId(consultationId, 'konsultasi');
    const body = sendPayload(input);
    return parseMessage(await this.api.request<unknown>(`/v1/consultations/${id}/messages`, {
      method: 'POST', body,
    }));
  }

  async retry(consultationId: string, messageId: string): Promise<ApiChatMessage> {
    const id = resourceId(consultationId, 'konsultasi');
    const message = resourceId(messageId, 'pesan');
    const result = parseMessage(await this.api.request<unknown>(`/v1/consultations/${id}/messages/${message}/retry`, {
      method: 'POST',
    }));
    if (result.id !== messageId) throw invalidResponse('Retry harus mengembalikan pesan yang sama.');
    return result;
  }
}

function resourceId(value: string, label: string): string {
  if (!isUuid(value)) throw invalidQuery(`ID ${label} server harus UUID.`);
  return encodeURIComponent(value);
}

function sendPayload(input: ApiSendMessageInput): Record<string, unknown> {
  if (!isRecord(input) || !isUuid(input.clientMessageId)) throw invalidQuery('Pesan memerlukan clientMessageId UUID stabil.');
  const text = input.text;
  const attachmentIds = input.attachmentIds;
  if (text !== undefined && (typeof text !== 'string' || text.length > 4000)) throw invalidQuery('Teks pesan maksimal 4.000 karakter.');
  if (attachmentIds !== undefined && (!Array.isArray(attachmentIds) || attachmentIds.length > 5
    || !attachmentIds.every(isUuid) || new Set(attachmentIds).size !== attachmentIds.length)) {
    throw invalidQuery('Pesan menerima maksimal lima lampiran UUID yang berbeda.');
  }
  if (!text?.trim() && !attachmentIds?.length) throw invalidQuery('Teks atau lampiran pesan wajib tersedia.');
  return { clientMessageId: input.clientMessageId,
    ...(text === undefined ? {} : { text }),
    ...(attachmentIds === undefined ? {} : { attachmentIds: [...attachmentIds] }) };
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function parseAttachment(value: unknown): ApiMessageAttachment {
  if (!isRecord(value) || !isUuid(value.id) || !oneOf(value.kind, ['image', 'video'])
    || !oneOf(value.mimeType, MIMES)
    || (value.kind === 'video' ? value.mimeType !== 'video/mp4' : value.mimeType === 'video/mp4')
    || !isNonEmptyText(value.filename, 255)
    || !Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 1
    || value.url !== `/v1/attachments/${value.id}/content`) {
    throw invalidResponse('Lampiran pesan server tidak sesuai kontrak privat BE-07.');
  }
  return { id: value.id, kind: value.kind, mimeType: value.mimeType,
    filename: value.filename, byteSize: value.byteSize as number, url: value.url };
}

function parseMessage(value: unknown): ApiChatMessage {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.clientMessageId) || !isUuid(value.senderId)
    || !(value.text === null || (typeof value.text === 'string' && value.text.length <= 4000))
    || !Array.isArray(value.attachments) || value.attachments.length > 5
    || !oneOf(value.deliveryStatus, STATUSES)
    || !Number.isSafeInteger(value.deliveryAttempt) || Number(value.deliveryAttempt) < 1
    || !isIsoTimestampWithTimezone(value.createdAt)
    || !(value.sentAt === null || isIsoTimestampWithTimezone(value.sentAt))) {
    throw invalidResponse('Pesan server tidak sesuai MessageResponseDto BE-07.');
  }
  const attachments = value.attachments.map(parseAttachment);
  if (new Set(attachments.map((attachment) => attachment.id)).size !== attachments.length
    || (!value.text?.trim() && attachments.length === 0)
    || (value.deliveryStatus === 'sent' && value.sentAt === null)) {
    throw invalidResponse('Isi, lampiran, atau status pengiriman pesan tidak valid.');
  }
  return { id: value.id, clientMessageId: value.clientMessageId, senderId: value.senderId,
    text: value.text as string | null, attachments, deliveryStatus: value.deliveryStatus,
    deliveryAttempt: value.deliveryAttempt as number, createdAt: value.createdAt,
    sentAt: value.sentAt as string | null };
}
