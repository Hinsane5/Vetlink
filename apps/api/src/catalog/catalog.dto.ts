import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ProductSearchQueryDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(80) species?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) maxPrice?: number;
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 160 }) name!: string;
  @ApiProperty({ maxLength: 80 }) category!: string;
  @ApiProperty({ type: [String] }) species!: string[];
  @ApiProperty({ maxLength: 5000 }) description!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Harga authoritative dalam rupiah integer.' }) unitPriceIdr!: number;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) imageAttachmentId!: string | null;
  @ApiProperty() active!: boolean;
}

export class ProductPageResponseDto {
  @ApiProperty({ type: [ProductResponseDto] }) items!: ProductResponseDto[];
  @ApiProperty({ type: 'string', nullable: true, description: 'Cursor opaque untuk halaman berikutnya, atau null bila halaman terakhir.' }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
