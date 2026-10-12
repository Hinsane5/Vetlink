import { ApiProperty } from '@nestjs/swagger';

export class LivenessResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ example: 'vetlink-api' })
  service!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T04:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ format: 'uuid', example: 'c4bda34a-2dc2-4f87-8997-63eeb506c05f' })
  requestId!: string;
}

export class DatabaseChecksResponseDto {
  @ApiProperty({ enum: ['ok'] })
  database!: 'ok';
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ready'] })
  status!: 'ready';

  @ApiProperty({ type: DatabaseChecksResponseDto })
  checks!: DatabaseChecksResponseDto;

  @ApiProperty({ format: 'date-time', example: '2026-10-13T04:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ format: 'uuid', example: 'c4bda34a-2dc2-4f87-8997-63eeb506c05f' })
  requestId!: string;
}
