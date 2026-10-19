import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ClinicalNoteInputDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(4000) complaint?: string;
  @IsOptional() @IsString() @MaxLength(8000) findings?: string;
  @IsOptional() @IsString() @MaxLength(8000) assessment?: string;
  @IsOptional() @IsString() @MaxLength(8000) actions?: string;
  @IsOptional() @IsString() @MaxLength(8000) careInstructions?: string;
}

export class RecommendationItemDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class RecommendationInputDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RecommendationItemDto) @ArrayMaxSize(50) items!: RecommendationItemDto[];
}

export class ExpectedVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
