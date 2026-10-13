import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UploadAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  consultationId!: string;
}

export class SendMessageDto {
  @ApiProperty({ format: 'uuid', description: 'ID klien yang sama dipakai ulang pada retry pesan.' })
  @IsUUID()
  clientMessageId!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 5, format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];
}

export class MessagePageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ maxLength: 512, description: 'Cursor opaque untuk mengambil pesan yang lebih lama.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class AttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['image', 'video'] })
  kind!: 'image' | 'video';

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'] })
  mimeType!: string;

  @ApiProperty({ maxLength: 255 })
  filename!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  byteSize!: number;

  @ApiProperty({ enum: ['uploaded', 'committed'] })
  uploadStatus!: 'uploaded' | 'committed';

  @ApiProperty({ format: 'uri-reference' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class MessageAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['image', 'video'] })
  kind!: 'image' | 'video';

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  byteSize!: number;

  @ApiProperty({ format: 'uri-reference' })
  url!: string;
}

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  clientMessageId!: string;

  @ApiProperty({ format: 'uuid' })
  senderId!: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  text!: string | null;

  @ApiProperty({ type: [MessageAttachmentDto] })
  attachments!: MessageAttachmentDto[];

  @ApiProperty({ enum: ['pending', 'sent', 'failed'] })
  deliveryStatus!: 'pending' | 'sent' | 'failed';

  @ApiProperty({ minimum: 1 })
  deliveryAttempt!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  sentAt!: string | null;
}

export class MessagePageResponseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  items!: MessageResponseDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Kirim kembali sebagai cursor untuk halaman yang lebih lama.' })
  nextCursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}
