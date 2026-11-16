import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class LivestockListQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 512, description: 'Cursor opaque yang dikembalikan halaman sebelumnya.' })
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

/** Projection is camelCase; weightKg remains a decimal string from PostgreSQL numeric. */
export class LivestockResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ format: 'uuid' }) farmId!: string;
  @ApiProperty({ maxLength: 32 }) displayCode!: string;
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty({ maxLength: 80 }) species!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 80 }) breed!: string | null;
  @ApiProperty({ enum: ['female', 'male', 'unknown'] }) sex!: 'female' | 'male' | 'unknown';
  @ApiProperty({ type: String, format: 'date', nullable: true }) birthDate!: string | null;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 1200, nullable: true }) estimatedAgeMonths!: number | null;
  @ApiProperty({ type: String, nullable: true, pattern: '^\\d+(\\.\\d{1,2})?$', description: 'Nilai decimal PostgreSQL sebagai string presisi.' }) weightKg!: string | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class LivestockPageResponseDto {
  @ApiProperty({ type: [LivestockResponseDto] }) items!: LivestockResponseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Cursor opaque untuk halaman berikutnya, atau null bila halaman terakhir.' }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
