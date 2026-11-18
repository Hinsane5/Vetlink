export interface ApiFarmerProfile {
  role: 'farmer';
  userId: string;
  fullName: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ApiVetProfile extends Omit<ApiFarmerProfile, 'role'> {
  role: 'vet';
  professionalName: string | null;
  registrationReference: string | null;
  verificationStatus: 'not_submitted' | 'pending' | 'revision_required' | 'verified';
}

export interface ApiVerificationSubmission {
  id: string;
  documentIds: string[];
  status: 'pending' | 'revision_required' | 'verified';
  reviewerReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  version: number;
}

export interface ApiProfessionalDocumentFile {
  uri: string;
  filename: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
}

export interface ApiProfessionalDocument {
  id: string;
  filename: string;
  mimeType: ApiProfessionalDocumentFile['mimeType'];
  byteSize: number;
}

export interface ApiProfileRepository {
  getFarmer(): Promise<ApiFarmerProfile>;
  patchFarmer(input: { fullName: string }): Promise<ApiFarmerProfile>;
  getVet(): Promise<ApiVetProfile>;
  patchVet(input: { fullName?: string; professionalName?: string; registrationReference?: string }): Promise<ApiVetProfile>;
  listVerification(): Promise<ApiVerificationSubmission[]>;
  /** Reuse the same key and exact file after an uncertain response. */
  uploadProfessionalDocument(file: ApiProfessionalDocumentFile, idempotencyKey: string): Promise<ApiProfessionalDocument>;
  submitVerification(documentIds: string[]): Promise<ApiVerificationSubmission>;
}
