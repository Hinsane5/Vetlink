import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5)
  stars!: number;

  @ApiPropertyOptional({ type: String, maxLength: 1000, description: 'Komentar opsional; spasi tepi dipangkas dan teks kosong disimpan sebagai null.' })
  @IsOptional() @IsString() @MaxLength(1000)
  text?: string;
}

export class ReviewListQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 512, description: 'Cursor opaque untuk halaman berikutnya.' })
  @IsOptional() @IsString() @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}

export class ReviewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) consultationId!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 }) stars!: number;
  @ApiProperty({ type: String, nullable: true, maxLength: 1000 }) text!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) submittedAt!: string;
}

export class PublicReviewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5 }) stars!: number;
  @ApiProperty({ type: String, nullable: true, maxLength: 1000 }) text!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) submittedAt!: string;
}

export class ReviewPageResponseDto {
  @ApiProperty({ type: [PublicReviewResponseDto] }) items!: PublicReviewResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
