import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class WeekdayRuleDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end!: string;
}

export class VetAvailabilityDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() acceptingNewRequests!: boolean;
  @IsArray() @IsIn(['chat', 'visit'], { each: true }) services!: ('chat'|'visit')[];
  @IsString() @MinLength(1) @MaxLength(80) timezone!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => WeekdayRuleDto) weekdayRules!: WeekdayRuleDto[];
  @IsInt() @Min(5) @Max(240) chatDurationMinutes!: number;
  @IsInt() @Min(5) @Max(240) visitDurationMinutes!: number;
  @IsObject() rates!: { chat?: number; visit?: number };
  @IsOptional() @IsInt() @Min(0) experienceYears?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) specialties?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) species?: string[];
  @IsOptional() @IsString() @MaxLength(160) practiceLocation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serviceAreas?: string[];
}

export class BlockedTimeDto {
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class BlockedTimePatchDto extends BlockedTimeDto { @IsInt() @Min(1) expectedVersion!: number; }

export class DirectoryQueryDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) species?: string;
  @IsOptional() @IsIn(['chat','visit']) service?: 'chat'|'visit';
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsIn(['true','false']) available?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minFee?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) maxFee?: number;
}

export class DirectoryPageQueryDto extends DirectoryQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 512, description: 'Cursor opaque dari halaman sebelumnya.' })
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class DirectoryWeekdayRuleResponseDto {
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 6 }) weekday!: number;
  @ApiProperty({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }) start!: string;
  @ApiProperty({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }) end!: string;
}

export class VetDirectoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 120 }) professionalName!: string;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 80 }) experienceYears!: number;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty({ type: [String] }) species!: string[];
  @ApiProperty({ type: String }) practiceLocation!: string;
  @ApiProperty({ type: [String] }) serviceAreas!: string[];
  @ApiProperty() acceptingNewRequests!: boolean;
  @ApiProperty({ type: [String], enum: ['chat', 'visit'] }) services!: ('chat' | 'visit')[];
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: [DirectoryWeekdayRuleResponseDto] }) weekdayRules!: DirectoryWeekdayRuleResponseDto[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer', minimum: 0 }, description: 'Tarif per layanan dalam IDR integer.' }) fees!: Record<string, number>;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Minimum tarif dalam IDR integer; nilai di luar rentang aman ditolak oleh service.' }) minFeeIdr!: number;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Maximum tarif dalam IDR integer; nilai di luar rentang aman ditolak oleh service.' }) maxFeeIdr!: number;
  @ApiProperty({ type: Number, minimum: 0, maximum: 5, description: 'Rata-rata dibulatkan dua desimal; nilai awal 0.' }) ratingAverage!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) ratingCount!: number;
}

export class VetDirectoryDetailResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 120 }) professionalName!: string;
  @ApiProperty({ type: 'integer', minimum: 0, maximum: 80 }) experienceYears!: number;
  @ApiProperty({ type: [String] }) specialties!: string[];
  @ApiProperty({ type: [String] }) species!: string[];
  @ApiProperty({ type: String }) practiceLocation!: string;
  @ApiProperty({ type: [String] }) serviceAreas!: string[];
  @ApiProperty() acceptingNewRequests!: boolean;
  @ApiProperty({ type: [String], enum: ['chat', 'visit'] }) services!: ('chat' | 'visit')[];
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: [DirectoryWeekdayRuleResponseDto] }) weekdayRules!: DirectoryWeekdayRuleResponseDto[];
  @ApiProperty({ type: 'integer', minimum: 5, maximum: 240 }) chatDurationMinutes!: number;
  @ApiProperty({ type: 'integer', minimum: 5, maximum: 240 }) visitDurationMinutes!: number;
  @ApiProperty({ type: Number, minimum: 0, maximum: 5 }) ratingAverage!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) ratingCount!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer', minimum: 0 }, description: 'Tarif terkini per layanan dalam IDR integer.' }) rates!: Record<string, number>;
}

export class VetDirectoryPageResponseDto {
  @ApiProperty({ type: [VetDirectoryResponseDto] }) items!: VetDirectoryResponseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Cursor opaque untuk halaman berikutnya, atau null bila halaman terakhir.' }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export class VetSlotResponseDto {
  @ApiProperty({ type: 'string', format: 'date-time' }) startsAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) endsAt!: string;
}

export class SlotsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!: string;
  @IsIn(['chat','visit']) service!: 'chat'|'visit';
}

export class ScheduleQueryDto {
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
}
