import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiProfessionalDocument, ApiProfileRepository, ApiVerificationSubmission } from './ports/ApiProfileRepository';
import type { PendingVetDocumentUpload, SelectedVetDocumentFile, ServerVetVerificationStore } from './ports/ServerVetVerificationStore';

const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const maximumBytes = 10 * 1024 * 1024;

export class ServerVetVerificationService {
  constructor(
    private readonly profiles: ApiProfileRepository,
    private readonly store: ServerVetVerificationStore,
    private readonly createId: () => string,
  ) {}

  async listUploaded(role: AccountRole, userId: string): Promise<ApiProfessionalDocument[]> {
    this.requireVet(role);
    const [profile, submissions, documents] = await Promise.all([
      this.profiles.getVet(), this.profiles.listVerification(), this.store.listUploaded(userId),
    ]);
    const latest = submissions[0];
    if (profile.verificationStatus === 'pending' && latest?.status === 'pending'
      && documents.length > 0 && documents.every((document) => latest.documentIds.includes(document.id))) {
      await this.store.clearUploaded(userId);
      return [];
    }
    return documents;
  }

  async getPendingUpload(role: AccountRole, userId: string): Promise<PendingVetDocumentUpload | null> {
    this.requireVet(role);
    return this.store.readPendingUpload(userId);
  }

  async upload(role: AccountRole, userId: string, selectedFile?: SelectedVetDocumentFile): Promise<ApiProfessionalDocument> {
    this.requireVet(role);
    const profile = await this.profiles.getVet();
    if (profile.verificationStatus === 'pending' || profile.verificationStatus === 'verified')
      throw new DomainError('INVALID_STATE', 'Dokumen verifikasi tidak dapat diubah selama status menunggu atau sudah terverifikasi.');
    let pending = await this.store.readPendingUpload(userId);
    if (pending && selectedFile) throw new DomainError('INVALID_STATE', 'Coba ulang dokumen tertunda sebelum memilih file lain.');
    if (!pending) {
      if (!selectedFile) throw new DomainError('NOT_FOUND', 'Pilih dokumen sebelum mengunggah.');
      validateFile(selectedFile);
      const existing = await this.store.listUploaded(userId);
      if (existing.length >= 5) throw new DomainError('VALIDATION_FAILED', 'Maksimal lima dokumen dapat diajukan.');
      const key = this.createId();
      if (!isUuid(key)) throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci upload tidak valid.');
      const privateFile = await this.store.copyToPrivateStorage(userId, selectedFile);
      pending = { file: privateFile, idempotencyKey: key };
      try { await this.store.writePendingUpload(userId, pending); }
      catch (cause) { await this.store.removePrivateFile(privateFile.uri); throw cause; }
    }
    const current = await this.store.listUploaded(userId);
    // A previous attempt may have reached the server and been staged locally
    // before SecureStore cleanup failed. Let the same pending operation replay;
    // appendUploaded deduplicates the returned document ID.
    if (!pending && current.length >= 5) throw new DomainError('VALIDATION_FAILED', 'Maksimal lima dokumen dapat diajukan.');
    let document: ApiProfessionalDocument;
    try {
      document = await this.profiles.uploadProfessionalDocument(pending.file, pending.idempotencyKey);
    } catch (cause) {
      // A server validation/authorization response is definitive. Release the
      // staged operation so the user can choose a corrected document. Keep it
      // for network, server, session, and malformed-response failures, which
      // may have committed and must be retried with the exact same bytes/key.
      if (cause instanceof DomainError && [
        'FORBIDDEN', 'INVALID_STATE', 'VALIDATION_FAILED', 'VERSION_CONFLICT', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT',
      ].includes(cause.code)) {
        await this.store.clearPendingUpload(userId);
        await this.store.removePrivateFile(pending.file.uri);
      }
      throw cause;
    }
    if (document.filename !== pending.file.filename || document.mimeType !== pending.file.mimeType || document.byteSize !== pending.file.byteSize)
      throw new DomainError('API_RESPONSE_INVALID', 'Dokumen server tidak cocok dengan file yang dipilih.');
    await this.store.appendUploaded(userId, document);
    await this.store.clearPendingUpload(userId);
    await this.store.removePrivateFile(pending.file.uri);
    return document;
  }

  async submit(role: AccountRole, userId: string): Promise<ApiVerificationSubmission> {
    this.requireVet(role);
    const profile = await this.profiles.getVet();
    if (profile.verificationStatus === 'pending' || profile.verificationStatus === 'verified')
      throw new DomainError('INVALID_STATE', 'Pengajuan baru tidak tersedia selama status menunggu atau sudah terverifikasi.');
    if (await this.store.readPendingUpload(userId))
      throw new DomainError('INVALID_STATE', 'Selesaikan atau pulihkan unggahan dokumen yang tertunda terlebih dahulu.');
    const documents = await this.store.listUploaded(userId);
    if (documents.length < 1 || documents.length > 5) throw new DomainError('VALIDATION_FAILED', 'Pilih 1–5 dokumen yang sudah diunggah.');
    const submission = await this.profiles.submitVerification(documents.map((document) => document.id));
    if (submission.status !== 'pending' || documents.some((document) => !submission.documentIds.includes(document.id)))
      throw new DomainError('API_RESPONSE_INVALID', 'Pengajuan belum tersimpan sesuai dokumen yang dipilih.');
    await this.store.clearUploaded(userId);
    return submission;
  }

  private requireVet(role: AccountRole): void {
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter dapat mengelola verifikasi profesi.');
  }
}

function validateFile(file: SelectedVetDocumentFile): void {
  if (!file || typeof file.uri !== 'string' || !/^(file|content):\/\//.test(file.uri)
    || typeof file.filename !== 'string' || !file.filename.trim() || file.filename.length > 255
    || !allowedTypes.includes(file.mimeType as (typeof allowedTypes)[number])
    || (file.byteSize != null && (!Number.isSafeInteger(file.byteSize) || file.byteSize < 1 || file.byteSize > maximumBytes)))
    throw new DomainError('VALIDATION_FAILED', 'Pilih PDF/JPEG/PNG/WebP hingga 10 MiB.');
}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
