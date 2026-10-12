import { Controller, Get, Req } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import type { RequestWithId } from '../common/http/request-id.middleware.js';
import { LivenessResponseDto, ReadinessResponseDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOkResponse({ type: LivenessResponseDto, description: 'Proses API hidup.' })
  @ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
  live(@Req() request: Request & Partial<RequestWithId>): LivenessResponseDto {
    return this.health.liveness(request.requestId ?? '');
  }

  @Get('ready')
  @ApiOkResponse({ type: ReadinessResponseDto, description: 'API dan PostgreSQL siap menerima permintaan.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
  ready(@Req() request: Request & Partial<RequestWithId>): Promise<ReadinessResponseDto> {
    return this.health.readiness(request.requestId ?? '');
  }
}
