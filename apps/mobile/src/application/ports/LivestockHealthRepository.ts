import type { FarmerReportKind, HealthRecordKind } from '../../domain/health';

export type ApiHealthEventProvenance = 'farmer_report' | 'clinical_note' | 'reminder';

/** Exact BE-03 timeline projection; it intentionally does not pretend to be a full UI note. */
export interface ApiHealthEvent {
  id: string;
  kind: HealthRecordKind;
  occurredAt: string;
  description: string;
  provenance: ApiHealthEventProvenance;
  createdAt: string;
}

export interface ApiCareEventInput {
  kind: FarmerReportKind;
  occurredAt: string;
  description: string;
  sourceKey: string;
}

/** POST care-events does not return createdAt, actorId, or note metadata. */
export interface ApiCareEvent {
  id: string;
  kind: FarmerReportKind;
  occurredAt: string;
  description: string;
  provenance: 'farmer_report';
}

export interface LivestockHealthReadRepository {
  listHealthEvents(livestockId: string): Promise<ApiHealthEvent[]>;
}

/** Peternak report writes; bearer role and owner checks stay authoritative on the API. */
export interface LivestockCareEventWriteRepository {
  createCareEvent(livestockId: string, input: ApiCareEventInput): Promise<ApiCareEvent>;
}
