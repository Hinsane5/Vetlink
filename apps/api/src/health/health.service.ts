import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { LivenessResponseDto, ReadinessResponseDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  liveness(requestId: string): LivenessResponseDto {
    return {
      status: 'ok',
      service: 'vetlink-api',
      timestamp: new Date().toISOString(),
      requestId,
    };
  }

  async readiness(requestId: string): Promise<ReadinessResponseDto> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service is not ready',
      });
    }

    return {
      status: 'ready',
      checks: { database: 'ok' },
      timestamp: new Date().toISOString(),
      requestId,
    };
  }
}
