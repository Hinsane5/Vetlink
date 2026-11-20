import type { ApiMediaMimeType } from './ApiMediaRepository';

export interface ApiPatientMediaRecord {
  id: string;
  consultationId: string;
  recordId: string;
  source: 'message' | 'progress_report';
  kind: 'image' | 'video';
  mimeType: ApiMediaMimeType;
  filename: string;
  byteSize: number;
  url: string;
  createdAt: string;
}

/** Private media metadata for one patient assigned to the active veterinarian. */
export interface PatientMediaReadRepository {
  listForPatient(animalId: string): Promise<ApiPatientMediaRecord[]>;
}
