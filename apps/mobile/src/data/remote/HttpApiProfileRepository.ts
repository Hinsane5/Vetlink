import type { ApiFarmerProfile, ApiProfessionalDocument, ApiProfessionalDocumentFile, ApiProfileRepository, ApiVerificationSubmission, ApiVetProfile } from '../../application/ports/ApiProfileRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

/** BE-02 profile projection; raw profile and submission writes still use PostgreSQL field names. */
export class HttpApiProfileRepository implements ApiProfileRepository {
  constructor(private readonly api: ApiClient) {}

  async getFarmer(): Promise<ApiFarmerProfile> {
    return parseFarmer(await this.api.request<unknown>('/v1/me/farmer'));
  }

  async patchFarmer(input: { fullName: string }): Promise<ApiFarmerProfile> {
    if (!isRecord(input) || !validName(input.fullName)) throw invalidQuery('Nama Peternak tidak valid.');
    return parseFarmer(await this.api.request<unknown>('/v1/me/farmer', {
      method: 'PATCH', body: { fullName: input.fullName },
    }));
  }

  async getVet(): Promise<ApiVetProfile> {
    return parseVet(await this.api.request<unknown>('/v1/me/vet'));
  }

  async patchVet(input: { fullName?: string; professionalName?: string; registrationReference?: string }): Promise<ApiVetProfile> {
    if (!isRecord(input)) throw invalidQuery('Perubahan profil Dokter tidak valid.');
    const body: Record<string, string> = {};
    for (const field of ['fullName', 'professionalName', 'registrationReference'] as const) {
      const value = input[field];
      if (value !== undefined) {
        if (field === 'fullName' ? !validName(value) : typeof value !== 'string' || value.length > 120)
          throw invalidQuery('Field profil Dokter tidak valid.');
        body[field] = value;
      }
    }
    if (Object.keys(body).length === 0) throw invalidQuery('Pilih field profil yang akan diubah.');
    return parseVet(await this.api.request<unknown>('/v1/me/vet', { method: 'PATCH', body }));
  }

  async listVerification(): Promise<ApiVerificationSubmission[]> {
    const value = await this.api.request<unknown>('/v1/me/vet/verification');
    if (!Array.isArray(value)) throw invalidResponse('Riwayat verifikasi tidak sesuai kontrak BE-02.');
    return value.map((item: unknown) => parseSubmission(item, false));
  }

  async uploadProfessionalDocument(file: ApiProfessionalDocumentFile): Promise<ApiProfessionalDocument> {
    if (!isRecord(file) || typeof file.uri !== 'string' || !/^(file|content):\/\//.test(file.uri)
      || !isNonEmptyText(file.filename, 255)
      || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)
      || !Number.isSafeInteger(file.byteSize) || file.byteSize < 1 || file.byteSize > 10 * 1024 * 1024) {
      throw invalidQuery('Dokumen profesi tidak sesuai jenis atau batas ukuran BE-02.');
    }
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.filename, type: file.mimeType } as unknown as Blob);
    const value = await this.api.uploadMultipart<unknown>('/v1/me/vet/professional-documents', form);
    if (!isRecord(value) || !isUuid(value.id) || !isNonEmptyText(value.filename, 255)
      || value.mimeType !== file.mimeType || value.byteSize !== file.byteSize) {
      throw invalidResponse('Dokumen profesi belum tersimpan sesuai kontrak BE-02.');
    }
    return { id: value.id, filename: value.filename, mimeType: value.mimeType as ApiProfessionalDocument['mimeType'], byteSize: value.byteSize };
  }

  async submitVerification(documentIds: string[]): Promise<ApiVerificationSubmission> {
    if (!Array.isArray(documentIds) || documentIds.length < 1 || documentIds.length > 5
      || !documentIds.every(isUuid) || new Set(documentIds).size !== documentIds.length)
      throw invalidQuery('Pengajuan memerlukan 1–5 dokumen UUID berbeda.');
    const result = parseSubmission(await this.api.request<unknown>('/v1/me/vet/verification-submissions', {
      method: 'POST', body: { documentIds: [...documentIds] },
    }), true);
    if (result.status !== 'pending' || result.documentIds.length !== documentIds.length
      || !documentIds.every((id) => result.documentIds.includes(id)))
      throw invalidResponse('Pengajuan verifikasi belum tersimpan sesuai dokumen.');
    return result;
  }
}

function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }
function nullableTime(value: unknown): value is string | null { return value === null || isIsoTimestampWithTimezone(value); }
function validName(value: unknown): value is string { return isNonEmptyText(value, 120); }

function parseBase(value: unknown): Omit<ApiFarmerProfile, 'role'> {
  if (!isRecord(value) || !isUuid(value.id) || value.user_id !== value.id
    || !validName(value.fullName) || !isIsoTimestampWithTimezone(value.created_at)
    || !isIsoTimestampWithTimezone(value.updated_at) || !positiveInt(value.version))
    throw invalidResponse('Profil tidak sesuai kontrak BE-02.');
  return { userId: value.id, fullName: value.fullName, createdAt: value.created_at,
    updatedAt: value.updated_at, version: value.version };
}

function parseFarmer(value: unknown): ApiFarmerProfile {
  return { ...parseBase(value), role: 'farmer' };
}

function parseVet(value: unknown): ApiVetProfile {
  const base = parseBase(value);
  if (!isRecord(value)
    || !(value.professional_name === null || (typeof value.professional_name === 'string' && value.professional_name.length <= 120))
    || !(value.registration_reference === null || (typeof value.registration_reference === 'string' && value.registration_reference.length <= 120))
    || (value.verification_status !== 'not_submitted' && value.verification_status !== 'pending'
      && value.verification_status !== 'revision_required' && value.verification_status !== 'verified'))
    throw invalidResponse('Profil Dokter tidak sesuai kontrak BE-02.');
  return { ...base, role: 'vet', professionalName: value.professional_name as string | null,
    registrationReference: value.registration_reference as string | null,
    verificationStatus: value.verification_status as ApiVetProfile['verificationStatus'] };
}

function parseSubmission(value: unknown, raw: boolean): ApiVerificationSubmission {
  if (!isRecord(value)) throw invalidResponse('Pengajuan verifikasi tidak valid.');
  const documentIds = raw ? value.document_ids : value.documentIds;
  const reviewerReason = raw ? value.reviewer_reason : value.reviewerReason;
  const submittedAt = raw ? value.submitted_at : value.submittedAt;
  const reviewedAt = raw ? value.reviewed_at : value.reviewedAt;
  if (!isUuid(value.id) || !Array.isArray(documentIds) || documentIds.length < 1 || documentIds.length > 5
    || !documentIds.every(isUuid) || new Set(documentIds).size !== documentIds.length
    || (value.status !== 'pending' && value.status !== 'revision_required' && value.status !== 'verified')
    || !(reviewerReason === null || (typeof reviewerReason === 'string' && reviewerReason.length <= 1000))
    || !isIsoTimestampWithTimezone(submittedAt) || !nullableTime(reviewedAt)
    || (value.status === 'pending' && reviewedAt !== null)
    || (value.status !== 'pending' && reviewedAt === null)
    || !positiveInt(value.version)) throw invalidResponse('Pengajuan verifikasi tidak sesuai kontrak BE-02.');
  return { id: value.id, documentIds, status: value.status, reviewerReason,
    submittedAt, reviewedAt, version: value.version };
}
