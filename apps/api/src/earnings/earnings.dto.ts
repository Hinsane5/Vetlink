import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class EarningsQueryDto {
  @ApiPropertyOptional({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Bulan kalender UTC yang dibaca, format YYYY-MM.' })
  @IsOptional() @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Tanggal awal inklusif; gunakan bersama to bila memakai rentang.' })
  @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Tanggal akhir inklusif; gunakan bersama from bila memakai rentang.' })
  @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 100;

  @ApiPropertyOptional({ maxLength: 512, description: 'Cursor opaque untuk mengambil transaksi berikutnya.' })
  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string;
}

export class CreateWithdrawalDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Nominal rupiah integer.' })
  @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationId!: string;
}

export class WithdrawalsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @ApiPropertyOptional({ maxLength: 512, description: 'Cursor opaque untuk mengambil riwayat berikutnya.' })
  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string;
}

export class EarningsBalancesDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) pending!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) available!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) reserved!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) paidOut!: number;
}

export class EarningsTotalsDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) gross!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) commission!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) net!: number;
}

export class EarningTransactionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty() displayCode!: string;
  @ApiProperty() serviceLabel!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) gross!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) commission!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) net!: number;
  @ApiProperty({ enum: ['pending', 'available'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) earnedAt!: string;
}

export class PayoutDestinationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() bankLabel!: string;
  @ApiProperty({ description: 'Nomor rekening fixture yang sudah dimasking.' }) accountMasked!: string;
  @ApiProperty() accountHolder!: string;
}

export class WithdrawalResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) amount!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) fee!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) netAmount!: number;
  @ApiProperty({ enum: ['submitting', 'submitted', 'processing', 'paid', 'rejected', 'failed'] }) status!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: 'Null selama adapter belum menerima pengajuan.' }) submittedAt!: string | null;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) adapterOutcome!: string;
  @ApiProperty({ type: PayoutDestinationResponseDto }) destination!: PayoutDestinationResponseDto;
}

export class EarningsResponseDto {
  @ApiProperty() period!: string;
  @ApiProperty() periodLabel!: string;
  @ApiProperty({ type: [Object] }) periods!: { value: string; label: string }[];
  @ApiProperty({ type: EarningsBalancesDto }) balances!: EarningsBalancesDto;
  @ApiProperty({ type: EarningsTotalsDto }) totals!: EarningsTotalsDto;
  @ApiProperty({ type: [EarningTransactionResponseDto] }) transactions!: EarningTransactionResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ type: [WithdrawalResponseDto] }) withdrawals!: WithdrawalResponseDto[];
  @ApiProperty({ type: [WithdrawalResponseDto] }) history!: WithdrawalResponseDto[];
  @ApiProperty({ type: [PayoutDestinationResponseDto] }) destinations!: PayoutDestinationResponseDto[];
}

export class WithdrawalPageResponseDto {
  @ApiProperty({ type: [WithdrawalResponseDto] }) items!: WithdrawalResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export class CreateWithdrawalResponseDto {
  @ApiProperty({ format: 'uuid' }) operationId!: string;
  @ApiProperty() replayed!: boolean;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) adapterOutcome!: string;
  @ApiProperty({ type: WithdrawalResponseDto }) withdrawal!: WithdrawalResponseDto;
}
