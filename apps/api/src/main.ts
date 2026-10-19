import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { domainStatusSchemas } from './contracts/domain-statuses.js';
import { loadAppConfig } from './config/app-config.js';

function collectFieldErrors(errors: Array<{ property: string; constraints?: Record<string, string>; children?: unknown[] }>, prefix = ''): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});
    if (messages.length > 0) fieldErrors[field] = messages;

    const children = (error.children ?? []) as Array<{
      property: string;
      constraints?: Record<string, string>;
      children?: unknown[];
    }>;
    Object.assign(fieldErrors, collectFieldErrors(children, field));
  }
  return fieldErrors;
}

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          fieldErrors: collectFieldErrors(errors),
        }),
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('VetLink API')
    .setDescription(
      'BE-00–08 and BE-10/11 contract. Health, authentication, profile/verification, farm/address, livestock CRUD, scoped patient/health timelines, verified-vet discovery and availability, booking/request/proposal/visit/completion, payment quote and attempts, clinical notes/recommendations, private chat media and polling delivery, active product catalog search/detail, plus farmer-only cart/checkout/order snapshots are implemented; other domain routes are delivered by their backend tickets.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'Opaque token' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...domainStatusSchemas,
      CursorPageRequest: {
        type: 'object',
        properties: {
          cursor: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
      },
      VersionedMutationRequest: {
        type: 'object',
        required: ['expectedVersion'],
        properties: { expectedVersion: { type: 'integer', minimum: 1 } },
        additionalProperties: true,
        description: 'Shared request base for concurrency-sensitive mutation DTOs.',
      },
      AdapterFailure: {
        type: 'object',
        required: ['code', 'message', 'retryable'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          retryable: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      AdapterOperationResult: {
        oneOf: [
          {
            type: 'object',
            required: ['operationId', 'status', 'occurredAt'],
            properties: {
              operationId: { type: 'string', format: 'uuid' },
              status: { type: 'string', enum: ['pending'] },
              occurredAt: { type: 'string', format: 'date-time' },
            },
            additionalProperties: false,
          },
          {
            type: 'object',
            required: ['operationId', 'status', 'occurredAt'],
            properties: {
              operationId: { type: 'string', format: 'uuid' },
              status: { type: 'string', enum: ['succeeded'] },
              occurredAt: { type: 'string', format: 'date-time' },
            },
            additionalProperties: false,
          },
          {
            type: 'object',
            required: ['operationId', 'status', 'occurredAt', 'error'],
            properties: {
              operationId: { type: 'string', format: 'uuid' },
              status: { type: 'string', enum: ['failed'] },
              occurredAt: { type: 'string', format: 'date-time' },
              error: { $ref: '#/components/schemas/AdapterFailure' },
            },
            additionalProperties: false,
          },
        ],
        description: 'Explicit adapter outcome. Persist the result before exposing success.',
      },
    },
    parameters: {
      ...document.components?.parameters,
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 8, maxLength: 128 },
        description: 'Retry of the same operation must reuse the same key and payload.',
      },
    },
    responses: {
      ...document.components?.responses,
      ValidationError: { description: 'Request validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      Unauthenticated: { description: 'Authentication is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      Forbidden: { description: 'Role or resource access denied', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      NotFound: { description: 'Resource not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      Conflict: { description: 'Status, version, or slot conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      RuleViolation: { description: 'Domain rule rejected the request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      RateLimited: { description: 'Request rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      ServiceUnavailable: { description: 'Dependency unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      PayloadTooLarge: { description: 'Uploaded file exceeds the multipart transport limit', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
      InternalError: { description: 'Unexpected server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponseDto' } } } },
    },
  };
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
    swaggerOptions: { persistAuthorization: false },
    customSiteTitle: 'VetLink API',
  });

  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
