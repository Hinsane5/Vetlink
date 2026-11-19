import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import type { ApiProfessionalDocument, ApiProfessionalDocumentFile } from '../../application/ports/ApiProfileRepository';
import type { PendingVetDocumentUpload, SelectedVetDocumentFile, ServerVetVerificationStore } from '../../application/ports/ServerVetVerificationStore';
import { DomainError } from '../../domain/errors';

/** Persists selected verification bytes and retry state privately on this device. */
export class ExpoServerVetVerificationStore implements ServerVetVerificationStore {
  async copyToPrivateStorage(userId: string, file: SelectedVetDocumentFile): Promise<ApiProfessionalDocumentFile> {
    let destination: File | null = null;
    try {
      const directory = new Directory(Paths.document, 'vet-verification', userId);
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const storedName = `${Crypto.randomUUID()}_${safeFilename(file.filename)}`;
      const source = new File(file.uri);
      destination = new File(directory, storedName);
      source.copy(destination);
      if (!destination.exists || !Number.isSafeInteger(destination.size) || destination.size < 1 || destination.size > 10 * 1024 * 1024)
        throw new Error('invalid stored document size');
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)) throw new Error('invalid mime type');
      return { uri: destination.uri, filename: file.filename, mimeType: file.mimeType as ApiProfessionalDocumentFile['mimeType'], byteSize: destination.size };
    } catch {
      try { if (destination?.exists) destination.delete(); } catch { /* Best effort cleanup after a rejected copy. */ }
      throw new DomainError('SESSION_STORAGE_FAILED', 'Dokumen verifikasi belum dapat disimpan di ruang privat aplikasi.');
    }
  }

  async removePrivateFile(uri: string): Promise<void> {
    try { const file = new File(uri); if (file.exists) file.delete(); }
    catch { throw new DomainError('SESSION_STORAGE_FAILED', 'Salinan dokumen privat belum dapat dibersihkan.'); }
  }

  async readPendingUpload(userId: string): Promise<PendingVetDocumentUpload | null> {
    try {
      const raw = await SecureStore.getItemAsync(pendingKey(userId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isPending(parsed)) throw new Error('invalid pending upload');
      return parsed;
    } catch { throw storageError('Upload dokumen tertunda tidak dapat dibaca dengan aman.'); }
  }

  async writePendingUpload(userId: string, value: PendingVetDocumentUpload): Promise<void> {
    if (!isPending(value)) throw new DomainError('VALIDATION_FAILED', 'Operasi upload dokumen tidak valid.');
    try { await SecureStore.setItemAsync(pendingKey(userId), JSON.stringify(value)); }
    catch { throw storageError('Kunci retry dokumen tidak dapat disimpan dengan aman.'); }
  }

  async clearPendingUpload(userId: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(pendingKey(userId)); }
    catch { throw storageError('Kunci retry dokumen belum dapat dibersihkan.'); }
  }

  async listUploaded(userId: string): Promise<ApiProfessionalDocument[]> {
    try {
      const raw = await SecureStore.getItemAsync(uploadedKey(userId));
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length > 5 || !value.every(isDocument) || new Set(value.map((item) => item.id)).size !== value.length)
        throw new Error('invalid uploaded document list');
      return value;
    } catch { throw storageError('Daftar dokumen tersimpan tidak dapat dibaca dengan aman.'); }
  }

  async appendUploaded(userId: string, document: ApiProfessionalDocument): Promise<void> {
    if (!isDocument(document)) throw new DomainError('API_RESPONSE_INVALID', 'Metadata dokumen server tidak valid.');
    const current = await this.listUploaded(userId);
    const existing = current.find((item) => item.id === document.id);
    if (existing) {
      if (existing.filename !== document.filename || existing.mimeType !== document.mimeType || existing.byteSize !== document.byteSize)
        throw new DomainError('API_RESPONSE_INVALID', 'ID dokumen server memiliki metadata berbeda.');
      return;
    }
    if (current.length >= 5) throw new DomainError('VALIDATION_FAILED', 'Maksimal lima dokumen dapat diajukan.');
    try { await SecureStore.setItemAsync(uploadedKey(userId), JSON.stringify([...current, document])); }
    catch { throw storageError('Daftar dokumen unggahan belum dapat disimpan.'); }
  }

  async clearUploaded(userId: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(uploadedKey(userId)); }
    catch { throw storageError('Daftar dokumen unggahan belum dapat dibersihkan.'); }
  }
}

function pendingKey(userId: string): string { return `vetlink.api.vetdocs.pending.v1:${userId}`; }
function uploadedKey(userId: string): string { return `vetlink.api.vetdocs.uploaded.v1:${userId}`; }
function storageError(message: string): DomainError { return new DomainError('SESSION_STORAGE_FAILED', message); }
function safeFilename(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'document'; }

function isPending(value: unknown): value is PendingVetDocumentUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isFile(item.file) && typeof item.idempotencyKey === 'string' && item.idempotencyKey.length >= 8 && item.idempotencyKey.length <= 128;
}
function isFile(value: unknown): value is ApiProfessionalDocumentFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.uri === 'string' && item.uri.startsWith('file://')
    && typeof item.filename === 'string' && item.filename.length > 0 && item.filename.length <= 255
    && ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(String(item.mimeType))
    && Number.isSafeInteger(item.byteSize) && Number(item.byteSize) > 0 && Number(item.byteSize) <= 10 * 1024 * 1024;
}
function isDocument(value: unknown): value is ApiProfessionalDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id)
    && typeof item.filename === 'string' && item.filename.length > 0 && item.filename.length <= 255
    && ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(String(item.mimeType))
    && Number.isSafeInteger(item.byteSize) && Number(item.byteSize) > 0 && Number(item.byteSize) <= 10 * 1024 * 1024;
}
