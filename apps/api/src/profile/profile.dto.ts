import { ApiProperty } from '@nestjs/swagger';

/** Read DTOs match the stable camelCase JSON projection returned by ProfileService. */
export class FarmResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 120 }) name!: string;
  @ApiProperty({ type: [String] }) species!: string[];
  @ApiProperty({ maxLength: 80 }) timezone!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) location!: Record<string, unknown> | null;
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) visitAddressId!: string | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class AddressResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 80 }) label!: string;
  @ApiProperty({ maxLength: 120 }) recipientName!: string;
  @ApiProperty({ maxLength: 32 }) phone!: string;
  @ApiProperty({ maxLength: 500 }) addressLine!: string;
  @ApiProperty({ maxLength: 120 }) city!: string;
  @ApiProperty({ maxLength: 120 }) province!: string;
  @ApiProperty({ maxLength: 16 }) postalCode!: string;
  @ApiProperty({ type: 'string', nullable: true, pattern: '^-?\\d+(\\.\\d{1,6})?$', description: 'PostgreSQL numeric dipertahankan sebagai string desimal agar presisi koordinat tidak hilang.' }) latitude!: string | null;
  @ApiProperty({ type: 'string', nullable: true, pattern: '^-?\\d+(\\.\\d{1,6})?$', description: 'PostgreSQL numeric dipertahankan sebagai string desimal agar presisi koordinat tidak hilang.' }) longitude!: string | null;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class ProfessionalDocumentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 255 }) filename!: string;
  @ApiProperty({ enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] }) mimeType!: string;
  @ApiProperty({ type: 'integer', format: 'int64', minimum: 1, maximum: 10 * 1024 * 1024 }) byteSize!: number;
}
