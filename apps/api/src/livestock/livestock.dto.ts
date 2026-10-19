import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateLivestockDto {
  @IsUUID() farmId!: string;
  @IsString() @MinLength(1) @MaxLength(32) displayCode!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(80) species!: string;
  @IsOptional() @IsString() @MaxLength(80) breed?: string;
  @IsIn(['female','male','unknown']) sex!: 'female'|'male'|'unknown';
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1200) estimatedAgeMonths?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) weightKg?: number;
}

export class PatchLivestockDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(32) displayCode?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) species?: string;
  @IsOptional() @IsString() @MaxLength(80) breed?: string;
  @IsOptional() @IsIn(['female','male','unknown']) sex?: 'female'|'male'|'unknown';
  @IsOptional() @IsDateString() birthDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1200) estimatedAgeMonths?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) weightKg?: number | null;
}

export class CareEventDto {
  @IsIn(['disease','vaccine','medication','care']) kind!: 'disease'|'vaccine'|'medication'|'care';
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @IsString() @MinLength(8) @MaxLength(128) sourceKey!: string;
}
