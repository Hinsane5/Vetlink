import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'expired'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export class CreatePaymentDto {
  @ApiProperty({ enum: ['consultation', 'order'] })
  @IsIn(['consultation', 'order'])
  payableType!: 'consultation' | 'order';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  payableId!: string;

  @ApiProperty({ enum: ['bank_transfer', 'e_wallet'] })
  @IsIn(['bank_transfer', 'e_wallet'])
  method!: 'bank_transfer' | 'e_wallet';
}

export class PaymentLookupQueryDto {
  @ApiProperty({ enum: ['consultation', 'order'], description: 'Jenis payable yang telah dibayar.' })
  @IsIn(['consultation', 'order'])
  payableType!: 'consultation' | 'order';

  @ApiProperty({ format: 'uuid', description: 'ID consultation atau order yang menjadi sumber jumlah pembayaran.' })
  @IsUUID()
  payableId!: string;
}

export class PaymentAttemptSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status!: PaymentStatus;

  @ApiProperty({ nullable: true, description: 'Referensi adapter lokal; bukan credential/provider token.' })
  reference!: string | null;
}

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['consultation', 'order'] })
  payableType!: 'consultation' | 'order';

  @ApiProperty({ format: 'uuid' })
  payableId!: string;

  @ApiProperty({ type: 'integer', minimum: 0, description: 'Jumlah rupiah hasil snapshot server.' })
  amountIdr!: number;

  @ApiProperty({ enum: ['IDR'] })
  currency!: 'IDR';

  @ApiProperty({ enum: ['bank_transfer', 'e_wallet'] })
  method!: 'bank_transfer' | 'e_wallet';

  @ApiProperty({ enum: PAYMENT_STATUSES })
  status!: PaymentStatus;

  @ApiProperty({ type: PaymentAttemptSummaryResponseDto, nullable: true })
  attempt!: PaymentAttemptSummaryResponseDto | null;
}

export class PaymentAttemptResponseDto extends PaymentAttemptSummaryResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  attemptNumber!: number;

  @ApiProperty({ format: 'date-time' })
  attemptedAt!: string;
}

export class PaymentStatusResponseDto extends PaymentResponseDto {
  @ApiProperty({ type: [PaymentAttemptResponseDto], description: 'Riwayat semua Attempt pada Payment, urut dari yang paling lama.' })
  attempts!: PaymentAttemptResponseDto[];
}

export class PaymentAttemptListResponseDto {
  @ApiProperty({ type: [PaymentAttemptResponseDto] })
  items!: PaymentAttemptResponseDto[];
}
