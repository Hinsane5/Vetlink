import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { ApiMediaFile } from '../../application/ports/ApiMediaRepository';
import type { ServerChatMediaStore } from '../../application/ports/ServerChatMediaStore';
import type { ApiMessageAttachment } from '../../application/ports/ApiChatRepository';
import type { SelectedAsset } from '../../domain/profiles';
import { DomainError } from '../../domain/errors';

/** Keeps selected upload bytes and downloaded private media inside app storage. */
export class ExpoServerChatMediaStore implements ServerChatMediaStore {
  async copyToPrivateStorage(userId: string, selected: SelectedAsset): Promise<ApiMediaFile> {
    let destination: File | null = null;
    try {
      const directory = this.directory(userId);
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const source = new File(selected.uri);
      const mimeType = selected.mimeType.toLowerCase();
      const maximumBytes = mimeType === 'video/mp4' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (Number.isSafeInteger(source.size) && source.size > maximumBytes) throw new Error('source media too large');
      destination = new File(directory, `${Crypto.randomUUID()}_${safeFilename(selected.filename)}`);
      source.copy(destination);
      if (!destination.exists || !Number.isSafeInteger(destination.size) || destination.size < 1 || destination.size > maximumBytes
        || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(mimeType)
        || (selected.kind === 'video') !== (mimeType === 'video/mp4')) throw new Error('invalid local media file');
      return { uri: destination.uri, filename: selected.filename.trim().slice(0, 60), mimeType: mimeType as ApiMediaFile['mimeType'], byteSize: destination.size };
    } catch {
      try { if (destination?.exists) destination.delete(); } catch { /* Keep the original error. */ }
      throw new DomainError('SESSION_STORAGE_FAILED', 'Media belum dapat disalin ke penyimpanan privat aplikasi.');
    }
  }

  async storeDownloadedFile(userId: string, attachment: ApiMessageAttachment, bytes: ArrayBuffer): Promise<string> {
    let destination: File | null = null;
    try {
      const maximumBytes = attachment.kind === 'video' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (bytes.byteLength !== attachment.byteSize || bytes.byteLength < 1 || bytes.byteLength > maximumBytes)
        throw new Error('download length mismatch');
      const directory = this.directory(userId);
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      destination = new File(directory, `${attachment.id}${extensionFor(attachment.mimeType)}`);
      destination.create({ intermediates: true, overwrite: true });
      destination.write(new Uint8Array(bytes));
      if (!destination.exists || destination.size !== attachment.byteSize) throw new Error('stored media length mismatch');
      return destination.uri;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Lampiran belum dapat disimpan ke penyimpanan privat aplikasi.');
    }
  }

  async removePrivateFile(uri: string): Promise<void> {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'File sementara chat belum dapat dibersihkan.');
    }
  }

  private directory(userId: string): Directory {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('invalid user id');
    return new Directory(Paths.document, 'server-chat-media', userId);
  }
}

function safeFilename(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return safe || 'media';
}

function extensionFor(mimeType: ApiMessageAttachment['mimeType']): string {
  switch (mimeType) {
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    case 'video/mp4': return '.mp4';
  }
}
