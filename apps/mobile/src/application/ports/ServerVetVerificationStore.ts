import type { ApiProfessionalDocument, ApiProfessionalDocumentFile } from './ApiProfileRepository';

export interface PendingVetDocumentUpload {
  file: ApiProfessionalDocumentFile;
  idempotencyKey: string;
}

export interface SelectedVetDocumentFile {
  uri: string;
  filename: string;
  mimeType: string;
  byteSize?: number | null;
}

/** Persists private selected bytes plus the exact BE-02 upload operation until reconciled. */
export interface ServerVetVerificationStore {
  copyToPrivateStorage(userId: string, file: SelectedVetDocumentFile): Promise<ApiProfessionalDocumentFile>;
  removePrivateFile(uri: string): Promise<void>;
  readPendingUpload(userId: string): Promise<PendingVetDocumentUpload | null>;
  writePendingUpload(userId: string, pending: PendingVetDocumentUpload): Promise<void>;
  clearPendingUpload(userId: string): Promise<void>;
  listUploaded(userId: string): Promise<ApiProfessionalDocument[]>;
  appendUploaded(userId: string, document: ApiProfessionalDocument): Promise<void>;
  clearUploaded(userId: string): Promise<void>;
}
