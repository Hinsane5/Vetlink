export interface ApiFollowUp {
  id: string;
  consultationId: string;
  farmerId: string;
  vetId: string;
  animalId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  kind: 'recheck';
  status: 'scheduled' | 'completed' | 'cancelled';
  reason: string;
  followUpConsultationId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  operationId?: string;
  replayed?: boolean;
}

export interface ApiProgressReport {
  id: string;
  consultationId: string;
  followUpId: string;
  farmerId: string;
  vetId: string;
  animalId: string;
  text: string;
  attachmentIds: string[];
  submittedAt: string;
  viewedAt: string | null;
  operationId?: string;
  replayed?: boolean;
}

export interface CareApiOperation<T> {
  idempotencyKey: string;
  payload: T;
}

export interface ApiCareCoordinationRepository {
  listFollowUps(consultationId: string): Promise<ApiFollowUp[]>;
  createFollowUp(consultationId: string, operation: CareApiOperation<{ startsAt: string; endsAt: string; reason: string }>): Promise<ApiFollowUp>;
  cancelFollowUp(followUpId: string, operation: CareApiOperation<{ expectedVersion: number }>): Promise<ApiFollowUp>;
  listProgressReports(followUpId: string): Promise<ApiProgressReport[]>;
  createProgressReport(followUpId: string, operation: CareApiOperation<{ text: string; attachmentIds?: string[] }>): Promise<ApiProgressReport>;
}
