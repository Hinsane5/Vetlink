import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { API_ERROR_CODES, type ApiErrorResponseDto } from './api-error.dto.js';
import type { RequestWithId } from './request-id.middleware.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeForStatus(status: number): ApiErrorResponseDto['code'] {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'RULE_VIOLATION';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function validFieldErrors(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).flatMap(([field, messages]) => {
    if (!Array.isArray(messages)) return [];
    const strings = messages.filter((message): message is string => typeof message === 'string');
    return strings.length > 0 ? [[field, strings] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & Partial<RequestWithId>>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionBody = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = isRecord(exceptionBody) ? exceptionBody : {};

    const candidateCode = details.code;
    const code = API_ERROR_CODES.includes(candidateCode as (typeof API_ERROR_CODES)[number])
      ? (candidateCode as ApiErrorResponseDto['code'])
      : codeForStatus(status);

    const message =
      status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? code === 'SERVICE_UNAVAILABLE'
          ? 'Service is not ready'
          : 'Internal server error'
        : typeof details.message === 'string'
          ? details.message
          : 'Request could not be completed';

    const body: ApiErrorResponseDto = {
      code,
      message,
      ...(validFieldErrors(details.fieldErrors) ? { fieldErrors: validFieldErrors(details.fieldErrors) } : {}),
      requestId: request.requestId ?? randomUUID(),
    };

    response.setHeader('X-Request-Id', body.requestId);
    response.status(status).json(body);
  }
}
