import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

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

test('unauthenticated API access returns the shared error envelope', async () => {
  const response = await fetch(`${baseUrl}/v1/me`);
  assert.equal(response.status, 401);
  const error = await response.json();
  assert.equal(error.code, 'UNAUTHENTICATED');
  assert.equal(typeof error.message, 'string');
  assert.equal(typeof error.requestId, 'string');
  assert.equal('stack' in error, false);
});
