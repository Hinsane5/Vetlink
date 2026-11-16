import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateFollowUpDto {
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  endsAt!: string;

  @ApiProperty({ minLength: 3, maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class UpdateFollowUpDto {
  @ApiProperty({ enum: ['cancel'] })
  @IsIn(['cancel'])
  action!: 'cancel';

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreateProgressReportDto {
  @ApiProperty({ minLength: 3, maxLength: 2000 })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 5, format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];
}

export class CreateReminderDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Wajib untuk reminder yang dikaitkan ke layanan dokter.' })
  @IsOptional()
  @IsUUID()
  animalId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  followUpId?: string;

  @ApiProperty({ enum: ['care', 'follow_up'] })
  @IsIn(['care', 'follow_up'])
  kind!: 'care' | 'follow_up';

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  instructions!: string;
}

export class UpdateReminderDto {
  @ApiProperty({ enum: ['retry_delivery'] })
  @IsIn(['retry_delivery'])
  action!: 'retry_delivery';
}

export class CompleteCareDto {
  @ApiProperty({ enum: [true], description: 'Konfirmasi bahwa perawatan benar-benar dilakukan.' })
  @IsBoolean()
  confirmation!: boolean;
}

export class FollowUpListResponseDto {
  @ApiProperty({ type: () => FollowUpResponseDto, isArray: true })
  items!: FollowUpResponseDto[];
}

export class FollowUpResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) vetId!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty({ enum: ['recheck'] }) kind!: 'recheck';
  @ApiProperty({ enum: ['scheduled', 'completed', 'cancelled'] }) status!: string;
  @ApiProperty() reason!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) followUpConsultationId!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ReminderListResponseDto {
  @ApiProperty({ type: () => ReminderResponseDto, isArray: true })
  items!: ReminderResponseDto[];
}

export class ReminderResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) consultationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) followUpId!: string | null;
  @ApiProperty({ format: 'uuid' }) ownerId!: string;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty({ enum: ['care', 'follow_up'] }) kind!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty() instructions!: string;
  @ApiProperty({ enum: ['scheduled', 'done'] }) careStatus!: string;
  @ApiProperty({ enum: ['pending', 'sent', 'failed'] }) deliveryStatus!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiProperty() deliveryAttempt!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Hasil adapter lokal; tidak menghubungi provider eksternal.' })
  deliveryOutcome?: Record<string, unknown>;
  @ApiPropertyOptional({ format: 'uuid' }) operationId?: string;
  @ApiPropertyOptional() replayed?: boolean;
}

export class CareCompletionResponseDto {
  @ApiProperty({ type: () => ReminderResponseDto }) reminder!: ReminderResponseDto;
  @ApiProperty({ format: 'uuid' }) healthEventId!: string;
  @ApiProperty({ format: 'uuid' }) operationId!: string;
  @ApiProperty() replayed!: boolean;
}

export class ProgressReportResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty({ format: 'uuid' }) followUpId!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) vetId!: string;
  @ApiProperty({ format: 'uuid' }) animalId!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) attachmentIds!: string[];
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) viewedAt!: string | null;
}

export class ProgressReportListResponseDto {
  @ApiProperty({ type: () => ProgressReportResponseDto, isArray: true })
  items!: ProgressReportResponseDto[];
}
