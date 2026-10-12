import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

const appPath = resolve(process.cwd(), 'dist/main.js');

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

async function startServer(port, overrides = {}) {
  const child = spawn(process.execPath, [appPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API process exited before startup:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/health/live`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {
      // Retry while NestJS is starting.
    }
    await delay(250);
  }
  child.kill('SIGKILL');
  throw new Error(`API process did not start:\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(5_000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const healthy = await startServer(await availablePort());
try {
  const liveResponse = await fetch(`${healthy.baseUrl}/v1/health/live`);
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.deepEqual(Object.keys(live).sort(), ['requestId', 'service', 'status', 'timestamp']);
  assert.equal(live.status, 'ok');
  assert.equal(live.service, 'vetlink-api');
  assert.equal(liveResponse.headers.get('x-request-id'), live.requestId);

  const readyResponse = await fetch(`${healthy.baseUrl}/v1/health/ready`);
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.deepEqual(ready.checks, { database: 'ok' });
  assert.equal(ready.status, 'ready');

  const openApiResponse = await fetch(`${healthy.baseUrl}/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json();
  assert.equal(openApi.openapi, '3.0.0');
  assert.ok(openApi.paths['/v1/health/live']);
  assert.ok(openApi.paths['/v1/health/ready']);
  assert.ok(openApi.components.schemas.ConsultationStatus);
  assert.ok(openApi.components.schemas.ApiErrorResponseDto);
  assert.ok(openApi.components.schemas.AdapterOperationResult);
  assert.ok(openApi.components.parameters.IdempotencyKey);
  assert.ok(openApi.components.schemas.CursorPageRequest);
} finally {
  await stopServer(healthy.child);
}

const unavailable = await startServer(await availablePort(), { DATABASE_PORT: '1' });
try {
  const liveResponse = await fetch(`${unavailable.baseUrl}/v1/health/live`);
  assert.equal(liveResponse.status, 200);

  const readyResponse = await fetch(`${unavailable.baseUrl}/v1/health/ready`);
  assert.equal(readyResponse.status, 503);
  const error = await readyResponse.json();
  assert.equal(error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(error.message, 'Service is not ready');
  assert.ok(error.requestId);
  assert.equal('stack' in error, false);
  assert.equal(readyResponse.headers.get('x-request-id'), error.requestId);
} finally {
  await stopServer(unavailable.child);
}

console.log('API smoke selesai: health live/ready, OpenAPI, dan error 503 tervalidasi.');
