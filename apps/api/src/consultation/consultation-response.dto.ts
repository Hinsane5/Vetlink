import { ApiProperty } from '@nestjs/swagger';

const idr = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  description: 'Integer rupiah; nilainya harus berada dalam rentang safe integer JavaScript.',
} as const;

const consultationStatuses = [
  'draft', 'awaiting_payment', 'requested', 'scheduled', 'reschedule_pending',
  'in_progress', 'completed', 'rejected', 'cancelled',
] as const;
const visitStages = ['scheduled', 'en_route', 'arrived', 'examining', 'completed'] as const;

/** Immutable address fields copied from the selected farmer address into a visit quote. */
export class ConsultationVisitAddressSnapshotResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty() city!: string;
  @ApiProperty() province!: string;
  @ApiProperty() postalCode!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Koordinat decimal PostgreSQL dikembalikan sebagai string.' }) latitude!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Koordinat decimal PostgreSQL dikembalikan sebagai string.' }) longitude!: string | null;
}

export class ConsultationQuoteResponseDto {
  @ApiProperty({ format: 'uuid', description: 'ID quote; sama dengan quoteId untuk kompatibilitas client.' }) id!: string;
  @ApiProperty({ format: 'uuid' }) quoteId!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) vetId!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty({ enum: ['chat', 'visit'] }) serviceType!: 'chat' | 'visit';
  @ApiProperty() complaint!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;
  @ApiProperty(idr) feeIdr!: number;
  @ApiProperty(idr) commissionIdr!: number;
  @ApiProperty({ ...idr, description: 'Nominal yang dibayarkan sesuai snapshot server; saat ini sama dengan feeIdr.' }) amountIdr!: number;
  @ApiProperty({ enum: ['IDR'] }) currency!: 'IDR';
  @ApiProperty({ type: ConsultationVisitAddressSnapshotResponseDto, nullable: true, description: 'Null untuk layanan chat; snapshot alamat untuk visit.' }) visitAddressSnapshot!: ConsultationVisitAddressSnapshotResponseDto | null;
  @ApiProperty() consumed!: boolean;
}

/** Shared service projection returned by create/actions and embedded in detail. */
export class ConsultationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayCode!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) vetId!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty() animalCode!: string;
  @ApiProperty() animalName!: string;
  @ApiProperty({ description: 'Nilai species mengikuti domain ternak.' }) species!: string;
  @ApiProperty({ enum: ['chat', 'visit'] }) serviceType!: 'chat' | 'visit';
  @ApiProperty() complaint!: string;
  @ApiProperty({ enum: consultationStatuses }) status!: (typeof consultationStatuses)[number];
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;
  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Representasi bigint PostgreSQL yang dipertahankan untuk kompatibilitas; gunakan feeAmountIdr untuk nominal safe integer.' }) feeIdr!: string;
  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Representasi bigint PostgreSQL yang dipertahankan untuk kompatibilitas; gunakan commissionAmountIdr untuk nominal safe integer.' }) commissionIdr!: string;
  @ApiProperty(idr) feeAmountIdr!: number;
  @ApiProperty(idr) commissionAmountIdr!: number;
  @ApiProperty({ type: ConsultationVisitAddressSnapshotResponseDto, nullable: true }) visitAddressSnapshot!: ConsultationVisitAddressSnapshotResponseDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Waktu selesai Consultation; berbeda dari visitCompletedAt.' }) completionAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ enum: ['none', 'refund_needed'] }) refundStatus!: 'none' | 'refund_needed';
  @ApiProperty({ enum: ['requested', 'scheduled'], nullable: true }) reschedulePreviousStatus!: 'requested' | 'scheduled' | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ enum: visitStages, nullable: true, description: 'Null jika belum ada record Visit atau layanan berupa chat.' }) visitStage!: (typeof visitStages)[number] | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) departureAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) arrivalAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) examinationStartedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Waktu selesai Visit; berbeda dari completionAt.' }) visitCompletedAt!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1, nullable: true }) visitVersion!: number | null;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed', 'expired'], nullable: true }) paymentStatus!: 'pending' | 'succeeded' | 'failed' | 'expired' | null;
}

export class ConsultationListItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayCode!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) vetId!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty() animalCode!: string;
  @ApiProperty() animalName!: string;
  @ApiProperty({ description: 'Nilai species mengikuti domain ternak.' }) species!: string;
  @ApiProperty({ enum: ['chat', 'visit'] }) serviceType!: 'chat' | 'visit';
  @ApiProperty() complaint!: string;
  @ApiProperty({ enum: consultationStatuses }) status!: (typeof consultationStatuses)[number];
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;
  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Representasi bigint PostgreSQL yang dipertahankan untuk kompatibilitas; gunakan feeAmountIdr untuk nominal safe integer.' }) feeIdr!: string;
  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Representasi bigint PostgreSQL yang dipertahankan untuk kompatibilitas; gunakan commissionAmountIdr untuk nominal safe integer.' }) commissionIdr!: string;
  @ApiProperty(idr) feeAmountIdr!: number;
  @ApiProperty(idr) commissionAmountIdr!: number;
  @ApiProperty({ enum: ['none', 'refund_needed'] }) refundStatus!: 'none' | 'refund_needed';
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Alias completion_at pada proyeksi daftar; proyeksi detail memakai completionAt.' }) completedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ enum: visitStages, nullable: true }) visitStage!: (typeof visitStages)[number] | null;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed', 'expired'], nullable: true }) paymentStatus!: 'pending' | 'succeeded' | 'failed' | 'expired' | null;
}

export class ConsultationScheduleProposalResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['requested', 'scheduled'] }) previousStatus!: 'requested' | 'scheduled';
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: string;
  @ApiProperty({ enum: ['pending', 'accepted', 'declined', 'superseded'] }) status!: 'pending' | 'accepted' | 'declined' | 'superseded';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondedAt!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ConsultationActionAuditResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty({ enum: ['farmer', 'vet'] }) actorRole!: 'farmer' | 'vet';
  @ApiProperty() actionType!: string;
  @ApiProperty({ type: String, nullable: true }) fromStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) toStatus!: string | null;
  @ApiProperty({ enum: visitStages, nullable: true }) fromVisitStage!: (typeof visitStages)[number] | null;
  @ApiProperty({ enum: visitStages, nullable: true }) toVisitStage!: (typeof visitStages)[number] | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) details!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ConsultationDetailResponseDto extends ConsultationResponseDto {
  @ApiProperty({ type: [ConsultationScheduleProposalResponseDto], description: 'Proposal jadwal berurutan berdasarkan waktu dibuat.' }) proposals!: ConsultationScheduleProposalResponseDto[];
  @ApiProperty({ type: [ConsultationActionAuditResponseDto], description: 'Audit action berurutan berdasarkan waktu dan ID.' }) actions!: ConsultationActionAuditResponseDto[];
}

export class ConsultationVisitResponseDto {
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty({ enum: visitStages }) stage!: (typeof visitStages)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) departureAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) arrivalAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) examinationStartedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

/** Visit projection included in transition actions; it does not include updatedAt. */
export class ConsultationVisitActionStateResponseDto {
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty({ enum: visitStages }) stage!: (typeof visitStages)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) departureAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) arrivalAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) examinationStartedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class ConsultationActionResponseDto {
  @ApiProperty({ format: 'uuid', description: 'ID action audit yang sudah disimpan.' }) operationId!: string;
  @ApiProperty({ description: 'True jika hasil mengulang operasi idempoten yang tersimpan sebelumnya.' }) replayed!: boolean;
  @ApiProperty({ type: ConsultationResponseDto }) consultation!: ConsultationResponseDto;
}

export class ConsultationScheduleProposalActionResponseDto extends ConsultationActionResponseDto {
  @ApiProperty({ format: 'uuid' }) proposalId!: string;
}

export class ConsultationScheduleProposalDecisionResponseDto extends ConsultationActionResponseDto {
  @ApiProperty({ enum: ['accept', 'decline'] }) decision!: 'accept' | 'decline';
}

export class ConsultationVisitActionResponseDto extends ConsultationActionResponseDto {
  @ApiProperty({ type: ConsultationVisitActionStateResponseDto }) visit!: ConsultationVisitActionStateResponseDto;
}
