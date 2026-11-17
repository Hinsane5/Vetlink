import { ApiProperty } from '@nestjs/swagger';

const livestockHealthEventKinds = ['examination', 'disease', 'vaccine', 'medication', 'care'] as const;
const livestockHealthEventProvenance = ['farmer_report', 'clinical_note', 'reminder'] as const;

/** Patient projection returned by GET /patients for the authenticated assigned veterinarian. */
export class PatientResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 32 }) displayCode!: string;
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty({ maxLength: 80 }) species!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 80 }) breed!: string | null;
  @ApiProperty({ enum: ['female', 'male', 'unknown'] }) sex!: 'female' | 'male' | 'unknown';
  @ApiProperty({ type: String, format: 'date', nullable: true }) birthDate!: string | null;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 1200, nullable: true }) estimatedAgeMonths!: number | null;
  @ApiProperty({ type: String, nullable: true, pattern: '^\\d+(\\.\\d{1,2})?$', description: 'Nilai decimal PostgreSQL sebagai string presisi.' }) weightKg!: string | null;
  @ApiProperty({ format: 'uuid' }) farmId!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ maxLength: 120, description: 'Nama tampilan pemilik; tidak menyertakan email atau kontak.' }) ownerName!: string;
  @ApiProperty({ type: String, format: 'date-time', description: 'Waktu terbaru dari konsultasi Dokter yang ditugaskan.' }) lastServiceAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1, description: 'Jumlah konsultasi Dokter yang ditugaskan selain draft dan awaiting_payment.' }) serviceCount!: number;
  @ApiProperty({ enum: ['chat', 'visit'], description: 'Jenis layanan terkait yang diprioritaskan untuk label pasien.' }) latestServiceType!: 'chat' | 'visit';
  @ApiProperty({ enum: ['requested', 'scheduled', 'reschedule_pending', 'in_progress', 'en_route', 'arrived', 'examining', 'completed', 'rejected', 'cancelled'], description: 'Status konsultasi atau tahap kunjungan terkait yang diprioritaskan.' }) latestServiceStatus!: string;
}

/** Public timeline projection; drafts and private actor/note metadata are excluded. */
export class LivestockHealthEventResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: livestockHealthEventKinds }) kind!: (typeof livestockHealthEventKinds)[number];
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 }) description!: string;
  @ApiProperty({ enum: livestockHealthEventProvenance }) provenance!: (typeof livestockHealthEventProvenance)[number];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

/** POST care-event projection; sourceKey is an idempotency input and is not returned. */
export class CareEventResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['disease', 'vaccine', 'medication', 'care'] }) kind!: 'disease' | 'vaccine' | 'medication' | 'care';
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ minLength: 1, maxLength: 2000 }) description!: string;
  @ApiProperty({ enum: ['farmer_report'] }) provenance!: 'farmer_report';
}
