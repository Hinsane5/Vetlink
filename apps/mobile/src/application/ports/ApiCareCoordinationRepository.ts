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

export interface ApiReminder {
  id: string;
  animalId: string;
  consultationId: string | null;
  followUpId: string | null;
  ownerId: string;
  createdBy: string;
  kind: 'care' | 'follow_up';
  dueAt: string;
  instructions: string;
  careStatus: 'scheduled' | 'done';
  deliveryStatus: 'pending' | 'sent' | 'failed';
  completedAt: string | null;
  deliveryAttempt: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  deliveryOutcome?: { operationId: string; status: 'pending' | 'succeeded' | 'failed'; occurredAt: string };
  operationId?: string;
  replayed?: boolean;
}

export interface ApiCareCompletion {
  reminder: ApiReminder;
  healthEventId: string;
  operationId: string;
  replayed: boolean;
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
  listReminders(): Promise<ApiReminder[]>;
  createReminder(operation: CareApiOperation<{ animalId?: string; consultationId?: string; followUpId?: string; kind: 'care' | 'follow_up'; dueAt: string; instructions: string }>): Promise<ApiReminder>;
  retryReminderDelivery(reminderId: string, idempotencyKey: string): Promise<ApiReminder>;
  completeCare(reminderId: string, operation: CareApiOperation<{ confirmation: true }>): Promise<ApiCareCompletion>;
}
