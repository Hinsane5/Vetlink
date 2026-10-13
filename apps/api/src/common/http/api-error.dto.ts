import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RULE_VIOLATION',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export class ApiErrorResponseDto {
  @ApiProperty({ enum: API_ERROR_CODES, enumName: 'ApiErrorCode' })
  code!: (typeof API_ERROR_CODES)[number];

  @ApiProperty({ example: 'Request validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
    example: { amount: ['must be a positive integer'] },
  })
  fieldErrors?: Record<string, string[]>;

  @ApiProperty({ format: 'uuid', example: 'c4bda34a-2dc2-4f87-8997-63eeb506c05f' })
  requestId!: string;
}
