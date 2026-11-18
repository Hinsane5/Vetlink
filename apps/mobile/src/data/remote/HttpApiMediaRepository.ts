import type { ApiMediaAttachment, ApiMediaFile, ApiMediaRepository } from '../../application/ports/ApiMediaRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const LIMIT_IMAGE = 10 * 1024 * 1024;
const LIMIT_VIDEO = 50 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

/** BE-07 private media boundary. Actor and consultation scope remain enforced by the API. */
export class HttpApiMediaRepository implements ApiMediaRepository {
  constructor(private readonly api: ApiClient) {}

  async upload(consultationId: string, file: ApiMediaFile, idempotencyKey: string): Promise<ApiMediaAttachment> {
    if (!isUuid(consultationId)) throw invalidQuery('ID konsultasi server harus UUID.');
    if (!isRecord(file) || typeof file.uri !== 'string' || !/^(file|content):\/\//.test(file.uri)
      || !isNonEmptyText(file.filename, 255) || !MIMES.includes(file.mimeType)
      || !Number.isSafeInteger(file.byteSize) || file.byteSize < 1
      || file.byteSize > (file.mimeType === 'video/mp4' ? LIMIT_VIDEO : LIMIT_IMAGE)) {
      throw invalidQuery('Berkas media tidak sesuai jenis atau batas ukuran BE-07.');
    }
    const form = new FormData();
    form.append('consultationId', consultationId);
    // React Native fetch consumes a local URI descriptor through FormData.
    form.append('file', { uri: file.uri, name: file.filename, type: file.mimeType } as unknown as Blob);
    const value = await this.api.uploadMultipart<unknown>('/v1/attachments/uploads', form, idempotencyKey);
    const result = parseAttachment(value);
    if (result.uploadStatus !== 'uploaded' || result.byteSize !== file.byteSize || result.mimeType !== file.mimeType) {
      throw invalidResponse('Hasil unggah media tidak cocok dengan berkas lokal.');
    }
    return result;
  }

  async commit(attachmentId: string): Promise<ApiMediaAttachment> {
    const id = resourceId(attachmentId);
    const result = parseAttachment(await this.api.request<unknown>(`/v1/attachments/${id}/commit`, { method: 'POST' }));
    if (result.id !== id || result.uploadStatus !== 'committed') throw invalidResponse('Commit media tidak sesuai ID atau status.');
    return result;
  }

  async get(attachmentId: string): Promise<ApiMediaAttachment> {
    const id = resourceId(attachmentId);
    const result = parseAttachment(await this.api.request<unknown>(`/v1/attachments/${id}`));
    if (result.id !== id) throw invalidResponse('Metadata media tidak sesuai ID.');
    return result;
  }

  async download(attachmentId: string): Promise<ArrayBuffer> {
    const id = resourceId(attachmentId);
    const metadata = await this.get(id);
    if (metadata.uploadStatus !== 'committed') throw invalidQuery('Media belum di-commit.');
    const bytes = await this.api.downloadBytes(metadata.url);
    if (bytes.byteLength !== metadata.byteSize) throw invalidResponse('Ukuran berkas media tidak cocok dengan metadata.');
    return bytes;
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID lampiran server harus UUID.');
  return value;
}

function parseAttachment(value: unknown): ApiMediaAttachment {
  if (!isRecord(value) || !isUuid(value.id) || !['image', 'video'].includes(value.kind as string)
    || !MIMES.includes(value.mimeType as string)
    || (value.kind === 'video' ? value.mimeType !== 'video/mp4' : value.mimeType === 'video/mp4')
    || !isNonEmptyText(value.filename, 255) || !Number.isSafeInteger(value.byteSize)
    || Number(value.byteSize) < 1 || Number(value.byteSize) > (value.kind === 'video' ? LIMIT_VIDEO : LIMIT_IMAGE)
    || !['uploaded', 'committed'].includes(value.uploadStatus as string)
    || value.url !== `/v1/attachments/${value.id}/content`
    || !isIsoTimestampWithTimezone(value.createdAt)) {
    throw invalidResponse('Metadata media tidak sesuai kontrak privat BE-07.');
  }
  return { id: value.id, kind: value.kind as ApiMediaAttachment['kind'], mimeType: value.mimeType as ApiMediaAttachment['mimeType'],
    filename: value.filename, byteSize: value.byteSize as number, uploadStatus: value.uploadStatus as ApiMediaAttachment['uploadStatus'],
    url: value.url, createdAt: value.createdAt };
}
