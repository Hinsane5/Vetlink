import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import 'reflect-metadata';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ConsultationService } from '../dist/consultation/consultation.service.js';
import { ProfileController } from '../dist/profile/profile.controller.js';
import { AUTH_ROLES_KEY } from '../dist/auth/auth.decorators.js';

const methods = ['get', 'post', 'put', 'patch', 'delete'];
const unauthenticatedOperations = new Set([
  'get /v1/health/live',
  'get /v1/health/ready',
  'post /v1/auth/register',
  'post /v1/auth/login',
  'post /v1/auth/logout',
  'post /v1/auth/refresh',
  'post /v1/auth/password-reset',
  'post /v1/auth/password-reset/confirm',
]);
const idempotentOperations = [
  ['post', '/v1/consultation-quotes'],
  ['post', '/v1/consultations'],
  ['post', '/v1/consultations/{consultationId}/accept'],
  ['post', '/v1/consultations/{consultationId}/reject'],
  ['post', '/v1/consultations/{consultationId}/schedule-proposals'],
  ['post', '/v1/consultations/{consultationId}/schedule-proposals/{proposalId}/respond'],
  ['post', '/v1/consultations/{consultationId}/start'],
  ['post', '/v1/consultations/{consultationId}/visit/depart'],
  ['post', '/v1/consultations/{consultationId}/visit/arrive'],
  ['post', '/v1/consultations/{consultationId}/visit/start-examination'],
  ['post', '/v1/consultations/{consultationId}/complete'],
  ['post', '/v1/consultations/{consultationId}/follow-ups'],
  ['patch', '/v1/follow-ups/{followUpId}'],
  ['post', '/v1/follow-ups/{followUpId}/progress-reports'],
  ['post', '/v1/reminders'],
  ['patch', '/v1/reminders/{reminderId}'],
  ['post', '/v1/reminders/{reminderId}/complete'],
  ['post', '/v1/attachments/uploads'],
  ['post', '/v1/payments'],
  ['post', '/v1/me/vet/withdrawals'],
  ['post', '/v1/orders'],
];

let child;
let baseUrl;
let openApi;
let serverOutput = '';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function resolveReference(document, reference) {
  assert.ok(reference.startsWith('#/'), `Expected local OpenAPI reference, received ${reference}`);
  return reference.slice(2).split('/').reduce((value, segment) => {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return value?.[key];
  }, document);
}

function schemaProperties(document, schemaOrReference) {
  const schema = typeof schemaOrReference === 'string'
    ? resolveReference(document, schemaOrReference)
    : schemaOrReference;
  const inherited = (schema.allOf ?? []).reduce((properties, part) => ({
    ...properties,
    ...schemaProperties(document, part),
  }), {});
  return { ...inherited, ...(schema.properties ?? {}) };
}

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '55432',
      DATABASE_NAME: 'vetlink_contract_only',
      DATABASE_USER: 'vetlink_contract_only',
      DATABASE_PASSWORD: 'local-placeholder-not-a-secret',
      DATABASE_SSL: 'false',
      CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'false',
      REMINDER_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'false',
      NOTIFICATION_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8_000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-8_000); });

  let liveResponse;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited before startup (${child.exitCode}):\n${serverOutput}`);
    try {
      liveResponse = await fetch(`${baseUrl}/v1/health/live`, { signal: AbortSignal.timeout(1_000) });
      if (liveResponse.ok) break;
    } catch {
      // Retry briefly while NestJS binds to the local port.
    }
    await delay(100);
  }
  assert.ok(liveResponse?.ok, `API did not become live:\n${serverOutput}`);

  const response = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(response.status, 200);
  openApi = await response.json();
}, { timeout: 20_000 });

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
});

test('OpenAPI is structurally valid and every local reference resolves', () => {
  assert.equal(openApi.openapi, '3.0.0');
  assert.equal(openApi.info.title, 'VetLink API');
  assert.equal(openApi.info.version, '1.0.0');
  assert.ok(Object.keys(openApi.paths).length >= 80);
  assert.ok(openApi.components.securitySchemes.bearer);
  assert.equal(openApi.components.securitySchemes.bearer.type, 'http');
  assert.equal(openApi.components.securitySchemes.bearer.scheme, 'bearer');

  const unresolved = [];
  const visit = (value, location = '$') => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && resolveReference(openApi, value.$ref) === undefined) {
      unresolved.push(`${location}: ${value.$ref}`);
    }
    for (const [key, childValue] of Object.entries(value)) visit(childValue, `${location}.${key}`);
  };
  visit(openApi);
  assert.deepEqual(unresolved, []);

  for (const [path, pathItem] of Object.entries(openApi.paths)) {
    assert.ok(path.startsWith('/v1/'), `Unexpected path outside API v1: ${path}`);
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;
      assert.ok(operation.operationId, `${method.toUpperCase()} ${path} has no operationId`);
      assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `${method.toUpperCase()} ${path} has no responses`);
      for (const [status, response] of Object.entries(operation.responses)) {
        assert.equal(typeof response.description, 'string', `${method.toUpperCase()} ${path} response ${status} has no description`);
      }
      if (!unauthenticatedOperations.has(`${method} ${path}`)) {
        assert.ok(operation.security?.some((entry) => entry.bearer !== undefined), `${method.toUpperCase()} ${path} must require bearer auth`);
      }
    }
  }
});

test('mobile workflow routes and data contracts are present', () => {
  const requiredOperations = [
    ['get', '/v1/me'],
    ['post', '/v1/auth/active-role'],
    ['get', '/v1/me/farms'],
    ['post', '/v1/me/farms'],
    ['get', '/v1/livestock'],
    ['get', '/v1/patients'],
    ['get', '/v1/vets'],
    ['post', '/v1/consultation-quotes'],
    ['post', '/v1/consultations'],
    ['post', '/v1/consultations/{consultationId}/visit/depart'],
    ['post', '/v1/consultations/{consultationId}/complete'],
    ['post', '/v1/payments'],
    ['get', '/v1/payments'],
    ['get', '/v1/payments/{id}'],
    ['get', '/v1/payments/{id}/attempts'],
    ['post', '/v1/consultations/{consultationId}/note/finalize'],
    ['post', '/v1/consultations/{consultationId}/recommendation/send'],
    ['get', '/v1/me/vet/earnings'],
    ['post', '/v1/me/vet/withdrawals'],
    ['get', '/v1/me/notifications'],
    ['get', '/v1/orders/{id}/shipment'],
  ];
  for (const [method, path] of requiredOperations) {
    assert.ok(openApi.paths[path]?.[method], `Missing ${method.toUpperCase()} ${path}`);
  }
  assert.equal(openApi.paths['/v1/payment-callbacks'], undefined);
  assert.equal(openApi.paths['/v1/payout-callbacks'], undefined);
  assert.equal(openApi.paths['/v1/webhooks'], undefined);

  const paymentSchema = openApi.components.schemas.CreatePaymentDto;
  assert.deepEqual(paymentSchema.required, ['payableType', 'payableId', 'method']);
  assert.deepEqual(Object.keys(paymentSchema.properties).sort(), ['method', 'payableId', 'payableType']);
  assert.deepEqual(paymentSchema.properties.payableType.enum, ['consultation', 'order']);
  assert.deepEqual(paymentSchema.properties.method.enum, ['bank_transfer', 'e_wallet']);
  assert.equal(paymentSchema.properties.amountIdr, undefined, 'The client cannot supply a payment amount.');

  const switchRoleRequest = openApi.components.schemas.SwitchActiveRoleRequestDto;
  assert.deepEqual(switchRoleRequest.required, ['activeRole']);
  assert.deepEqual(switchRoleRequest.properties.activeRole.enum, ['farmer', 'vet']);
  const switchRoleOperation = openApi.paths['/v1/auth/active-role'].post;
  assert.equal(switchRoleOperation.requestBody.content['application/json'].schema.$ref, '#/components/schemas/SwitchActiveRoleRequestDto');
  assert.equal(switchRoleOperation.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/AuthSessionResponseDto');

  const paymentLookup = openApi.paths['/v1/payments'].get;
  const paymentLookupParameters = paymentLookup.parameters.filter((parameter) => parameter.in === 'query');
  assert.deepEqual(paymentLookupParameters.map((parameter) => parameter.name).sort(), ['payableId', 'payableType']);
  assert.ok(paymentLookupParameters.every((parameter) => parameter.required));
  assert.equal(paymentLookup.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/PaymentStatusResponseDto');
  assert.equal(openApi.paths['/v1/payments/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/PaymentStatusResponseDto');
  assert.equal(openApi.paths['/v1/payments/{id}/attempts'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/PaymentAttemptListResponseDto');
  const paymentStatus = openApi.components.schemas.PaymentStatusResponseDto;
  assert.equal(paymentStatus.properties.amountIdr.type, 'integer');
  assert.equal(paymentStatus.properties.currency.enum[0], 'IDR');
  assert.deepEqual(paymentStatus.properties.attempts.items.$ref, '#/components/schemas/PaymentAttemptResponseDto');
  assert.deepEqual(openApi.components.schemas.PaymentAttemptResponseDto.properties.status.enum, ['pending', 'succeeded', 'failed', 'expired']);

  const withdrawalInput = openApi.components.schemas.CreateWithdrawalDto;
  assert.equal(withdrawalInput.properties.amount.type, 'integer');
  assert.equal(withdrawalInput.properties.amount.minimum, 1);
  assert.deepEqual(withdrawalInput.required, ['amount', 'destinationId']);
  const withdrawalResponse = openApi.components.schemas.WithdrawalResponseDto;
  for (const field of ['amount', 'fee', 'netAmount']) assert.equal(withdrawalResponse.properties[field].type, 'integer');
  assert.equal(withdrawalResponse.properties.submittedAt.type, 'string');
  assert.equal(withdrawalResponse.properties.submittedAt.nullable, true);
  assert.equal(withdrawalResponse.properties.destinationId, undefined);
  assert.equal(openApi.components.schemas.PayoutDestinationResponseDto.properties.accountNumber, undefined);
  for (const field of ['pending', 'available', 'reserved', 'paidOut']) {
    assert.equal(openApi.components.schemas.EarningsBalancesDto.properties[field].type, 'integer');
  }
});

test('all mutation keys and DTO request bodies are documented', () => {
  const parameterRef = '#/components/parameters/IdempotencyKey';
  const idempotencyKey = openApi.components.parameters.IdempotencyKey;
  assert.equal(idempotencyKey.name, 'Idempotency-Key');
  assert.equal(idempotencyKey.in, 'header');
  assert.equal(idempotencyKey.required, true);
  assert.equal(idempotencyKey.schema.minLength, 8);
  assert.equal(idempotencyKey.schema.maxLength, 128);

  for (const [method, path] of idempotentOperations) {
    const operation = openApi.paths[path]?.[method];
    assert.ok(operation, `Missing idempotent route ${method.toUpperCase()} ${path}`);
    assert.ok(operation.parameters?.some((parameter) => parameter.$ref === parameterRef),
      `${method.toUpperCase()} ${path} must declare Idempotency-Key`);
  }

  const emptyDtoSchemas = Object.entries(openApi.components.schemas)
    .filter(([name, schema]) => name.endsWith('Dto') && schema.type === 'object' && Object.keys(schema.properties ?? {}).length === 0)
    .map(([name]) => name);
  assert.deepEqual(emptyDtoSchemas, [], `DTO schemas must describe their fields: ${emptyDtoSchemas.join(', ')}`);
});

test('BE-16 read DTOs describe Farm, address, livestock, directory and slots', () => {
  const paths = openApi.paths;
  const schemas = openApi.components.schemas;
  for (const path of ['/v1/me/farms', '/v1/me/farms/{id}', '/v1/me/addresses', '/v1/me/addresses/{id}', '/v1/livestock', '/v1/livestock/{id}', '/v1/livestock/page', '/v1/vets', '/v1/vets/page', '/v1/vets/{id}', '/v1/vets/{id}/slots']) {
    assert.ok(paths[path]?.get, `Missing read route ${path}`);
  }
  for (const [path, schemaName] of [
    ['/v1/me/farms', 'FarmResponseDto'],
    ['/v1/me/addresses', 'AddressResponseDto'],
    ['/v1/livestock', 'LivestockResponseDto'],
    ['/v1/vets', 'VetDirectoryResponseDto'],
    ['/v1/vets/{id}/slots', 'VetSlotResponseDto'],
  ]) {
    assert.equal(paths[path].get.responses['200'].content['application/json'].schema.type, 'array');
    assert.equal(paths[path].get.responses['200'].content['application/json'].schema.items.$ref, `#/components/schemas/${schemaName}`);
  }
  assert.equal(paths['/v1/me/farms/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/FarmResponseDto');
  assert.equal(paths['/v1/me/addresses/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/AddressResponseDto');
  assert.equal(paths['/v1/livestock/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/LivestockResponseDto');
  assert.equal(paths['/v1/livestock/page'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/LivestockPageResponseDto');
  assert.equal(paths['/v1/vets/page'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/VetDirectoryPageResponseDto');

  for (const schemaName of ['FarmResponseDto', 'AddressResponseDto', 'LivestockResponseDto', 'VetDirectoryResponseDto', 'VetDirectoryDetailResponseDto', 'VetSlotResponseDto']) {
    assert.ok(Object.keys(schemas[schemaName].properties).every((field) => !field.includes('_')), `${schemaName} uses camelCase properties`);
  }
  for (const field of ['createdAt', 'updatedAt']) assert.equal(schemas.FarmResponseDto.properties[field].format, 'date-time');
  assert.equal(schemas.AddressResponseDto.properties.latitude.type, 'string');
  assert.equal(schemas.AddressResponseDto.properties.latitude.nullable, true);
  assert.equal(schemas.LivestockResponseDto.properties.birthDate.format, 'date');
  assert.equal(schemas.LivestockResponseDto.properties.weightKg.type, 'string');
  assert.equal(schemas.VetDirectoryResponseDto.properties.fees.additionalProperties.type, 'integer');
  assert.equal(schemas.VetDirectoryResponseDto.properties.minFeeIdr.type, 'integer');
  assert.equal(schemas.VetDirectoryDetailResponseDto.properties.rates.additionalProperties.type, 'integer');
  for (const field of ['startsAt', 'endsAt']) assert.equal(schemas.VetSlotResponseDto.properties[field].format, 'date-time');

  for (const path of ['/v1/livestock/page', '/v1/vets/page']) {
    const names = paths[path].get.parameters.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name);
    assert.ok(names.includes('cursor'));
    assert.ok(names.includes('limit'));
  }
  assert.ok(paths['/v1/vets/page'].get.parameters.some((parameter) => parameter.name === 'name'));
  assert.ok(paths['/v1/vets/page'].get.parameters.some((parameter) => parameter.name === 'service'));
});

test('BE-16 patient and health event responses describe the runtime projections', () => {
  const paths = openApi.paths;
  const schemas = openApi.components.schemas;
  const arrayItem = (path, method, status, schemaName) => {
    const schema = paths[path]?.[method]?.responses?.[status]?.content?.['application/json']?.schema;
    assert.equal(schema?.type, 'array', `${method.toUpperCase()} ${path} must keep its array response`);
    assert.equal(schema.items.$ref, `#/components/schemas/${schemaName}`);
    return schemas[schemaName];
  };

  const patients = arrayItem('/v1/patients', 'get', '200', 'PatientResponseDto');
  const patientFields = ['id', 'displayCode', 'name', 'species', 'breed', 'sex', 'birthDate', 'estimatedAgeMonths', 'weightKg', 'farmId', 'farmerId', 'ownerName', 'lastServiceAt', 'serviceCount', 'latestServiceType', 'latestServiceStatus'];
  assert.deepEqual(Object.keys(patients.properties).sort(), [...patientFields].sort());
  assert.deepEqual([...patients.required].sort(), [...patientFields].sort());
  assert.equal(patients.properties.id.format, 'uuid');
  assert.equal(patients.properties.birthDate.format, 'date');
  assert.equal(patients.properties.weightKg.type, 'string');
  assert.equal(patients.properties.weightKg.nullable, true);
  assert.equal(patients.properties.ownerName.type, 'string');
  assert.equal(patients.properties.ownerName.maxLength, 120);
  assert.equal(patients.properties.lastServiceAt.format, 'date-time');
  assert.equal(patients.properties.serviceCount.type, 'integer');
  assert.equal(patients.properties.serviceCount.minimum, 1);
  assert.deepEqual(patients.properties.latestServiceType.enum, ['chat', 'visit']);
  assert.ok(patients.properties.latestServiceStatus.enum.includes('arrived'));
  assert.ok(patients.properties.latestServiceStatus.enum.includes('completed'));
  assert.equal(patients.properties.email, undefined);
  assert.equal(patients.properties.phone, undefined);
  assert.ok(paths['/v1/patients'].get.responses['200'].description.includes('draft dan awaiting_payment'));
  assert.ok(paths['/v1/patients'].get.security?.some((entry) => entry.bearer !== undefined));

  const timeline = arrayItem('/v1/livestock/{id}/health-events', 'get', '200', 'LivestockHealthEventResponseDto');
  const timelineFields = ['id', 'kind', 'occurredAt', 'description', 'provenance', 'createdAt'];
  assert.deepEqual(Object.keys(timeline.properties).sort(), [...timelineFields].sort());
  assert.deepEqual([...timeline.required].sort(), [...timelineFields].sort());
  assert.deepEqual(timeline.properties.kind.enum, ['examination', 'disease', 'vaccine', 'medication', 'care']);
  assert.deepEqual(timeline.properties.provenance.enum, ['farmer_report', 'clinical_note', 'reminder']);
  assert.equal(timeline.properties.description.minLength, 1);
  assert.equal(timeline.properties.description.maxLength, 2000);
  assert.equal(timeline.properties.occurredAt.format, 'date-time');
  assert.equal(timeline.properties.createdAt.format, 'date-time');
  assert.equal(timeline.properties.actorId, undefined);
  assert.equal(timeline.properties.findings, undefined);
  assert.equal(timeline.properties.attachments, undefined);
  assert.ok(paths['/v1/livestock/{id}/health-events'].get.responses['200'].description.includes('tanpa draft'));

  const careResponse = paths['/v1/livestock/{id}/care-events'].post.responses['201'].content['application/json'].schema;
  assert.equal(careResponse.$ref, '#/components/schemas/CareEventResponseDto');
  const care = schemas.CareEventResponseDto;
  const careFields = ['id', 'kind', 'occurredAt', 'description', 'provenance'];
  assert.deepEqual(Object.keys(care.properties).sort(), [...careFields].sort());
  assert.deepEqual([...care.required].sort(), [...careFields].sort());
  assert.deepEqual(care.properties.kind.enum, ['disease', 'vaccine', 'medication', 'care']);
  assert.deepEqual(care.properties.provenance.enum, ['farmer_report']);
  assert.equal(care.properties.description.minLength, 1);
  assert.equal(care.properties.description.maxLength, 2000);
  assert.equal(care.properties.sourceKey, undefined);
  assert.equal(care.properties.actorId, undefined);
  assert.equal(care.properties.createdAt, undefined);

  const careOperation = paths['/v1/livestock/{id}/care-events'].post;
  const careRequestRef = careOperation.requestBody.content['application/json'].schema.$ref;
  assert.equal(careRequestRef, '#/components/schemas/CareEventDto');
  const sourceKey = schemas.CareEventDto.properties.sourceKey;
  assert.equal(sourceKey.minLength, 8);
  assert.equal(sourceKey.maxLength, 128);
  assert.equal(careOperation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), false,
    'sourceKey in the body remains the idempotency identity for care-event retries.');
});

test('BE-05 consultation success responses describe the service projections', () => {
  const paths = openApi.paths;
  const schemas = openApi.components.schemas;
  const responseSchema = (method, path, status, expectedRef) => {
    const response = paths[path]?.[method]?.responses?.[status];
    assert.ok(response, `Missing ${status} response for ${method.toUpperCase()} ${path}`);
    const actual = response.content?.['application/json']?.schema;
    assert.ok(actual, `Missing JSON response schema for ${method.toUpperCase()} ${path}`);
    assert.equal(actual.$ref, expectedRef, `${method.toUpperCase()} ${path} response schema`);
    return schemaProperties(openApi, expectedRef);
  };

  const quote = responseSchema('post', '/v1/consultation-quotes', '201', '#/components/schemas/ConsultationQuoteResponseDto');
  const created = responseSchema('post', '/v1/consultations', '201', '#/components/schemas/ConsultationActionResponseDto');
  const listResponse = paths['/v1/consultations'].get.responses['200'].content['application/json'].schema;
  assert.equal(listResponse.type, 'array');
  assert.equal(listResponse.items.$ref, '#/components/schemas/ConsultationListItemResponseDto');
  const listItem = schemaProperties(openApi, listResponse.items.$ref);
  const detail = responseSchema('get', '/v1/consultations/{consultationId}', '200', '#/components/schemas/ConsultationDetailResponseDto');
  const visit = responseSchema('get', '/v1/consultations/{consultationId}/visit', '200', '#/components/schemas/ConsultationVisitResponseDto');

  for (const field of ['id', 'quoteId', 'farmerId', 'vetId', 'animalId', 'serviceType', 'complaint', 'startsAt', 'endsAt', 'feeIdr', 'commissionIdr', 'amountIdr', 'currency', 'visitAddressSnapshot', 'consumed']) {
    assert.ok(quote[field], `ConsultationQuoteResponseDto is missing ${field}`);
  }
  for (const field of ['feeIdr', 'commissionIdr', 'amountIdr']) {
    assert.equal(quote[field].type, 'integer');
    assert.equal(quote[field].maximum, Number.MAX_SAFE_INTEGER);
  }
  assert.equal(quote.currency.enum[0], 'IDR');
  assert.equal(quote.visitAddressSnapshot.nullable, true);
  assert.equal(quote.visitAddressSnapshot.allOf?.[0]?.$ref ?? quote.visitAddressSnapshot.$ref, '#/components/schemas/ConsultationVisitAddressSnapshotResponseDto');

  const listFields = ['id', 'displayCode', 'farmerId', 'vetId', 'animalId', 'animalCode', 'animalName', 'species', 'serviceType', 'complaint', 'status', 'startsAt', 'endsAt', 'feeIdr', 'commissionIdr', 'feeAmountIdr', 'commissionAmountIdr', 'refundStatus', 'completedAt', 'rejectionReason', 'version', 'visitStage', 'paymentStatus'];
  for (const field of listFields) assert.ok(listItem[field], `ConsultationListItemResponseDto is missing ${field}`);
  assert.equal(listItem.feeIdr.type, 'string', 'The existing PostgreSQL bigint projection remains unchanged.');
  assert.equal(listItem.feeAmountIdr.type, 'integer');
  assert.equal(listItem.feeAmountIdr.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(listItem.commissionIdr.type, 'string');
  assert.equal(listItem.commissionAmountIdr.type, 'integer');
  assert.equal(listItem.completedAt.nullable, true);
  assert.equal(listItem.visitAddressSnapshot, undefined);
  assert.equal(listItem.completionAt, undefined);

  const detailFields = ['id', 'displayCode', 'farmerId', 'vetId', 'animalId', 'animalCode', 'animalName', 'species', 'serviceType', 'complaint', 'status', 'startsAt', 'endsAt', 'feeIdr', 'commissionIdr', 'feeAmountIdr', 'commissionAmountIdr', 'visitAddressSnapshot', 'completionAt', 'rejectionReason', 'refundStatus', 'reschedulePreviousStatus', 'version', 'visitStage', 'departureAt', 'arrivalAt', 'examinationStartedAt', 'visitCompletedAt', 'visitVersion', 'paymentStatus', 'proposals', 'actions'];
  for (const field of detailFields) assert.ok(detail[field], `ConsultationDetailResponseDto is missing ${field}`);
  assert.equal(detail.completionAt.nullable, true);
  assert.equal(detail.visitCompletedAt.nullable, true);
  assert.equal(detail.feeIdr.type, 'string');
  assert.equal(detail.feeAmountIdr.type, 'integer');
  assert.equal(detail.feeAmountIdr.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(detail.commissionIdr.type, 'string');
  assert.equal(detail.commissionAmountIdr.type, 'integer');
  assert.equal(detail.proposals.items.$ref, '#/components/schemas/ConsultationScheduleProposalResponseDto');
  assert.equal(detail.actions.items.$ref, '#/components/schemas/ConsultationActionAuditResponseDto');

  assert.deepEqual(visit.stage.enum, ['scheduled', 'en_route', 'arrived', 'examining', 'completed']);
  assert.equal(visit.updatedAt.format, 'date-time');
  assert.equal(visit.completedAt.nullable, true);

  const actionFields = Object.keys(created);
  assert.ok(actionFields.includes('operationId'));
  assert.ok(actionFields.includes('replayed'));
  assert.ok(actionFields.includes('consultation'));
  assert.equal(created.status, undefined, 'Action results do not invent a success/status field.');
  assert.equal(created.success, undefined, 'Action results do not invent a speculative success flag.');
  assert.equal(created.consultation.$ref, '#/components/schemas/ConsultationResponseDto');

  for (const [path, schemaName] of [
    ['/v1/consultations/{consultationId}/accept', 'ConsultationActionResponseDto'],
    ['/v1/consultations/{consultationId}/reject', 'ConsultationActionResponseDto'],
    ['/v1/consultations/{consultationId}/schedule-proposals', 'ConsultationScheduleProposalActionResponseDto'],
    ['/v1/consultations/{consultationId}/schedule-proposals/{proposalId}/respond', 'ConsultationScheduleProposalDecisionResponseDto'],
    ['/v1/consultations/{consultationId}/start', 'ConsultationActionResponseDto'],
    ['/v1/consultations/{consultationId}/visit/depart', 'ConsultationVisitActionResponseDto'],
    ['/v1/consultations/{consultationId}/visit/arrive', 'ConsultationVisitActionResponseDto'],
    ['/v1/consultations/{consultationId}/visit/start-examination', 'ConsultationVisitActionResponseDto'],
    ['/v1/consultations/{consultationId}/complete', 'ConsultationActionResponseDto'],
  ]) {
    const action = paths[path].post.responses['200'].content['application/json'].schema;
    assert.equal(action.$ref, `#/components/schemas/${schemaName}`, `POST ${path} response`);
    const properties = schemaProperties(openApi, action.$ref);
    for (const field of ['operationId', 'replayed', 'consultation']) assert.ok(properties[field], `${schemaName} is missing ${field}`);
    assert.equal(properties.success, undefined);
  }
  assert.ok(schemaProperties(openApi, '#/components/schemas/ConsultationScheduleProposalActionResponseDto').proposalId);
  assert.ok(schemaProperties(openApi, '#/components/schemas/ConsultationScheduleProposalDecisionResponseDto').decision);
  const visitAction = schemaProperties(openApi, '#/components/schemas/ConsultationVisitActionResponseDto');
  assert.ok(visitAction.visit);
  assert.equal(schemaProperties(openApi, '#/components/schemas/ConsultationVisitActionStateResponseDto').updatedAt, undefined);

  const statusFilter = paths['/v1/consultations'].get.parameters.find((parameter) => parameter.name === 'status');
  assert.deepEqual(statusFilter.schema.enum, ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress', 'completed', 'rejected', 'cancelled']);
});

test('BE-05 service list/detail keep bigint fields and expose safe integer IDR aliases', async () => {
  const listProjection = { id: '00000000-0000-4000-8000-000000000001', feeIdr: '95000', commissionIdr: '0' };
  const detailProjection = { id: listProjection.id, version: 1, feeIdr: '95000', commissionIdr: '0' };
  const database = {
    async query(sql) {
      if (sql.includes('AS "completedAt"')) return { rows: [listProjection] };
      if (sql.includes('AS "completionAt"')) return { rows: [detailProjection] };
      if (sql.includes('FROM consultation_schedule_proposals')) return { rows: [] };
      if (sql.includes('FROM consultation_actions')) return { rows: [] };
      throw new Error(`Unexpected consultation projection query: ${sql}`);
    },
  };
  const service = new ConsultationService(database, {}, {});
  const principal = { userId: '00000000-0000-4000-8000-000000000002', activeRole: 'farmer' };

  const list = await service.list(principal, {});
  assert.equal(list[0].feeIdr, '95000');
  assert.equal(list[0].commissionIdr, '0');
  assert.equal(list[0].feeAmountIdr, 95000);
  assert.equal(list[0].commissionAmountIdr, 0);

  const detail = await service.get(principal, listProjection.id);
  assert.equal(detail.feeIdr, '95000');
  assert.equal(detail.commissionIdr, '0');
  assert.equal(detail.feeAmountIdr, 95000);
  assert.equal(detail.commissionAmountIdr, 0);

  const unsafeDatabase = {
    async query() { return { rows: [{ ...listProjection, feeIdr: '9007199254740992' }] }; },
  };
  const unsafeService = new ConsultationService(unsafeDatabase, {}, {});
  await assert.rejects(unsafeService.list(principal, {}), (error) => {
    assert.equal(error.getStatus(), 400);
    assert.equal(error.getResponse().fieldErrors.feeIdr[0], 'Nominal harus berupa integer rupiah yang aman.');
    return true;
  });
});

test('unauthenticated API access returns the shared error envelope', async () => {
  const response = await fetch(`${baseUrl}/v1/me`);
  assert.equal(response.status, 401);
  const error = await response.json();
  assert.equal(error.code, 'UNAUTHENTICATED');
  assert.equal(typeof error.message, 'string');
  assert.equal(typeof error.requestId, 'string');
  assert.equal('stack' in error, false);
});

test('profile routes require the role named by their path', () => {
  for (const method of ['getFarmerProfile', 'patchFarmerProfile']) {
    assert.deepEqual(Reflect.getMetadata(AUTH_ROLES_KEY, ProfileController.prototype[method]), ['farmer']);
  }
  for (const method of ['getVetProfile', 'patchVetProfile']) {
    assert.deepEqual(Reflect.getMetadata(AUTH_ROLES_KEY, ProfileController.prototype[method]), ['vet']);
  }
});
