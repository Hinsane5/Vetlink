import type { DirectoryServiceType } from '../../domain/directory';
import type { LivestockSpecies } from '../../domain/profiles';

export type ApiConsultationStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'requested'
  | 'scheduled'
  | 'reschedule_pending'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type ApiVisitStage = 'scheduled' | 'en_route' | 'arrived' | 'examining' | 'completed';

export interface ConsultationQuoteInput {
  vetId: string;
  animalId: string;
  serviceType: DirectoryServiceType;
  startsAt: string;
  complaint: string;
  /** Required for visit; omit for chat unless the server contract is extended. */
  addressId?: string;
}

export interface ConsultationCreateInput {
  quoteId: string;
}

/** Keep this same operation object intact when manually retrying an uncertain POST. */
export interface IdempotentApiOperation<TPayload> {
  readonly idempotencyKey: string;
  readonly payload: Readonly<TPayload>;
}

export interface ApiConsultationVisitAddressSnapshot {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: string | null;
  longitude: string | null;
}

export interface ApiConsultationQuote {
  id: string;
  quoteId: string;
  farmerId: string;
  vetId: string;
  animalId: string;
  serviceType: DirectoryServiceType;
  complaint: string;
  startsAt: string;
  endsAt: string;
  feeIdr: number;
  commissionIdr: number;
  amountIdr: number;
  currency: 'IDR';
  visitAddressSnapshot: ApiConsultationVisitAddressSnapshot | null;
  consumed: boolean;
}

export interface ApiConsultationRecord {
  id: string;
  displayCode: string;
  farmerId: string;
  vetId: string;
  animalId: string;
  animalCode: string;
  animalName: string;
  species: LivestockSpecies;
  serviceType: DirectoryServiceType;
  complaint: string;
  status: ApiConsultationStatus;
  startsAt: string;
  endsAt: string;
  /** Legacy PostgreSQL bigint string; retain the server representation. */
  feeIdr: string;
  /** Legacy PostgreSQL bigint string; retain the server representation. */
  commissionIdr: string;
  feeAmountIdr: number;
  commissionAmountIdr: number;
  visitAddressSnapshot: ApiConsultationVisitAddressSnapshot | null;
  completionAt: string | null;
  rejectionReason: string | null;
  refundStatus: 'none' | 'refund_needed';
  reschedulePreviousStatus: 'requested' | 'scheduled' | null;
  version: number;
  visitStage: ApiVisitStage | null;
  departureAt: string | null;
  arrivalAt: string | null;
  examinationStartedAt: string | null;
  visitCompletedAt: string | null;
  visitVersion: number | null;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'expired' | null;
}

export interface ApiConsultationListItem extends Omit<ApiConsultationRecord,
  'visitAddressSnapshot' | 'completionAt' | 'reschedulePreviousStatus' | 'departureAt' | 'arrivalAt'
  | 'examinationStartedAt' | 'visitCompletedAt' | 'visitVersion'> {
  /** List projection alias; detail uses completionAt. */
  completedAt: string | null;
}

export interface ApiConsultationScheduleProposal {
  id: string;
  previousStatus: 'requested' | 'scheduled';
  startsAt: string;
  endsAt: string;
  status: 'pending' | 'accepted' | 'declined' | 'superseded';
  respondedAt: string | null;
  version: number;
  createdAt: string;
}

export interface ApiConsultationActionAudit {
  id: string;
  actorId: string;
  actorRole: 'farmer' | 'vet';
  actionType: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromVisitStage: ApiVisitStage | null;
  toVisitStage: ApiVisitStage | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ApiConsultationDetail extends ApiConsultationRecord {
  proposals: ApiConsultationScheduleProposal[];
  actions: ApiConsultationActionAudit[];
}

export interface ApiConsultationActionResult {
  operationId: string;
  replayed: boolean;
  consultation: ApiConsultationRecord;
}

export type ConsultationListStatus = Exclude<ApiConsultationStatus, 'draft'>;

export interface ConsultationListQuery {
  status?: ConsultationListStatus;
}

export interface ApiConsultationVisit {
  consultationId: string;
  stage: ApiVisitStage;
  departureAt: string | null;
  arrivalAt: string | null;
  examinationStartedAt: string | null;
  /** Visit route alias; consultation detail uses visitCompletedAt. */
  completedAt: string | null;
  version: number;
  updatedAt: string;
}

/** Isolated BE-05 API repository; the server session supplies owner/assignment scope. */
export interface ApiConsultationRepository {
  createQuote(operation: IdempotentApiOperation<ConsultationQuoteInput>): Promise<ApiConsultationQuote>;
  create(operation: IdempotentApiOperation<ConsultationCreateInput>): Promise<ApiConsultationActionResult>;
  list(query?: ConsultationListQuery): Promise<ApiConsultationListItem[]>;
  getById(consultationId: string): Promise<ApiConsultationDetail>;
  getVisit(consultationId: string): Promise<ApiConsultationVisit>;
}
