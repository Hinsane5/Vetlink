import type {
  ApiConsultationActionAudit,
  ApiConsultationActionResult,
  ApiConsultationDetail,
  ApiConsultationListItem,
  ApiConsultationQuote,
  ApiConsultationRecord,
  ApiConsultationRepository,
  ApiConsultationScheduleProposal,
  ApiConsultationVisit,
  ApiConsultationVisitAddressSnapshot,
  ConsultationCreateInput,
  ConsultationListQuery,
  ConsultationQuoteInput,
  IdempotentApiOperation,
} from '../../application/ports/ApiConsultationRepository';
import type { DirectoryServiceType } from '../../domain/directory';
import { livestockSpecies, type LivestockSpecies } from '../../domain/profiles';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const SERVICE_TYPES: readonly DirectoryServiceType[] = ['chat', 'visit'];
const CONSULTATION_STATUSES = [
  'draft', 'awaiting_payment', 'requested', 'scheduled', 'reschedule_pending',
  'in_progress', 'completed', 'rejected', 'cancelled',
] as const;
const LIST_STATUSES = CONSULTATION_STATUSES.filter((status) => status !== 'draft');
const VISIT_STAGES = ['scheduled', 'en_route', 'arrived', 'examining', 'completed'] as const;
const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'expired'] as const;
const DIGITS = /^\d+$/;
const ADDRESS_DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** BE-05 quote/create and owner/assignment-scoped read adapter. */
export class HttpApiConsultationRepository implements ApiConsultationRepository {
  constructor(private readonly api: ApiClient) {}

  async createQuote(operation: IdempotentApiOperation<ConsultationQuoteInput>): Promise<ApiConsultationQuote> {
    const { key, payload } = validateOperation(operation);
    const body = createQuotePayload(payload);
    return parseApiConsultationQuote(await this.api.request<unknown>('/v1/consultation-quotes', {
      method: 'POST', body, idempotencyKey: key,
    }));
  }

  async create(operation: IdempotentApiOperation<ConsultationCreateInput>): Promise<ApiConsultationActionResult> {
    const { key, payload } = validateOperation(operation);
    const body = createBookingPayload(payload);
    return parseApiConsultationActionResult(await this.api.request<unknown>('/v1/consultations', {
      method: 'POST', body, idempotencyKey: key,
    }));
  }

  async list(query: ConsultationListQuery = {}): Promise<ApiConsultationListItem[]> {
    const status = validateListStatus(query.status);
    const suffix = status === undefined ? '' : `?${new URLSearchParams({ status }).toString()}`;
    const value = await this.api.request<unknown>(`/v1/consultations${suffix}`);
    if (!Array.isArray(value)) throw invalidResponse('Daftar konsultasi server harus berupa array BE-16.');
    return value.map(parseApiConsultationListItem);
  }

  async getById(consultationId: string): Promise<ApiConsultationDetail> {
    const id = validateResourceId(consultationId, 'konsultasi');
    return parseApiConsultationDetail(await this.api.request<unknown>(`/v1/consultations/${encodeURIComponent(id)}`));
  }

  async getVisit(consultationId: string): Promise<ApiConsultationVisit> {
    const id = validateResourceId(consultationId, 'konsultasi');
    return parseApiConsultationVisit(await this.api.request<unknown>(`/v1/consultations/${encodeURIComponent(id)}/visit`));
  }
}

function validateOperation<TPayload>(operation: IdempotentApiOperation<TPayload>): { key: string; payload: TPayload } {
  if (!isRecord(operation) || typeof operation.idempotencyKey !== 'string'
    || operation.idempotencyKey.length < 8 || operation.idempotencyKey.length > 128
    || !isRecord(operation.payload)) {
    throw invalidQuery('Operasi konsultasi memerlukan Idempotency-Key 8–128 karakter dan payload.');
  }
  return { key: operation.idempotencyKey, payload: operation.payload as TPayload };
}

function createQuotePayload(input: ConsultationQuoteInput): Record<string, unknown> {
  if (!isRecord(input)) throw invalidQuery('Request quote konsultasi tidak valid.');
  const vetId = input.vetId;
  const animalId = input.animalId;
  if (!isUuid(vetId) || !isUuid(animalId)) throw invalidQuery('Quote konsultasi memerlukan ID Dokter dan ternak UUID.');
  if (!isService(input.serviceType)) throw invalidQuery('Layanan konsultasi harus chat atau visit.');
  if (!isIsoTimestampWithTimezone(input.startsAt)) {
    throw invalidQuery('Waktu mulai konsultasi harus berupa ISO-8601 dengan zona waktu.');
  }
  if (typeof input.complaint !== 'string' || input.complaint.trim().length < 1 || input.complaint.length > 4000) {
    throw invalidQuery('Keluhan harus berisi 1 sampai 4.000 karakter.');
  }
  const body: Record<string, unknown> = {
    vetId,
    animalId,
    serviceType: input.serviceType,
    startsAt: input.startsAt,
    complaint: input.complaint,
  };
  if (input.addressId !== undefined) {
    if (!isUuid(input.addressId)) throw invalidQuery('Alamat kunjungan harus menggunakan ID server UUID.');
    body.addressId = input.addressId;
  } else if (input.serviceType === 'visit') {
    throw invalidQuery('Layanan kunjungan memerlukan alamat yang dipilih secara eksplisit.');
  }
  return body;
}

function createBookingPayload(input: ConsultationCreateInput): Record<string, unknown> {
  if (!isRecord(input) || !isUuid(input.quoteId)) throw invalidQuery('Booking konsultasi memerlukan quoteId server UUID.');
  return { quoteId: input.quoteId };
}

function validateListStatus(value: ConsultationListQuery['status']): ConsultationListQuery['status'] {
  if (value !== undefined && !(LIST_STATUSES as readonly string[]).includes(value)) {
    throw invalidQuery('Status filter konsultasi tidak valid.');
  }
  return value;
}

function validateResourceId(value: string, label: string): string {
  if (!isUuid(value)) throw invalidQuery(`ID ${label} server harus UUID.`);
  return value;
}

export function parseApiConsultationQuote(value: unknown): ApiConsultationQuote {
  if (!isRecord(value)
    || !isUuid(value.id) || !isUuid(value.quoteId) || value.id !== value.quoteId
    || !isUuid(value.farmerId) || !isUuid(value.vetId) || !isUuid(value.animalId)
    || !isService(value.serviceType) || !isComplaint(value.complaint)
    || !isIsoTimestampWithTimezone(value.startsAt) || !isIsoTimestampWithTimezone(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || !isSafeIdr(value.feeIdr) || !isSafeIdr(value.commissionIdr) || !isSafeIdr(value.amountIdr)
    || value.amountIdr !== value.feeIdr
    || value.currency !== 'IDR'
    || typeof value.consumed !== 'boolean') {
    throw invalidResponse('Quote konsultasi server tidak sesuai ConsultationQuoteResponseDto BE-16.');
  }
  const address = parseAddressSnapshot(value.visitAddressSnapshot);
  if ((value.serviceType === 'chat' && address !== null) || (value.serviceType === 'visit' && address === null)) {
    throw invalidResponse('Snapshot alamat quote harus null untuk chat dan tersedia untuk visit.');
  }
  return {
    id: value.id,
    quoteId: value.quoteId,
    farmerId: value.farmerId,
    vetId: value.vetId,
    animalId: value.animalId,
    serviceType: value.serviceType,
    complaint: value.complaint,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    feeIdr: value.feeIdr,
    commissionIdr: value.commissionIdr,
    amountIdr: value.amountIdr,
    currency: 'IDR',
    visitAddressSnapshot: address,
    consumed: value.consumed,
  };
}

export function parseApiConsultationRecord(value: unknown): ApiConsultationRecord {
  if (!isRecord(value)
    || !isUuid(value.id) || !isNonBlankText(value.displayCode)
    || !isUuid(value.farmerId) || !isUuid(value.vetId) || !isUuid(value.animalId)
    || !isNonBlankText(value.animalCode) || !isNonBlankText(value.animalName)
    || !isLivestockSpecies(value.species) || !isService(value.serviceType)
    || !isComplaint(value.complaint) || !isConsultationStatus(value.status)
    || !isIsoTimestampWithTimezone(value.startsAt) || !isIsoTimestampWithTimezone(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || !isBigintString(value.feeIdr) || !isBigintString(value.commissionIdr)
    || !isSafeIdr(value.feeAmountIdr) || !isSafeIdr(value.commissionAmountIdr)
    || !bigintMatches(value.feeIdr, value.feeAmountIdr)
    || !bigintMatches(value.commissionIdr, value.commissionAmountIdr)
    || !(value.completionAt === null || isIsoTimestampWithTimezone(value.completionAt))
    || !(value.rejectionReason === null || isNonEmptyText(value.rejectionReason, 500))
    || !isOneOf(value.refundStatus, ['none', 'refund_needed'])
    || !(value.reschedulePreviousStatus === null || isOneOf(value.reschedulePreviousStatus, ['requested', 'scheduled']))
    || !isPositiveSafeInteger(value.version)
    || !(value.visitStage === null || isVisitStage(value.visitStage))
    || !isNullableTimestamp(value.departureAt) || !isNullableTimestamp(value.arrivalAt)
    || !isNullableTimestamp(value.examinationStartedAt) || !isNullableTimestamp(value.visitCompletedAt)
    || !(value.visitVersion === null || isPositiveSafeInteger(value.visitVersion))
    || !(value.paymentStatus === null || isOneOf(value.paymentStatus, PAYMENT_STATUSES))) {
    throw invalidResponse('Konsultasi server tidak sesuai ConsultationResponseDto BE-16.');
  }
  const address = parseAddressSnapshot(value.visitAddressSnapshot);
  if ((value.serviceType === 'chat' && address !== null) || (value.serviceType === 'visit' && address === null)) {
    throw invalidResponse('Snapshot alamat konsultasi harus null untuk chat dan tersedia untuk visit.');
  }
  return {
    id: value.id,
    displayCode: value.displayCode,
    farmerId: value.farmerId,
    vetId: value.vetId,
    animalId: value.animalId,
    animalCode: value.animalCode,
    animalName: value.animalName,
    species: value.species as LivestockSpecies,
    serviceType: value.serviceType,
    complaint: value.complaint,
    status: value.status,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    feeIdr: value.feeIdr,
    commissionIdr: value.commissionIdr,
    feeAmountIdr: value.feeAmountIdr,
    commissionAmountIdr: value.commissionAmountIdr,
    visitAddressSnapshot: address,
    completionAt: value.completionAt as string | null,
    rejectionReason: value.rejectionReason as string | null,
    refundStatus: value.refundStatus as 'none' | 'refund_needed',
    reschedulePreviousStatus: value.reschedulePreviousStatus as 'requested' | 'scheduled' | null,
    version: value.version,
    visitStage: value.visitStage as ApiConsultationRecord['visitStage'],
    departureAt: value.departureAt as string | null,
    arrivalAt: value.arrivalAt as string | null,
    examinationStartedAt: value.examinationStartedAt as string | null,
    visitCompletedAt: value.visitCompletedAt as string | null,
    visitVersion: value.visitVersion as number | null,
    paymentStatus: value.paymentStatus as ApiConsultationRecord['paymentStatus'],
  };
}

export function parseApiConsultationListItem(value: unknown): ApiConsultationListItem {
  if (!isRecord(value)
    || !isUuid(value.id) || !isNonBlankText(value.displayCode)
    || !isUuid(value.farmerId) || !isUuid(value.vetId) || !isUuid(value.animalId)
    || !isNonBlankText(value.animalCode) || !isNonBlankText(value.animalName)
    || !isLivestockSpecies(value.species) || !isService(value.serviceType)
    || !isComplaint(value.complaint) || !isConsultationStatus(value.status)
    || !isIsoTimestampWithTimezone(value.startsAt) || !isIsoTimestampWithTimezone(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || !isBigintString(value.feeIdr) || !isBigintString(value.commissionIdr)
    || !isSafeIdr(value.feeAmountIdr) || !isSafeIdr(value.commissionAmountIdr)
    || !bigintMatches(value.feeIdr, value.feeAmountIdr)
    || !bigintMatches(value.commissionIdr, value.commissionAmountIdr)
    || !isOneOf(value.refundStatus, ['none', 'refund_needed'])
    || !(value.completedAt === null || isIsoTimestampWithTimezone(value.completedAt))
    || !(value.rejectionReason === null || isNonEmptyText(value.rejectionReason, 500))
    || !isPositiveSafeInteger(value.version)
    || !(value.visitStage === null || isVisitStage(value.visitStage))
    || !(value.paymentStatus === null || isOneOf(value.paymentStatus, PAYMENT_STATUSES))) {
    throw invalidResponse('Item daftar konsultasi server tidak sesuai ConsultationListItemResponseDto BE-16.');
  }
  return {
    id: value.id,
    displayCode: value.displayCode,
    farmerId: value.farmerId,
    vetId: value.vetId,
    animalId: value.animalId,
    animalCode: value.animalCode,
    animalName: value.animalName,
    species: value.species as LivestockSpecies,
    serviceType: value.serviceType,
    complaint: value.complaint,
    status: value.status,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    feeIdr: value.feeIdr,
    commissionIdr: value.commissionIdr,
    feeAmountIdr: value.feeAmountIdr,
    commissionAmountIdr: value.commissionAmountIdr,
    refundStatus: value.refundStatus as ApiConsultationListItem['refundStatus'],
    completedAt: value.completedAt as string | null,
    rejectionReason: value.rejectionReason as string | null,
    version: value.version,
    visitStage: value.visitStage as ApiConsultationListItem['visitStage'],
    paymentStatus: value.paymentStatus as ApiConsultationListItem['paymentStatus'],
  };
}

export function parseApiConsultationDetail(value: unknown): ApiConsultationDetail {
  if (!isRecord(value) || !Array.isArray(value.proposals) || !Array.isArray(value.actions)) {
    throw invalidResponse('Detail konsultasi server tidak memiliki proposals/actions sesuai DTO BE-16.');
  }
  const record = parseApiConsultationRecord(value);
  return {
    ...record,
    proposals: value.proposals.map(parseProposal),
    actions: value.actions.map(parseActionAudit),
  };
}

export function parseApiConsultationActionResult(value: unknown): ApiConsultationActionResult {
  if (!isRecord(value) || !isUuid(value.operationId) || typeof value.replayed !== 'boolean') {
    throw invalidResponse('Hasil booking konsultasi tidak sesuai ConsultationActionResponseDto BE-16.');
  }
  return { operationId: value.operationId, replayed: value.replayed, consultation: parseApiConsultationRecord(value.consultation) };
}

export function parseApiConsultationVisit(value: unknown): ApiConsultationVisit {
  if (!isRecord(value)
    || !isUuid(value.consultationId) || !isVisitStage(value.stage)
    || !isNullableTimestamp(value.departureAt) || !isNullableTimestamp(value.arrivalAt)
    || !isNullableTimestamp(value.examinationStartedAt) || !isNullableTimestamp(value.completedAt)
    || !isPositiveSafeInteger(value.version) || !isIsoTimestampWithTimezone(value.updatedAt)) {
    throw invalidResponse('Visit server tidak sesuai ConsultationVisitResponseDto BE-16.');
  }
  return {
    consultationId: value.consultationId,
    stage: value.stage,
    departureAt: value.departureAt as string | null,
    arrivalAt: value.arrivalAt as string | null,
    examinationStartedAt: value.examinationStartedAt as string | null,
    completedAt: value.completedAt as string | null,
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function parseProposal(value: unknown): ApiConsultationScheduleProposal {
  if (!isRecord(value) || !isUuid(value.id)
    || !isOneOf(value.previousStatus, ['requested', 'scheduled'])
    || !isIsoTimestampWithTimezone(value.startsAt) || !isIsoTimestampWithTimezone(value.endsAt)
    || Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    || !isOneOf(value.status, ['pending', 'accepted', 'declined', 'superseded'])
    || !isNullableTimestamp(value.respondedAt) || !isPositiveSafeInteger(value.version)
    || !isIsoTimestampWithTimezone(value.createdAt)) {
    throw invalidResponse('Proposal jadwal konsultasi tidak sesuai DTO BE-16.');
  }
  return {
    id: value.id,
    previousStatus: value.previousStatus as ApiConsultationScheduleProposal['previousStatus'],
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    status: value.status as ApiConsultationScheduleProposal['status'],
    respondedAt: value.respondedAt as string | null,
    version: value.version,
    createdAt: value.createdAt,
  };
}

function parseActionAudit(value: unknown): ApiConsultationActionAudit {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.actorId)
    || !isOneOf(value.actorRole, ['farmer', 'vet']) || !isNonBlankText(value.actionType)
    || !(value.fromStatus === null || typeof value.fromStatus === 'string')
    || !(value.toStatus === null || typeof value.toStatus === 'string')
    || !(value.fromVisitStage === null || isVisitStage(value.fromVisitStage))
    || !(value.toVisitStage === null || isVisitStage(value.toVisitStage))
    || !isRecord(value.details) || !isIsoTimestampWithTimezone(value.createdAt)) {
    throw invalidResponse('Audit action konsultasi tidak sesuai DTO BE-16.');
  }
  return {
    id: value.id,
    actorId: value.actorId,
    actorRole: value.actorRole as ApiConsultationActionAudit['actorRole'],
    actionType: value.actionType,
    fromStatus: value.fromStatus as string | null,
    toStatus: value.toStatus as string | null,
    fromVisitStage: value.fromVisitStage as ApiConsultationActionAudit['fromVisitStage'],
    toVisitStage: value.toVisitStage as ApiConsultationActionAudit['toVisitStage'],
    details: value.details,
    createdAt: value.createdAt,
  };
}

function parseAddressSnapshot(value: unknown): ApiConsultationVisitAddressSnapshot | null {
  if (value === null) return null;
  if (!isRecord(value) || !isUuid(value.id)
    || !isText(value.label) || !isText(value.recipientName) || !isText(value.phone)
    || !isText(value.addressLine) || !isText(value.city) || !isText(value.province)
    || !isText(value.postalCode)
    || !isNullableDecimal(value.latitude) || !isNullableDecimal(value.longitude)
    || ((value.latitude === null) !== (value.longitude === null))) {
    throw invalidResponse('Snapshot alamat konsultasi tidak sesuai ConsultationVisitAddressSnapshotResponseDto BE-16.');
  }
  return {
    id: value.id,
    label: value.label,
    recipientName: value.recipientName,
    phone: value.phone,
    addressLine: value.addressLine,
    city: value.city,
    province: value.province,
    postalCode: value.postalCode,
    latitude: value.latitude as string | null,
    longitude: value.longitude as string | null,
  };
}

function isNullableDecimal(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && ADDRESS_DECIMAL.test(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestampWithTimezone(value);
}

function isComplaint(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 4000;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonBlankText(value: unknown): value is string {
  return isText(value) && value.trim().length > 0;
}

function isSafeIdr(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBigintString(value: unknown): value is string {
  return typeof value === 'string' && DIGITS.test(value);
}

function bigintMatches(value: string, amount: number): boolean {
  return BigInt(value) === BigInt(amount);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isService(value: unknown): value is DirectoryServiceType {
  return typeof value === 'string' && (SERVICE_TYPES as readonly string[]).includes(value);
}

function isConsultationStatus(value: unknown): value is ApiConsultationRecord['status'] {
  return typeof value === 'string' && (CONSULTATION_STATUSES as readonly string[]).includes(value);
}

function isVisitStage(value: unknown): value is NonNullable<ApiConsultationRecord['visitStage']> {
  return typeof value === 'string' && (VISIT_STAGES as readonly string[]).includes(value);
}

function isLivestockSpecies(value: unknown): value is LivestockSpecies {
  return typeof value === 'string' && (livestockSpecies as readonly string[]).includes(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
