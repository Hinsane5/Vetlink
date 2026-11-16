import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

export class NotificationCategoryPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  consultations?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  commerce?: boolean;
}

export class PatchPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: () => NotificationCategoryPatchDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationCategoryPatchDto)
  notifications?: NotificationCategoryPatchDto;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty({ format: 'uuid' }) recipientId!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ enum: ['consultations', 'reminders', 'commerce'] }) category!: string;
  @ApiProperty({ enum: ['follow_up', 'progress_report', 'reminder'] }) contextType!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) contextId!: string | null;
  @ApiProperty() eventId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ enum: ['pending', 'sent', 'failed', 'suppressed'] }) deliveryStatus!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: () => NotificationResponseDto, isArray: true }) items!: NotificationResponseDto[];
  @ApiProperty() unreadCount!: number;
}

export class NotificationReadResponseDto {
  @ApiProperty({ type: () => NotificationResponseDto }) notification!: NotificationResponseDto;
  @ApiProperty({ format: 'uuid', nullable: true }) contextId!: string | null;
  @ApiProperty({ enum: ['follow_up', 'progress_report', 'reminder'], nullable: true }) contextType!: string | null;
}

export class PreferencesResponseDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: 'object', properties: {
    consultations: { type: 'boolean' }, reminders: { type: 'boolean' }, commerce: { type: 'boolean' },
  } }) notifications!: { consultations: boolean; reminders: boolean; commerce: boolean };
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
