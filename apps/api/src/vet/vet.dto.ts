import { Type } from 'class-transformer';
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
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minFee?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxFee?: number;
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
