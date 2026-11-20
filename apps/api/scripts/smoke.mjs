import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { DatabaseService } from '../dist/database/database.service.js';
import { adapterFailed, adapterPending, adapterSucceeded } from '../dist/communication/adapter-result.js';
import { PostgresConsultationActionAdapter } from '../dist/consultation/consultation-action.adapter.js';
import { ConsultationService } from '../dist/consultation/consultation.service.js';
import { LocalPaymentService } from '../dist/payment/payment.adapter.js';
import { PaymentsService } from '../dist/payment/payment.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
import { LocalCheckoutShippingAdapter } from '../dist/commerce/shipping-quote.adapter.js';
import { LocalShipmentAdapter } from '../dist/commerce/shipment.adapter.js';
import { ShipmentService } from '../dist/commerce/shipment.service.js';
import { EarningsService } from '../dist/earnings/earnings.service.js';
import { LocalEarningSettlementAdapter, LocalWithdrawalSubmissionAdapter } from '../dist/earnings/earnings.adapter.js';

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

async function startServerWithRetry(overrides = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await startServer(await availablePort(), overrides);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`API smoke server failed to start after three fresh ports: ${lastError?.message ?? 'unknown startup error'}`);
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

async function registerSmokeUser(baseUrl, role, fullName) {
  const response = await fetch(`${baseUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `be07-${randomUUID()}@example.invalid`,
      fullName,
      password: 'smoke-only-password-not-secret',
      role,
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function loginSmokeUser(baseUrl, email, role) {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'smoke-only-password-not-secret', activeRole: role }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function sendJson(baseUrl, path, accessToken, method, body, extraHeaders = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function uploadBody(consultationId, bytes, mimeType, filename) {
  const form = new FormData();
  form.set('consultationId', consultationId);
  form.set('file', new Blob([bytes], { type: mimeType }), filename);
  return form;
}

const smokeMediaDirectory = await mkdtemp(join(tmpdir(), 'vetlink-be07-smoke-'));
const healthy = await startServer(await availablePort(), {
  MEDIA_STORAGE_DIR: smokeMediaDirectory,
  MEDIA_IMAGE_MAX_BYTES: String(10 * 1024 * 1024),
  MEDIA_VIDEO_MAX_BYTES: String(50 * 1024 * 1024),
  CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'true',
  REMINDER_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'true',
  NOTIFICATION_DELIVERY_TEST_FAIL_FIRST_ATTEMPT: 'true',
});
try {
  const liveResponse = await fetch(`${healthy.baseUrl}/v1/health/live`);
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.deepEqual(Object.keys(live).sort(), ['requestId', 'service', 'status', 'timestamp']);
  assert.equal(live.status, 'ok');
  assert.equal(live.service, 'vetlink-api');
  assert.equal(liveResponse.headers.get('x-request-id'), live.requestId);

  const readyResponse = await fetch(`${healthy.baseUrl}/v1/health/ready`);
  if (readyResponse.status === 200) {
    const ready = await readyResponse.json();
    assert.deepEqual(ready.checks, { database: 'ok' });
    assert.equal(ready.status, 'ready');
  } else {
    assert.equal(readyResponse.status, 503);
    const unavailable = await readyResponse.json();
    assert.equal(unavailable.code, 'SERVICE_UNAVAILABLE');
    assert.equal(unavailable.message, 'Service is not ready');
    assert.ok(unavailable.requestId);
  }

  const openApiResponse = await fetch(`${healthy.baseUrl}/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = await openApiResponse.json();
  assert.equal(openApi.openapi, '3.0.0');
  assert.ok(openApi.paths['/v1/health/live']);
  assert.ok(openApi.paths['/v1/health/ready']);
  assert.ok(openApi.paths['/v1/auth/register']?.post);
  assert.ok(openApi.paths['/v1/auth/login']?.post);
  assert.ok(openApi.paths['/v1/auth/active-role']?.post);
  assert.ok(openApi.paths['/v1/auth/logout']?.post);
  assert.ok(openApi.paths['/v1/auth/refresh']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset/confirm']?.post);
  assert.ok(openApi.paths['/v1/payments']?.get);
  assert.ok(openApi.paths['/v1/payments/{id}']?.get);
  assert.ok(openApi.paths['/v1/payments/{id}/attempts']?.get);
  assert.ok(openApi.paths['/v1/me']?.get);
  assert.ok(openApi.paths['/v1/products']?.get);
  assert.ok(openApi.paths['/v1/products/{id}']?.get);
  assert.ok(openApi.paths['/v1/me/cart']?.get);
  assert.ok(openApi.paths['/v1/me/cart/items/{productId}']?.put);
  assert.ok(openApi.paths['/v1/me/cart/items/{productId}']?.delete);
  assert.ok(openApi.paths['/v1/checkout-quotes']?.post);
  assert.ok(openApi.paths['/v1/orders']?.post);
  assert.ok(openApi.paths['/v1/orders']?.get);
  assert.ok(openApi.paths['/v1/orders/{id}']?.get);
  assert.ok(openApi.paths['/v1/orders/{id}/shipment']?.get);
  assert.equal(openApi.paths['/v1/internal/products'], undefined);
  assert.equal(openApi.paths['/v1/products']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProductPageResponseDto');
  assert.equal(openApi.paths['/v1/products/{id}']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProductResponseDto');
  assert.ok(openApi.paths['/v1/products']?.get?.parameters?.some((parameter) => parameter.name === 'maxPrice'));
  assert.ok(openApi.paths['/v1/vets']?.get);
  assert.ok(openApi.paths['/v1/vets/page']?.get);
  assert.ok(openApi.paths['/v1/vets/{id}']?.get);
  assert.ok(openApi.paths['/v1/vets/{id}/slots']?.get);
  assert.ok(openApi.paths['/v1/me/farms/{id}']?.get);
  assert.ok(openApi.paths['/v1/me/addresses/{id}']?.get);
  assert.ok(openApi.paths['/v1/livestock/page']?.get);
  assert.equal(openApi.paths['/v1/me/farms']?.get?.responses?.['200']?.content?.['application/json']?.schema?.items?.$ref, '#/components/schemas/FarmResponseDto');
  assert.equal(openApi.paths['/v1/me/addresses/{id}']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/AddressResponseDto');
  assert.equal(openApi.paths['/v1/livestock/page']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/LivestockPageResponseDto');
  assert.equal(openApi.paths['/v1/vets/page']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/VetDirectoryPageResponseDto');
  assert.ok(openApi.paths['/v1/me/vet/availability']?.put);
  assert.ok(openApi.paths['/v1/me/vet/blocked-times']?.post);
  assert.ok(openApi.paths['/v1/me/vet/earnings']?.get);
  assert.ok(openApi.paths['/v1/me/vet/transactions/{id}']?.get);
  assert.ok(openApi.paths['/v1/me/vet/payout-destinations']?.get);
  assert.ok(openApi.paths['/v1/me/vet/withdrawals']?.get);
  assert.ok(openApi.paths['/v1/me/vet/withdrawals']?.post);
  assert.ok(openApi.paths['/v1/me/vet/withdrawals/{id}']?.get);
  assert.deepEqual(openApi.components.schemas.WithdrawalStatus.enum, ['submitting', 'submitted', 'processing', 'paid', 'rejected', 'failed']);
  assert.ok(openApi.paths['/v1/consultation-quotes']?.post);
  assert.ok(openApi.paths['/v1/consultations']?.post);
  assert.ok(openApi.paths['/v1/consultations']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/accept']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/cancel']?.post);
  assert.ok(openApi.components.schemas.ConsultationResponseDto.properties.cancellationReason);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/schedule-proposals/{proposalId}/respond']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/visit/depart']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/complete']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/review']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/review']?.post);
  assert.ok(openApi.paths['/v1/vets/{id}/reviews']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/follow-ups']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/follow-ups']?.post);
  assert.ok(openApi.paths['/v1/follow-ups/{followUpId}']?.get);
  assert.ok(openApi.paths['/v1/follow-ups/{followUpId}']?.patch);
  assert.ok(openApi.paths['/v1/follow-ups/{followUpId}/progress-reports']?.get);
  assert.ok(openApi.paths['/v1/follow-ups/{followUpId}/progress-reports']?.post);
  assert.ok(openApi.paths['/v1/progress-reports/{reportId}']?.get);
  assert.ok(openApi.paths['/v1/reminders']?.get);
  assert.ok(openApi.paths['/v1/reminders']?.post);
  assert.ok(openApi.paths['/v1/reminders/{reminderId}']?.get);
  assert.ok(openApi.paths['/v1/reminders/{reminderId}']?.patch);
  assert.ok(openApi.paths['/v1/reminders/{reminderId}/complete']?.post);
  assert.ok(openApi.paths['/v1/me/notifications']?.get);
  assert.ok(openApi.paths['/v1/me/notifications/{id}/read']?.post);
  assert.ok(openApi.paths['/v1/me/preferences']?.get);
  assert.ok(openApi.paths['/v1/me/preferences']?.patch);
  assert.ok(openApi.paths['/v1/attachments/uploads']?.post);
  assert.ok(openApi.paths['/v1/attachments/{id}/commit']?.post);
  assert.ok(openApi.paths['/v1/attachments/{id}/content']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/messages/{messageId}/retry']?.post);
  assert.ok(openApi.components.schemas.ConsultationStatus);
  assert.ok(openApi.components.schemas.ApiErrorResponseDto);
  assert.ok(openApi.components.schemas.AdapterOperationResult);
  assert.ok(openApi.components.parameters.IdempotencyKey);
  assert.ok(openApi.components.schemas.CursorPageRequest);

  const unauthenticatedResponse = await fetch(`${healthy.baseUrl}/v1/me`);
  assert.equal(unauthenticatedResponse.status, 401);
  const unauthenticated = await unauthenticatedResponse.json();
  assert.equal(unauthenticated.code, 'UNAUTHENTICATED');
  assert.ok(unauthenticated.requestId);
  assert.equal('stack' in unauthenticated, false);
  const unauthenticatedRoleSwitch = await fetch(`${healthy.baseUrl}/v1/auth/active-role`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ activeRole: 'farmer' }),
  });
  assert.equal(unauthenticatedRoleSwitch.status, 401);

  const smokePassword = 'smoke-only-password-not-secret';
  const loginResponses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    loginResponses.push(await fetch(`${healthy.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'absent-login@example.invalid',
        password: smokePassword,
        activeRole: 'farmer',
      }),
    }));
  }
  for (const response of loginResponses.slice(0, 5)) {
    assert.ok([401, 503].includes(response.status), `Unexpected login status sequence: ${loginResponses.map((item) => item.status).join(',')}`);
  }
  assert.equal(loginResponses[5].status, 429);
  assert.ok(Number(loginResponses[5].headers.get('retry-after')) > 0);
  const rateLimited = await loginResponses[5].json();
  assert.equal(rateLimited.code, 'RATE_LIMITED');
  assert.equal(healthy.output().includes(smokePassword), false);

  const resetResponse = await fetch(`${healthy.baseUrl}/v1/auth/password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'absent@example.invalid' }),
  });
  assert.equal(resetResponse.status, 202);
  const reset = await resetResponse.json();
  assert.deepEqual(reset, { message: 'Jika akun terdaftar, instruksi reset akan dikirim.' });
  assert.equal('token' in reset, false);

  if (readyResponse.status === 200) {
    const database = new Pool({
      host: process.env.DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'true',
    });
    const actors = [];
    const consultationIds = [];
    const quoteIds = [];
    const checkoutQuoteIds = [];
    const orderIds = [];
    const addressIds = [];
    const productIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const localDb = new DatabaseService();
    const earnings = new EarningsService(localDb, new LocalEarningSettlementAdapter('pending'), new LocalWithdrawalSubmissionAdapter());
    const workflow = new ConsultationService(localDb, new PostgresConsultationActionAdapter(), earnings);
    const shipments = new ShipmentService(localDb, new LocalShipmentAdapter());
    const commerce = new CommerceService(localDb, new LocalCheckoutShippingAdapter(), shipments);
    const localPayment = new PaymentsService(localDb, new LocalPaymentService(), workflow, commerce, shipments);
    let consultationId;
    let unpaidConsultationId;
    let failedStorageServer;
    try {
      const farmer = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Fiktif BE-07');
      const farmerDeviceB = await loginSmokeUser(healthy.baseUrl, farmer.user.email, 'farmer');
      const vet = await registerSmokeUser(healthy.baseUrl, 'vet', 'Dokter Fiktif BE-07');
      const vetDeviceB = await loginSmokeUser(healthy.baseUrl, vet.user.email, 'vet');
      const outsider = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Lain Fiktif BE-07');
      const unverifiedVet = await registerSmokeUser(healthy.baseUrl, 'vet', 'Dokter Belum Terverifikasi BE-04');
      const directoryVetBeta = await registerSmokeUser(healthy.baseUrl, 'vet', 'BE16 Dokter Beta Fiktif');
      actors.push(farmer.user.id, vet.user.id, outsider.user.id, unverifiedVet.user.id, directoryVetBeta.user.id);
      assert.notEqual(farmer.sessionId, farmerDeviceB.sessionId);
      assert.notEqual(vet.sessionId, vetDeviceB.sessionId);
      const documentKey = `be16-document-${randomUUID()}`;
      const documentBody = (content = '%PDF-fiktif') => {
        const form = new FormData();
        form.set('file', new Blob([content], { type: 'application/pdf' }), 'dokumen-fiktif.pdf');
        return form;
      };
      const uploadDocument = (token, key, body) => fetch(`${healthy.baseUrl}/v1/me/vet/professional-documents`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body,
      });
      assert.equal((await uploadDocument(vet.accessToken, '', documentBody())).status, 422);
      assert.equal((await uploadDocument(farmer.accessToken, documentKey, documentBody())).status, 403);
      const firstDocumentResponse = await uploadDocument(vet.accessToken, documentKey, documentBody());
      assert.equal(firstDocumentResponse.status, 201, await firstDocumentResponse.clone().text());
      const firstDocument = await firstDocumentResponse.json();
      const replayDocumentResponse = await uploadDocument(vetDeviceB.accessToken, documentKey, documentBody());
      assert.equal(replayDocumentResponse.status, 201, await replayDocumentResponse.clone().text());
      assert.deepEqual(await replayDocumentResponse.json(), firstDocument);
      const changedDocumentResponse = await uploadDocument(vet.accessToken, documentKey, documentBody('%PDF-berbeda'));
      assert.equal(changedDocumentResponse.status, 409);
      assert.equal((await changedDocumentResponse.json()).code, 'IDEMPOTENCY_CONFLICT');
      const documentCount = await database.query('SELECT count(*)::integer AS count FROM professional_documents WHERE owner_id=$1 AND upload_key=$2', [vet.user.id,documentKey]);
      assert.equal(documentCount.rows[0].count, 1);
      const parallelDocumentKey = `be16-document-parallel-${randomUUID()}`;
      const parallelDocuments = await Promise.all([
        uploadDocument(vet.accessToken, parallelDocumentKey, documentBody()),
        uploadDocument(vetDeviceB.accessToken, parallelDocumentKey, documentBody()),
      ]);
      for (const response of parallelDocuments) assert.equal(response.status, 201, await response.clone().text());
      assert.deepEqual(await parallelDocuments[0].json(), await parallelDocuments[1].json());
      const parallelDocumentCount = await database.query('SELECT count(*)::integer AS count FROM professional_documents WHERE owner_id=$1 AND upload_key=$2', [vet.user.id,parallelDocumentKey]);
      assert.equal(parallelDocumentCount.rows[0].count, 1);
      const [farmerDeviceAMe, farmerDeviceBMe] = await Promise.all([
        sendJson(healthy.baseUrl, '/v1/me', farmer.accessToken, 'GET'),
        sendJson(healthy.baseUrl, '/v1/me', farmerDeviceB.accessToken, 'GET'),
      ]);
      assert.equal(farmerDeviceAMe.status, 200);
      assert.equal(farmerDeviceBMe.status, 200);
      const farmerSessions = await Promise.all([farmerDeviceAMe.json(), farmerDeviceBMe.json()]);
      assert.equal(farmerSessions[0].id, farmerSessions[1].id);
      assert.notEqual(farmerSessions[0].sessionId, farmerSessions[1].sessionId);
      const payoutDestinationId = randomUUID();
      await database.query(
        `INSERT INTO payout_destinations(id,vet_id,label,bank_label,account_masked,account_holder)
         VALUES($1,$2,'Tujuan Pencairan Fiktif','Bank Contoh','•••• 4567','Dokter Fiktif')`,
        [payoutDestinationId, vet.user.id],
      );
      const initialEarningsResponse = await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET');
      assert.equal(initialEarningsResponse.status, 200);
      const initialEarnings = await initialEarningsResponse.json();
      assert.deepEqual(initialEarnings.balances, { pending: 0, available: 0, reserved: 0, paidOut: 0 });
      assert.deepEqual(initialEarnings.transactions, []);
      assert.equal(initialEarnings.destinations[0].accountMasked, '•••• 4567');
      assert.equal('accountNumber' in initialEarnings.destinations[0], false);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', farmer.accessToken, 'GET')).status, 403);
      assert.deepEqual(await (await sendJson(healthy.baseUrl, '/v1/me/vet/payout-destinations', unverifiedVet.accessToken, 'GET')).json(), { items: [] });

      const catalogFixtures = [
        [productIds[0], 'BE-10 Sikat Kandang Seruni', 'perawatan', ['sapi', 'kambing'], 'Produk perawatan fiktif.', 18500, true],
        [productIds[1], 'BE-10 Sikat Kandang Pesisir', 'perawatan', ['sapi'], 'Produk perawatan fiktif kedua.', 19500, true],
        [productIds[2], 'BE-10 Pakan Fiktif Sapi', 'pakan', ['sapi'], 'Produk pakan fiktif.', 10000, true],
        [productIds[3], 'BE-10 Sikat Kandang Nonaktif', 'perawatan', ['sapi'], 'Produk katalog fiktif nonaktif.', 19000, false],
      ];
      for (const [id, name, category, species, description, price, active] of catalogFixtures) {
        await database.query(
          `INSERT INTO products (id, name, category, species, description, unit_price_idr, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, name, category, species, description, price, active],
        );
      }
      const catalogSearch = await sendJson(healthy.baseUrl,
        '/v1/products?name=BE-10%20Sikat&category=perawatan&species=sapi&minPrice=18000&maxPrice=20000&limit=1',
        farmer.accessToken, 'GET');
      assert.equal(catalogSearch.status, 200, await catalogSearch.clone().text());
      const catalogPageOne = await catalogSearch.json();
      assert.equal(catalogPageOne.items.length, 1);
      assert.equal(catalogPageOne.hasMore, true);
      assert.equal(catalogPageOne.items[0].active, true);
      assert.equal(catalogPageOne.items[0].unitPriceIdr, 19500);
      assert.ok(catalogPageOne.nextCursor);
      const catalogPageTwoResponse = await sendJson(healthy.baseUrl,
        `/v1/products?name=BE-10%20Sikat&category=perawatan&species=sapi&minPrice=18000&maxPrice=20000&limit=1&cursor=${encodeURIComponent(catalogPageOne.nextCursor)}`,
        farmer.accessToken, 'GET');
      assert.equal(catalogPageTwoResponse.status, 200, await catalogPageTwoResponse.clone().text());
      const catalogPageTwo = await catalogPageTwoResponse.json();
      assert.equal(catalogPageTwo.items.length, 1);
      assert.equal(catalogPageTwo.hasMore, false);
      assert.notEqual(catalogPageTwo.items[0].id, catalogPageOne.items[0].id);
      assert.equal(catalogPageTwo.items[0].unitPriceIdr, 18500);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/products/${productIds[0]}`, farmer.accessToken, 'GET')).status, 200);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/products/${productIds[3]}`, farmer.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/products?minPrice=20000&maxPrice=10000', farmer.accessToken, 'GET')).status, 400);
      const vetCatalog = await sendJson(healthy.baseUrl, '/v1/products?name=BE-10%20Sikat&limit=10', vet.accessToken, 'GET');
      assert.equal(vetCatalog.status, 200);
      assert.ok((await vetCatalog.json()).items.every((product) => product.active));

      // BE-04 directory fixture is explicitly verified by this test setup, never by a vet-facing API.
      await database.query("UPDATE vet_profiles SET verification_status='verified',professional_name='Dokter Uji Fiktif BE-04' WHERE user_id=$1",[vet.user.id]);
      await database.query("UPDATE vet_profiles SET verification_status='verified',professional_name='BE16 Dokter Beta Fiktif' WHERE user_id=$1",[directoryVetBeta.user.id]);
      const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+48*60*60*1000));
      const weekday = Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',weekday:'short'}).format(new Date(`${localDate}T12:00:00+07:00`)).replace(/^Sun$/,'0').replace(/^Mon$/,'1').replace(/^Tue$/,'2').replace(/^Wed$/,'3').replace(/^Thu$/,'4').replace(/^Fri$/,'5').replace(/^Sat$/,'6'));
      const availBody={expectedVersion:1,acceptingNewRequests:true,services:['chat','visit'],timezone:'Asia/Jakarta',weekdayRules:[{weekday,start:'00:00',end:'23:59'}],chatDurationMinutes:60,visitDurationMinutes:60,rates:{chat:125000,visit:400000},experienceYears:7,specialties:['hewan besar'],species:['sapi'],practiceLocation:'Bogor',serviceAreas:['Bogor']};
      const savedAvailability=await sendJson(healthy.baseUrl,'/v1/me/vet/availability',vet.accessToken,'PUT',availBody);
      assert.equal(savedAvailability.status,200);
      const availabilityResult=await savedAvailability.json();
      assert.equal(availabilityResult.status,'succeeded');
      assert.equal(Number(availabilityResult.value.rates.chat),125000);
      const directoryAvailability = await sendJson(healthy.baseUrl,'/v1/me/vet/availability',directoryVetBeta.accessToken,'PUT',availBody);
      assert.equal(directoryAvailability.status,200,await directoryAvailability.clone().text());
      const filteredDirectory=await sendJson(healthy.baseUrl,'/v1/vets?name=Uji&species=sapi&service=chat&location=Bogor&available=true&minFee=100000&maxFee=130000',farmer.accessToken,'GET');
      assert.equal(filteredDirectory.status,200);
      assert.deepEqual((await filteredDirectory.json()).map(x=>x.id),[vet.user.id]);
      const selectedServiceRate=await sendJson(healthy.baseUrl,'/v1/vets?service=visit&minFee=100000&maxFee=130000',farmer.accessToken,'GET');
      assert.deepEqual(await selectedServiceRate.json(),[]);
      const rateGap=await sendJson(healthy.baseUrl,'/v1/vets?minFee=200000&maxFee=300000',farmer.accessToken,'GET');
      assert.deepEqual(await rateGap.json(),[]);
      const pendingDirectory=await sendJson(healthy.baseUrl,'/v1/vets?name=Belum%20Terverifikasi',outsider.accessToken,'GET');
      assert.equal(pendingDirectory.status,200);
      assert.deepEqual(await pendingDirectory.json(),[]);
      await database.query("UPDATE vet_profiles SET professional_name='BE16 Dokter Alpha Fiktif' WHERE user_id=$1",[vet.user.id]);
      const directoryPageOneResponse = await sendJson(healthy.baseUrl,'/v1/vets/page?name=BE16&limit=1',farmer.accessToken,'GET');
      assert.equal(directoryPageOneResponse.status,200,await directoryPageOneResponse.clone().text());
      const directoryPageOne = await directoryPageOneResponse.json();
      assert.equal(directoryPageOne.items.length,1);
      assert.equal(directoryPageOne.items[0].id,vet.user.id);
      assert.equal(directoryPageOne.items[0].professionalName,'BE16 Dokter Alpha Fiktif');
      assert.equal(directoryPageOne.items[0].minFeeIdr,125000);
      assert.ok(Number.isSafeInteger(directoryPageOne.items[0].minFeeIdr));
      assert.ok(Number.isSafeInteger(directoryPageOne.items[0].fees.chat));
      assert.equal(directoryPageOne.hasMore,true);
      assert.ok(directoryPageOne.nextCursor);
      assert.throws(() => JSON.parse(directoryPageOne.nextCursor));
      assert.equal(directoryPageOne.nextCursor.includes(vet.user.id),false);
      const directoryPageTwoResponse = await sendJson(healthy.baseUrl,
        `/v1/vets/page?name=BE16&limit=1&cursor=${encodeURIComponent(directoryPageOne.nextCursor)}`,farmer.accessToken,'GET');
      assert.equal(directoryPageTwoResponse.status,200,await directoryPageTwoResponse.clone().text());
      const directoryPageTwo = await directoryPageTwoResponse.json();
      assert.deepEqual(directoryPageTwo.items.map((item)=>item.id),[directoryVetBeta.user.id]);
      assert.equal(directoryPageTwo.hasMore,false);
      assert.equal(directoryPageTwo.nextCursor,null);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/vets/page?name=changed&limit=1&cursor=${encodeURIComponent(directoryPageOne.nextCursor)}`,farmer.accessToken,'GET')).status,400);
      assert.equal((await sendJson(healthy.baseUrl,'/v1/vets/page?cursor=not-a-cursor',farmer.accessToken,'GET')).status,400);
      const directoryLegacy = await sendJson(healthy.baseUrl,'/v1/vets?name=BE16',farmer.accessToken,'GET');
      assert.equal(directoryLegacy.status,200);
      assert.deepEqual((await directoryLegacy.json()).map((item)=>item.id).sort(),[vet.user.id,directoryVetBeta.user.id].sort(),'Legacy directory route remains an array with the same records.');
      const slotResponse=await sendJson(healthy.baseUrl,`/v1/vets/${vet.user.id}/slots?dateFrom=${localDate}&dateTo=${localDate}&service=chat`,farmer.accessToken,'GET');
      assert.equal(slotResponse.status,200,`${await slotResponse.clone().text()}\n${healthy.output()}`);
      const availableSlots=await slotResponse.json();
      assert.ok(availableSlots.length>0);
      assert.deepEqual(Object.keys(availableSlots[0]).sort(),['endsAt','startsAt']);
      assert.ok(availableSlots.every((slot)=>Number.isFinite(Date.parse(slot.startsAt))&&Number.isFinite(Date.parse(slot.endsAt))));
      assert.ok(availableSlots.every(s=>Date.parse(s.startsAt)<Date.parse(s.endsAt)));
      assert.ok(availableSlots.every(s=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.startsAt))===localDate));
      const blockedStart=`${localDate}T12:00:00+07:00`,blockedEnd=`${localDate}T13:00:00+07:00`;
      const blockedResponse=await sendJson(healthy.baseUrl,'/v1/me/vet/blocked-times',vet.accessToken,'POST',{startsAt:blockedStart,endsAt:blockedEnd,reason:'Jadwal pribadi fiktif'});
      assert.equal(blockedResponse.status,201);
      const blocked=await blockedResponse.json();
      const adjacentBlock=await sendJson(healthy.baseUrl,'/v1/me/vet/blocked-times',vet.accessToken,'POST',{startsAt:blockedEnd,endsAt:`${localDate}T14:00:00+07:00`,reason:'Blokir bersebelahan fiktif'});
      assert.equal(adjacentBlock.status,201);
      const adjacent=await adjacentBlock.json();
      const farmerBlocked=await sendJson(healthy.baseUrl,'/v1/me/vet/blocked-times',farmer.accessToken,'GET');
      assert.equal(farmerBlocked.status,403);
      const cancelAdjacent=await sendJson(healthy.baseUrl,`/v1/me/vet/blocked-times/${adjacent.value.id}?expectedVersion=1`,vet.accessToken,'DELETE');
      assert.equal(cancelAdjacent.status,200);
      assert.equal((await cancelAdjacent.json()).status,'cancelled');
      const overlappingBlock=await sendJson(healthy.baseUrl,'/v1/me/vet/blocked-times',vet.accessToken,'POST',{startsAt:`${localDate}T12:30:00+07:00`,endsAt:`${localDate}T13:30:00+07:00`,reason:'Blokir overlap fiktif'});
      assert.equal(overlappingBlock.status,409);
      const afterBlock=await (await sendJson(healthy.baseUrl,`/v1/vets/${vet.user.id}/slots?dateFrom=${localDate}&dateTo=${localDate}&service=chat`,farmer.accessToken,'GET')).json();
      assert.ok(!afterBlock.some(s=>Date.parse(s.startsAt)<Date.parse(blocked.value.endsAt)&&Date.parse(s.endsAt)>Date.parse(blocked.value.startsAt)));
      const farmId = randomUUID();
      const animalId = randomUUID();
      consultationId = randomUUID();
      consultationIds.push(consultationId);
      await database.query(
        `INSERT INTO farms (id, owner_id, name, species, timezone)
         VALUES ($1, $2, 'Farm Fiktif BE-07', ARRAY['sapi'], 'Asia/Jakarta')`,
        [farmId, farmer.user.id],
      );
      const secondFarmResponse = await sendJson(healthy.baseUrl, '/v1/me/farms', farmerDeviceB.accessToken, 'POST', {
        name: 'Farm Kedua Fiktif BE-16', species: ['kambing'], timezone: 'Asia/Jakarta',
      });
      assert.equal(secondFarmResponse.status, 201, await secondFarmResponse.clone().text());
      const secondFarm = await secondFarmResponse.json();
      const [farmerFarmsAResponse, farmerFarmsBResponse] = await Promise.all([
        sendJson(healthy.baseUrl, '/v1/me/farms', farmer.accessToken, 'GET'),
        sendJson(healthy.baseUrl, '/v1/me/farms', farmerDeviceB.accessToken, 'GET'),
      ]);
      assert.equal(farmerFarmsAResponse.status, 200);
      assert.equal(farmerFarmsBResponse.status, 200);
      const [farmerFarmsA, farmerFarmsB] = await Promise.all([farmerFarmsAResponse.json(), farmerFarmsBResponse.json()]);
      assert.deepEqual(farmerFarmsA.map((farm) => farm.id).sort(), [farmId, secondFarm.id].sort());
      assert.deepEqual(farmerFarmsB.map((farm) => farm.id).sort(), [farmId, secondFarm.id].sort());
      const listedFarm = farmerFarmsA.find((farm) => farm.id === farmId);
      assert.equal(listedFarm.name,'Farm Fiktif BE-07');
      assert.equal(listedFarm.visitAddressId,null);
      assert.equal(typeof listedFarm.createdAt,'string');
      assert.ok(Number.isFinite(Date.parse(listedFarm.createdAt)));
      assert.equal(listedFarm.version,1);
      assert.equal('owner_id' in listedFarm,false);
      const farmDetail = await sendJson(healthy.baseUrl,`/v1/me/farms/${farmId}`,farmer.accessToken,'GET');
      assert.equal(farmDetail.status,200);
      assert.deepEqual(await farmDetail.json(),listedFarm);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/me/farms/${farmId}`,outsider.accessToken,'GET')).status,404);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/me/farms/${farmId}`,vet.accessToken,'GET')).status,403);
      assert.equal((await sendJson(healthy.baseUrl,'/v1/me/farms',vet.accessToken,'GET')).status,403);
      const foreignFarmUpdate = await sendJson(healthy.baseUrl, `/v1/me/farms/${farmId}`, outsider.accessToken, 'PATCH', {
        expectedVersion: 1, name: 'Farm milik akun lain tidak boleh berubah',
      });
      assert.equal(foreignFarmUpdate.status, 404);
      const addressResponse = await sendJson(healthy.baseUrl, '/v1/me/addresses', farmer.accessToken, 'POST', {
        label: 'Kandang Budi Fiktif', recipientName: 'Budi Fiktif', phone: '081234567899',
        addressLine: 'Jalan Ternak Fiktif Nomor 11', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
      });
      assert.equal(addressResponse.status, 201, await addressResponse.clone().text());
      const checkoutAddress = await addressResponse.json();
      addressIds.push(checkoutAddress.id);
      assert.equal(checkoutAddress.addressLine,'Jalan Ternak Fiktif Nomor 11');
      assert.equal(checkoutAddress.latitude,null);
      assert.equal(checkoutAddress.longitude,null);
      assert.equal(typeof checkoutAddress.createdAt,'string');
      assert.ok(Number.isFinite(Date.parse(checkoutAddress.createdAt)));
      assert.equal('owner_id' in checkoutAddress,false);
      const addressDetail = await sendJson(healthy.baseUrl,`/v1/me/addresses/${checkoutAddress.id}`,farmer.accessToken,'GET');
      assert.equal(addressDetail.status,200);
      assert.deepEqual(await addressDetail.json(),checkoutAddress);
      const addressList = await sendJson(healthy.baseUrl,'/v1/me/addresses',farmerDeviceB.accessToken,'GET');
      assert.equal(addressList.status,200);
      assert.deepEqual((await addressList.json()).map((item)=>item.id),[checkoutAddress.id]);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/me/addresses/${checkoutAddress.id}`,outsider.accessToken,'GET')).status,404);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/me/addresses/${checkoutAddress.id}`,vet.accessToken,'GET')).status,403);
      assert.equal((await sendJson(healthy.baseUrl,'/v1/me/addresses',vet.accessToken,'GET')).status,403);
      const checkoutFarmLink = await sendJson(healthy.baseUrl, `/v1/me/farms/${farmId}`, farmer.accessToken, 'PATCH', {
        expectedVersion: 1, name: 'Farm Fiktif BE-11', visitAddressId: checkoutAddress.id,
      });
      assert.equal(checkoutFarmLink.status, 200, await checkoutFarmLink.clone().text());
      await database.query(
        `INSERT INTO livestock (id, farmer_id, farm_id, display_code, name, species, sex)
         VALUES ($1, $2, $3, 'BE07-001', 'Ternak Fiktif BE-07', 'sapi', 'female')`,
        [animalId, farmer.user.id, farmId],
      );

      assert.equal((await sendJson(healthy.baseUrl, '/v1/me/cart', vet.accessToken, 'GET')).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/checkout-quotes', vet.accessToken, 'POST', { addressId: checkoutAddress.id })).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/orders', vet.accessToken, 'POST', { quoteId: randomUUID() }, { 'idempotency-key': `be11-vet-${randomUUID()}` })).status, 403);
      const emptyCartResponse = await sendJson(healthy.baseUrl, '/v1/me/cart', farmer.accessToken, 'GET');
      assert.equal(emptyCartResponse.status, 200);
      const emptyCart = await emptyCartResponse.json();
      assert.equal(emptyCart.items.length, 0);
      const emptyQuote = await sendJson(healthy.baseUrl, '/v1/checkout-quotes', farmer.accessToken, 'POST', { addressId: checkoutAddress.id });
      assert.equal(emptyQuote.status, 422);
      const zeroQuantity = await sendJson(healthy.baseUrl, `/v1/me/cart/items/${productIds[0]}`, farmer.accessToken, 'PUT', {
        expectedVersion: emptyCart.version, quantity: 0,
      });
      assert.equal(zeroQuantity.status, 400);
      const addFirstProduct = await sendJson(healthy.baseUrl, `/v1/me/cart/items/${productIds[0]}`, farmer.accessToken, 'PUT', {
        expectedVersion: emptyCart.version, quantity: 2,
      });
      assert.equal(addFirstProduct.status, 200, await addFirstProduct.clone().text());
      const cartAfterFirst = await addFirstProduct.json();
      assert.equal(cartAfterFirst.items[0].quantity, 2);
      assert.equal(cartAfterFirst.items[0].unitPriceIdr, 18500);
      const addSecondProduct = await sendJson(healthy.baseUrl, `/v1/me/cart/items/${productIds[1]}`, farmer.accessToken, 'PUT', {
        expectedVersion: cartAfterFirst.version, quantity: 1,
      });
      assert.equal(addSecondProduct.status, 200, await addSecondProduct.clone().text());
      let cartForCheckout = await addSecondProduct.json();
      assert.equal(cartForCheckout.subtotalIdr, 56500);
      assert.equal(cartForCheckout.items.length, 2);
      const cartSetReplay = await sendJson(healthy.baseUrl, `/v1/me/cart/items/${productIds[0]}`, farmer.accessToken, 'PUT', {
        expectedVersion: emptyCart.version, quantity: 2,
      });
      assert.equal(cartSetReplay.status, 200);
      assert.equal((await cartSetReplay.json()).version, cartForCheckout.version);

      const makeCheckoutQuote = async () => {
        const response = await sendJson(healthy.baseUrl, '/v1/checkout-quotes', farmer.accessToken, 'POST', { addressId: checkoutAddress.id });
        assert.equal(response.status, 201, await response.clone().text());
        const quote = await response.json();
        checkoutQuoteIds.push(quote.id);
        return quote;
      };
      const quoteAtOldPrice = await makeCheckoutQuote();
      assert.equal(quoteAtOldPrice.subtotalIdr, 56500);
      assert.equal(quoteAtOldPrice.shippingAmountIdr, 9000);
      assert.equal(quoteAtOldPrice.totalIdr, 65500);
      await database.query('UPDATE products SET unit_price_idr=20000 WHERE id=$1', [productIds[0]]);
      const stalePriceOrder = await sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'POST',
        { quoteId: quoteAtOldPrice.id }, { 'idempotency-key': `be11-stale-price-${randomUUID()}` });
      assert.equal(stalePriceOrder.status, 409);
      cartForCheckout = await (await sendJson(healthy.baseUrl, '/v1/me/cart', farmer.accessToken, 'GET')).json();
      assert.equal(cartForCheckout.items.length, 2);
      const quoteAtNewPrice = await makeCheckoutQuote();
      assert.equal(quoteAtNewPrice.subtotalIdr, 59500);
      assert.equal(quoteAtNewPrice.totalIdr, 68500);

      const updateAddress = async (expectedVersion, city, province) => sendJson(healthy.baseUrl,
        `/v1/me/addresses/${checkoutAddress.id}`, farmer.accessToken, 'PATCH', {
          expectedVersion, label: 'Kandang Budi Fiktif', recipientName: 'Budi Fiktif', phone: '081234567899',
          addressLine: `Jalan Ternak Fiktif di ${city}`, city, province, postalCode: city === 'Sleman' ? '55511' : '16111',
        });
      const updatedAddressForStaleCheck = await updateAddress(1, 'Sleman', 'DI Yogyakarta');
      assert.equal(updatedAddressForStaleCheck.status, 200);
      const staleAddressOrder = await sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'POST',
        { quoteId: quoteAtNewPrice.id }, { 'idempotency-key': `be11-stale-address-${randomUUID()}` });
      assert.equal(staleAddressOrder.status, 409);
      const unsupportedAddress = await updateAddress(2, 'Jakarta', 'DKI Jakarta');
      assert.equal(unsupportedAddress.status, 200);
      const unsupportedShipping = await sendJson(healthy.baseUrl, '/v1/checkout-quotes', farmer.accessToken, 'POST', { addressId: checkoutAddress.id });
      assert.equal(unsupportedShipping.status, 422);
      const restoredAddress = await updateAddress(3, 'Sleman', 'DI Yogyakarta');
      assert.equal(restoredAddress.status, 200);
      const finalCheckoutQuote = await makeCheckoutQuote();
      assert.equal(finalCheckoutQuote.addressSnapshot.city, 'Sleman');
      assert.equal(finalCheckoutQuote.shippingAmountIdr, 12000);
      assert.equal(finalCheckoutQuote.totalIdr, 71500);

      const orderKey = `be11-order-${randomUUID()}`;
      const createOrderRequests = await Promise.all([
        sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'POST', { quoteId: finalCheckoutQuote.id }, { 'idempotency-key': orderKey }),
        sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'POST', { quoteId: finalCheckoutQuote.id }, { 'idempotency-key': orderKey }),
      ]);
      assert.deepEqual(createOrderRequests.map((response) => response.status), [201, 201]);
      const createOrderResults = await Promise.all(createOrderRequests.map((response) => response.json()));
      const order = createOrderResults[0].order;
      orderIds.push(order.id);
      assert.equal(createOrderResults[0].operationId, createOrderResults[1].operationId);
      assert.equal(createOrderResults.filter((result) => result.replayed).length, 1);
      assert.equal(order.status, 'awaiting_payment');
      assert.equal(order.paymentId, null);
      assert.equal(order.subtotalIdr, 59500);
      assert.equal(order.shippingAmountIdr, 12000);
      assert.equal(order.totalIdr, 71500);
      assert.equal(order.addressSnapshot.city, 'Sleman');
      assert.equal(order.items.length, 2);
      assert.deepEqual(order.items.map(({ productId, unitPriceIdr, quantity, lineTotalIdr }) => ({ productId, unitPriceIdr, quantity, lineTotalIdr }))
        .sort((left, right) => left.productId.localeCompare(right.productId)), [
        { productId: productIds[0], unitPriceIdr: 20000, quantity: 2, lineTotalIdr: 40000 },
        { productId: productIds[1], unitPriceIdr: 19500, quantity: 1, lineTotalIdr: 19500 },
      ].sort((left, right) => left.productId.localeCompare(right.productId)));
      const idempotencyConflict = await sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'POST',
        { quoteId: randomUUID() }, { 'idempotency-key': orderKey });
      assert.equal(idempotencyConflict.status, 409);
      const emptyAfterOrder = await (await sendJson(healthy.baseUrl, '/v1/me/cart', farmer.accessToken, 'GET')).json();
      assert.equal(emptyAfterOrder.items.length, 0);
      const ownOrder = await sendJson(healthy.baseUrl, `/v1/orders/${order.id}`, farmer.accessToken, 'GET');
      assert.equal(ownOrder.status, 200);
      assert.equal((await ownOrder.json()).totalIdr, 71500);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/orders', farmer.accessToken, 'GET')).status, 200);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/orders/${order.id}`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/orders/${order.id}`, vet.accessToken, 'GET')).status, 403);
      const waitingShipment = await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, farmer.accessToken, 'GET');
      assert.equal(waitingShipment.status, 200);
      assert.equal((await waitingShipment.json()).shipment, null);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, vet.accessToken, 'GET')).status, 403);
      const outsiderCart = await (await sendJson(healthy.baseUrl, '/v1/me/cart', outsider.accessToken, 'GET')).json();
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/cart/items/${productIds[0]}`, outsider.accessToken, 'PUT', {
        expectedVersion: outsiderCart.version, quantity: 1,
      })).status, 200);
      const foreignAddressQuote = await sendJson(healthy.baseUrl, '/v1/checkout-quotes', outsider.accessToken, 'POST', { addressId: checkoutAddress.id });
      assert.equal(foreignAddressQuote.status, 404);

      const orderPaymentQuote = await sendJson(healthy.baseUrl, `/v1/payment-quotes/order/${order.id}`, farmer.accessToken, 'GET');
      assert.equal(orderPaymentQuote.status, 200);
      assert.equal((await orderPaymentQuote.json()).amountIdr, 71500);
      const orderPaymentResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST',
        { payableType: 'order', payableId: order.id, method: 'bank_transfer' }, { 'idempotency-key': `be11-order-payment-${randomUUID()}` });
      assert.equal(orderPaymentResponse.status, 201, await orderPaymentResponse.clone().text());
      const orderPayment = await orderPaymentResponse.json();
      assert.equal(orderPayment.status, 'pending');
      assert.equal(orderPayment.amountIdr, 71500);
      const orderPaymentEventId = `be11-order-paid-${randomUUID()}`;
      await localPayment.localCallback({
        paymentId: orderPayment.id, attemptId: orderPayment.attempt.id,
        reference: orderPayment.attempt.reference, amountIdr: '71500', eventId: orderPaymentEventId, outcome: 'succeeded',
      });
      await localPayment.localCallback({
        paymentId: orderPayment.id, attemptId: orderPayment.attempt.id,
        reference: orderPayment.attempt.reference, amountIdr: '71500', eventId: orderPaymentEventId, outcome: 'succeeded',
      });
      const paidOrder = await (await sendJson(healthy.baseUrl, `/v1/orders/${order.id}`, farmer.accessToken, 'GET')).json();
      assert.equal(paidOrder.status, 'processing');
      assert.equal(paidOrder.paymentStatus, 'succeeded');
      assert.equal(paidOrder.addressSnapshot.city, 'Sleman');
      assert.equal(paidOrder.items.find((item) => item.productId === productIds[0]).unitPriceIdr, 20000);
      const shipmentTimelineResponse = await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, farmer.accessToken, 'GET');
      assert.equal(shipmentTimelineResponse.status, 200);
      let shipmentTimeline = await shipmentTimelineResponse.json();
      assert.equal(shipmentTimeline.orderStatus, 'processing');
      assert.equal(shipmentTimeline.shipment.status, 'processing');
      assert.match(shipmentTimeline.shipment.trackingCode, /^LOCAL-/);
      assert.deepEqual(shipmentTimeline.events.map(({ type }) => type), ['order_created', 'payment_succeeded', 'shipment_adapter']);
      assert.equal(shipmentTimeline.events.at(-1).shipmentStatus, 'processing');

      const shipmentRow = (await database.query('SELECT id FROM shipments WHERE order_id=$1', [order.id])).rows[0];
      assert.ok(shipmentRow);
      const localProcessingEvent = await new LocalShipmentAdapter().start({ orderId: order.id, shipmentId: shipmentRow.id });
      const duplicateProcessing = await shipments.recordAdapterResult(order.id, shipmentRow.id, localProcessingEvent);
      assert.equal(duplicateProcessing.duplicate, true);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM shipment_events WHERE shipment_id=$1', [shipmentRow.id])).rows[0].count, 1);

      const pendingDelivered = adapterPending({
        eventId: `pending-${randomUUID()}`, status: 'delivered', trackingCode: shipmentTimeline.shipment.trackingCode,
        description: 'Hasil adapter masih pending.',
      });
      await shipments.recordAdapterResult(order.id, shipmentRow.id, pendingDelivered);
      const failedDelivery = adapterFailed('LOCAL_SHIPMENT_FAILED', 'Adapter lokal gagal sementara.', true);
      await shipments.recordAdapterResult(order.id, shipmentRow.id, failedDelivery);
      let observed = await (await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, farmer.accessToken, 'GET')).json();
      assert.equal(observed.orderStatus, 'processing');
      assert.equal(observed.shipment.status, 'processing');
      assert.ok(observed.events.some((event) => event.outcome === 'pending' && event.shipmentStatus === null));
      assert.ok(observed.events.some((event) => event.outcome === 'failed' && event.shipmentStatus === null));

      await assert.rejects(shipments.recordAdapterResult(order.id, shipmentRow.id, adapterSucceeded({
        eventId: `skip-${randomUUID()}`, status: 'delivered', trackingCode: shipmentTimeline.shipment.trackingCode,
        description: 'Event lompatan fiktif harus ditolak.',
      })));
      const localShippedEvent = adapterSucceeded({
        eventId: `shipped-${randomUUID()}`, status: 'shipped', trackingCode: shipmentTimeline.shipment.trackingCode,
        description: 'Paket fiktif diserahkan untuk pengiriman.',
      });
      await shipments.recordAdapterResult(order.id, shipmentRow.id, localShippedEvent);
      const duplicateShipped = await shipments.recordAdapterResult(order.id, shipmentRow.id, localShippedEvent);
      assert.equal(duplicateShipped.duplicate, true);
      await assert.rejects(shipments.recordAdapterResult(order.id, shipmentRow.id, {
        ...localShippedEvent,
        value: { ...localShippedEvent.value, description: 'Payload event fiktif berbeda.' },
      }));
      const localDeliveredEvent = adapterSucceeded({
        eventId: `delivered-${randomUUID()}`, status: 'delivered', trackingCode: shipmentTimeline.shipment.trackingCode,
        description: 'Paket fiktif diterima.',
      });
      await shipments.recordAdapterResult(order.id, shipmentRow.id, localDeliveredEvent);
      observed = await (await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, farmer.accessToken, 'GET')).json();
      assert.equal(observed.orderStatus, 'delivered');
      assert.equal(observed.shipment.status, 'delivered');
      assert.equal(observed.events.filter((event) => event.eventId === localShippedEvent.value.eventId).length, 1);
      await assert.rejects(database.query("UPDATE orders SET status='shipped' WHERE id=$1", [order.id]));
      await assert.rejects(database.query("UPDATE shipments SET status='failed' WHERE id=$1", [shipmentRow.id]));
      assert.equal((await sendJson(healthy.baseUrl, `/v1/orders/${order.id}/shipment`, outsider.accessToken, 'GET')).status, 404);

      const addQuote = async (startsAt, serviceType, complaint, addressId, key = `be05-quote-${randomUUID()}`) => {
        const body = { vetId: vet.user.id, animalId, serviceType, startsAt, complaint, ...(addressId ? { addressId } : {}) };
        const response = await sendJson(healthy.baseUrl, '/v1/consultation-quotes', farmer.accessToken, 'POST', body, { 'idempotency-key': key });
        assert.equal(response.status, 201, await response.clone().text());
        const quote = await response.json();
        quoteIds.push(quote.id);
        return { body, key, quote };
      };
      const submitQuote = async (quote, key = `be05-booking-${randomUUID()}`) => {
        const response = await sendJson(healthy.baseUrl, '/v1/consultations', farmer.accessToken, 'POST', { quoteId: quote.id }, { 'idempotency-key': key });
        return { response, key, quote };
      };
      const markPaid = async (id, amountIdr) => {
        const paymentResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST',
          { payableType: 'consultation', payableId: id, method: 'bank_transfer' }, { 'idempotency-key': `be05-payment-${randomUUID()}` });
        assert.equal(paymentResponse.status, 201, await paymentResponse.clone().text());
        const payment = await paymentResponse.json();
        assert.equal(payment.status, 'pending');
        assert.equal(payment.amountIdr, amountIdr);
        await localPayment.localCallback({
          paymentId: payment.id,
          attemptId: payment.attempt.id,
          reference: payment.attempt.reference,
          amountIdr: String(amountIdr),
          eventId: `be05-success-${randomUUID()}`,
          outcome: 'succeeded',
        });
      };
      const getConsultation = async (id, token = farmer.accessToken) => {
        const response = await sendJson(healthy.baseUrl, `/v1/consultations/${id}`, token, 'GET');
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      };

      const chatStart = new Date(`${localDate}T06:00:00+07:00`).toISOString();
      const chatQuoteKey = `be05-quote-${randomUUID()}`;
      const chatQuoteA = await addQuote(chatStart, 'chat', 'Keluhan fiktif untuk booking A', undefined, chatQuoteKey);
      const quoteReplay = await sendJson(healthy.baseUrl, '/v1/consultation-quotes', farmer.accessToken, 'POST', chatQuoteA.body, { 'idempotency-key': chatQuoteA.key });
      assert.equal(quoteReplay.status, 201);
      assert.equal((await quoteReplay.json()).id, chatQuoteA.quote.id);
      const quoteFingerprintConflict = await sendJson(healthy.baseUrl, '/v1/consultation-quotes', farmer.accessToken, 'POST',
        { ...chatQuoteA.body, complaint: 'Keluhan berbeda' }, { 'idempotency-key': chatQuoteA.key });
      assert.equal(quoteFingerprintConflict.status, 409);
      const chatQuoteB = await addQuote(chatStart, 'chat', 'Keluhan fiktif untuk booking B');
      assert.equal(chatQuoteA.quote.feeIdr, 125000);
      assert.equal(chatQuoteA.quote.currency, 'IDR');
      assert.equal(chatQuoteA.quote.commissionIdr, 0);
      const parallelBookings = await Promise.all([
        submitQuote(chatQuoteA.quote, `be05-create-${randomUUID()}`),
        submitQuote(chatQuoteB.quote, `be05-create-${randomUUID()}`),
      ]);
      assert.deepEqual(parallelBookings.map(({ response }) => response.status).sort(), [201, 409]);
      const winningBooking = parallelBookings.find(({ response }) => response.status === 201);
      const bookingResult = await winningBooking.response.json();
      const chatConsultationId = bookingResult.consultation.id;
      consultationIds.push(chatConsultationId);
      assert.equal(bookingResult.consultation.status, 'awaiting_payment');
      assert.equal(bookingResult.consultation.feeIdr, '125000');
      const bookingReplay = await sendJson(healthy.baseUrl, '/v1/consultations', farmer.accessToken, 'POST',
        { quoteId: winningBooking.quote.id }, { 'idempotency-key': winningBooking.key });
      assert.equal(bookingReplay.status, 201);
      assert.equal((await bookingReplay.json()).consultation.id, chatConsultationId);
      const unpaidVetList = await sendJson(healthy.baseUrl, '/v1/consultations', vet.accessToken, 'GET');
      assert.equal(unpaidVetList.status, 200);
      assert.ok(!(await unpaidVetList.json()).some((item) => item.id === chatConsultationId));
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}`, outsider.accessToken, 'GET')).status, 404);
      await markPaid(chatConsultationId, 125000);
      assert.equal((await getConsultation(chatConsultationId)).status, 'requested');

      const vetPrincipal = { userId: vet.user.id, email: 'dokter-fiktif@example.invalid', fullName: 'Dokter Fiktif', roles: ['vet'], activeRole: 'vet', sessionId: randomUUID() };
      const failedActionAdapter = new ConsultationService(localDb, {
        record: async () => adapterFailed('LOCAL_OUTBOX_FAILED', 'Perubahan layanan belum tersimpan.', true),
      });
      const failedAcceptKey = `be05-event-fail-${randomUUID()}`;
      await assert.rejects(
        failedActionAdapter.accept(vetPrincipal, chatConsultationId, failedAcceptKey, { expectedVersion: 2 }),
        (error) => error?.getStatus?.() === 503,
      );
      assert.equal((await getConsultation(chatConsultationId)).status, 'requested');
      const acceptKey = `be05-accept-${randomUUID()}`;
      const acceptedPair = await Promise.all([
        sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}/accept`, vet.accessToken, 'POST', { expectedVersion: 2 }, { 'idempotency-key': acceptKey }),
        sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}/accept`, vet.accessToken, 'POST', { expectedVersion: 2 }, { 'idempotency-key': acceptKey }),
      ]);
      assert.deepEqual(acceptedPair.map((response) => response.status), [200, 200]);
      const acceptedBodies = await Promise.all(acceptedPair.map((response) => response.json()));
      assert.equal(acceptedBodies[0].operationId, acceptedBodies[1].operationId);
      assert.equal(acceptedBodies.filter((body) => body.replayed).length, 1);
      assert.equal(acceptedBodies[0].consultation.status, 'scheduled');
      const startChat = await sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}/start`, vet.accessToken, 'POST',
        { expectedVersion: 3 }, { 'idempotency-key': `be05-start-${randomUUID()}` });
      assert.equal(startChat.status, 200, await startChat.clone().text());
      assert.equal((await startChat.json()).consultation.status, 'in_progress');

      const proposalStart = new Date(`${localDate}T08:00:00+07:00`).toISOString();
      const proposalBooking = await addQuote(proposalStart, 'chat', 'Keluhan jadwal proposal fiktif');
      const proposalCreate = await submitQuote(proposalBooking.quote);
      assert.equal(proposalCreate.response.status, 201);
      const proposalConsultationId = (await proposalCreate.response.json()).consultation.id;
      consultationIds.push(proposalConsultationId);
      await markPaid(proposalConsultationId, 125000);
      let proposalConsultation = await getConsultation(proposalConsultationId);
      const proposalAccept = await sendJson(healthy.baseUrl, `/v1/consultations/${proposalConsultationId}/accept`, vet.accessToken, 'POST',
        { expectedVersion: proposalConsultation.version }, { 'idempotency-key': `be05-accept-${randomUUID()}` });
      assert.equal(proposalAccept.status, 200);
      proposalConsultation = (await proposalAccept.json()).consultation;
      const proposalStartAt = new Date(`${localDate}T09:00:00+07:00`).toISOString();
      const scheduleProposal = await sendJson(healthy.baseUrl, `/v1/consultations/${proposalConsultationId}/schedule-proposals`, vet.accessToken, 'POST',
        { expectedVersion: proposalConsultation.version, startsAt: proposalStartAt }, { 'idempotency-key': `be05-propose-${randomUUID()}` });
      assert.equal(scheduleProposal.status, 200, await scheduleProposal.clone().text());
      const proposalResult = await scheduleProposal.json();
      assert.equal(proposalResult.consultation.status, 'reschedule_pending');
      const overlappingQuote = await sendJson(healthy.baseUrl, '/v1/consultation-quotes', farmer.accessToken, 'POST',
        { vetId: vet.user.id, animalId, serviceType: 'chat', startsAt: proposalStartAt, complaint: 'Slot proposal terpakai' },
        { 'idempotency-key': `be05-overlap-${randomUUID()}` });
      assert.equal(overlappingQuote.status, 409);
      const proposalResponsePath = `/v1/consultations/${proposalConsultationId}/schedule-proposals/${proposalResult.proposalId}/respond`;
      const missingConsent = await sendJson(healthy.baseUrl, proposalResponsePath, farmer.accessToken, 'POST',
        { expectedVersion: proposalResult.consultation.version, decision: 'accept', consent: false }, { 'idempotency-key': `be05-consent-${randomUUID()}` });
      assert.equal(missingConsent.status, 422);
      await database.query("UPDATE vet_profiles SET verification_status='pending' WHERE user_id=$1", [vet.user.id]);
      const staleVerification = await sendJson(healthy.baseUrl, proposalResponsePath, farmer.accessToken, 'POST',
        { expectedVersion: proposalResult.consultation.version, decision: 'accept', consent: true }, { 'idempotency-key': `be05-verify-${randomUUID()}` });
      assert.equal(staleVerification.status, 403);
      await database.query("UPDATE vet_profiles SET verification_status='verified' WHERE user_id=$1", [vet.user.id]);
      await database.query("INSERT INTO vet_blocked_times(vet_id,starts_at,ends_at,reason) VALUES($1,$2,$3,'Blokir uji fiktif')",
        [vet.user.id, proposalStartAt, new Date(Date.parse(proposalStartAt) + 60 * 60_000).toISOString()]);
      const staleSlot = await sendJson(healthy.baseUrl, proposalResponsePath, farmer.accessToken, 'POST',
        { expectedVersion: proposalResult.consultation.version, decision: 'accept', consent: true }, { 'idempotency-key': `be05-slot-${randomUUID()}` });
      assert.equal(staleSlot.status, 409);
      await database.query("DELETE FROM vet_blocked_times WHERE vet_id=$1 AND reason='Blokir uji fiktif'", [vet.user.id]);
      const acceptProposal = await sendJson(healthy.baseUrl, proposalResponsePath, farmer.accessToken, 'POST',
        { expectedVersion: proposalResult.consultation.version, decision: 'accept', consent: true }, { 'idempotency-key': `be05-consent-${randomUUID()}` });
      assert.equal(acceptProposal.status, 200, await acceptProposal.clone().text());
      const acceptedProposal = await acceptProposal.json();
      assert.equal(acceptedProposal.consultation.status, 'scheduled');
      assert.equal(new Date(acceptedProposal.consultation.startsAt).toISOString(), proposalStartAt);

      const rejectStart = new Date(`${localDate}T10:00:00+07:00`).toISOString();
      const rejectQuote = await addQuote(rejectStart, 'chat', 'Keluhan untuk penolakan fiktif');
      const rejectBooking = await submitQuote(rejectQuote.quote);
      assert.equal(rejectBooking.response.status, 201);
      const rejectConsultationId = (await rejectBooking.response.json()).consultation.id;
      consultationIds.push(rejectConsultationId);
      await markPaid(rejectConsultationId, 125000);
      const rejectContext = await getConsultation(rejectConsultationId);
      const missingReason = await sendJson(healthy.baseUrl, `/v1/consultations/${rejectConsultationId}/reject`, vet.accessToken, 'POST',
        { expectedVersion: rejectContext.version, reason: '   ' }, { 'idempotency-key': `be05-reject-${randomUUID()}` });
      assert.equal(missingReason.status, 400);
      const rejectedResponse = await sendJson(healthy.baseUrl, `/v1/consultations/${rejectConsultationId}/reject`, vet.accessToken, 'POST',
        { expectedVersion: rejectContext.version, reason: 'Jadwal dokter berubah; silakan pilih dokter lain.' }, { 'idempotency-key': `be05-reject-${randomUUID()}` });
      assert.equal(rejectedResponse.status, 200);
      const rejectedConsultation = (await rejectedResponse.json()).consultation;
      assert.equal(rejectedConsultation.status, 'rejected');
      assert.equal(rejectedConsultation.refundStatus, 'refund_needed');
      assert.equal(rejectedConsultation.rejectionReason, 'Jadwal dokter berubah; silakan pilih dokter lain.');

      const cancelStart = new Date(`${localDate}T14:00:00+07:00`).toISOString();
      const cancelQuote = await addQuote(cancelStart, 'chat', 'Jadwal Peternak berubah; pembatalan fiktif');
      const cancelBooking = await submitQuote(cancelQuote.quote);
      assert.equal(cancelBooking.response.status, 201);
      const cancelConsultationId = (await cancelBooking.response.json()).consultation.id;
      consultationIds.push(cancelConsultationId);
      await markPaid(cancelConsultationId, 125000);
      const cancelRequested = await getConsultation(cancelConsultationId);
      const cancelProposal = await sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}/schedule-proposals`, vet.accessToken, 'POST',
        { expectedVersion: cancelRequested.version, startsAt: new Date(`${localDate}T16:00:00+07:00`).toISOString() },
        { 'idempotency-key': `be05-cancel-proposal-${randomUUID()}` });
      assert.equal(cancelProposal.status, 200, await cancelProposal.clone().text());
      const pendingCancel = (await cancelProposal.json()).consultation;
      assert.equal(pendingCancel.status, 'reschedule_pending');
      const cancelKey = `be05-cancel-${randomUUID()}`;
      const cancelAttempts = await Promise.all([
        sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}/cancel`, farmer.accessToken, 'POST',
          { expectedVersion: pendingCancel.version, reason: 'Jadwal Peternak berubah.' }, { 'idempotency-key': cancelKey }),
        sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}/cancel`, farmer.accessToken, 'POST',
          { expectedVersion: pendingCancel.version, reason: 'Jadwal Peternak berubah.' }, { 'idempotency-key': cancelKey }),
      ]);
      assert.deepEqual(cancelAttempts.map((response) => response.status), [200, 200]);
      const cancelResults = await Promise.all(cancelAttempts.map((response) => response.json()));
      assert.equal(cancelResults[0].operationId, cancelResults[1].operationId);
      assert.equal(cancelResults.filter((result) => result.replayed).length, 1);
      assert.equal(cancelResults[0].consultation.status, 'cancelled');
      assert.equal(cancelResults[0].consultation.cancellationReason, 'Jadwal Peternak berubah.');
      assert.equal(cancelResults[0].consultation.refundStatus, 'refund_needed');
      const cancelledDetailResponse = await sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}`, farmer.accessToken, 'GET');
      assert.equal(cancelledDetailResponse.status, 200);
      assert.equal((await cancelledDetailResponse.json()).proposals[0].status, 'superseded');
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}/cancel`, vet.accessToken, 'POST',
        { expectedVersion: cancelResults[0].consultation.version, reason: 'Alasan dokter' }, { 'idempotency-key': `be05-cancel-vet-${randomUUID()}` })).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${cancelConsultationId}/cancel`, farmer.accessToken, 'POST',
        { expectedVersion: pendingCancel.version, reason: 'Jadwal Peternak berubah.' }, { 'idempotency-key': `be05-cancel-stale-${randomUUID()}` })).status, 409);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}/cancel`, farmer.accessToken, 'POST',
        { expectedVersion: 4, reason: 'Layanan sudah dimulai.' }, { 'idempotency-key': `be05-cancel-started-${randomUUID()}` })).status, 409);

      const unverifiedConsultationId = randomUUID();
      consultationIds.push(unverifiedConsultationId);
      const unverifiedStart = new Date(`${localDate}T17:00:00+07:00`).toISOString();
      await database.query(
        `INSERT INTO consultations(id,display_code,farmer_id,vet_id,animal_id,service_type,complaint,status,starts_at,ends_at,fee_snapshot_idr,commission_snapshot_idr)
         VALUES($1,$2,$3,$4,$5,'chat','Request fiktif untuk guard verifikasi','requested',$6,$7,1000,0)`,
        [unverifiedConsultationId, `BE05-${unverifiedConsultationId}`, farmer.user.id, unverifiedVet.user.id, animalId, unverifiedStart, new Date(Date.parse(unverifiedStart) + 60 * 60_000).toISOString()],
      );
      await database.query("INSERT INTO payments(owner_id,payable_type,payable_id,method,amount_idr,status,operation_key) VALUES($1,'consultation',$2,'local-test',1000,'succeeded',$3)",
        [farmer.user.id, unverifiedConsultationId, `be05-unverified-${unverifiedConsultationId}`]);
      const unverifiedAccept = await sendJson(healthy.baseUrl, `/v1/consultations/${unverifiedConsultationId}/accept`, unverifiedVet.accessToken, 'POST',
        { expectedVersion: 1 }, { 'idempotency-key': `be05-unverified-${randomUUID()}` });
      assert.equal(unverifiedAccept.status, 403);
      assert.equal((await database.query('SELECT status FROM consultations WHERE id=$1', [unverifiedConsultationId])).rows[0].status, 'requested');

      const deniedMembershipSwitch = await sendJson(healthy.baseUrl, '/v1/auth/active-role', outsider.accessToken, 'POST', { activeRole: 'vet' });
      assert.equal(deniedMembershipSwitch.status, 403);
      const unchangedSession = await (await sendJson(healthy.baseUrl, '/v1/me', outsider.accessToken, 'GET')).json();
      assert.equal(unchangedSession.activeRole, 'farmer');
      await database.query("INSERT INTO role_memberships(user_id,role) VALUES($1,'vet') ON CONFLICT DO NOTHING", [outsider.user.id]);
      await database.query("INSERT INTO vet_profiles(user_id,verification_status) VALUES($1,'pending') ON CONFLICT DO NOTHING", [outsider.user.id]);
      const originalFarmerSession = { ...outsider };
      const switchToVetResponse = await sendJson(healthy.baseUrl, '/v1/auth/active-role', outsider.accessToken, 'POST', { activeRole: 'vet' });
      assert.equal(switchToVetResponse.status, 200, await switchToVetResponse.clone().text());
      const dualRole = await switchToVetResponse.json();
      assert.equal(dualRole.activeRole, 'vet');
      assert.deepEqual(dualRole.user.roles, ['farmer', 'vet']);
      assert.equal(dualRole.sessionId, originalFarmerSession.sessionId);
      assert.equal(dualRole.sessionExpiresAt, originalFarmerSession.sessionExpiresAt);
      assert.notEqual(dualRole.accessToken, originalFarmerSession.accessToken);
      assert.notEqual(dualRole.refreshToken, originalFarmerSession.refreshToken);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/me', originalFarmerSession.accessToken, 'GET')).status, 401);
      const vetRoleMe = await (await sendJson(healthy.baseUrl, '/v1/me', dualRole.accessToken, 'GET')).json();
      assert.equal(vetRoleMe.activeRole, 'vet');
      assert.deepEqual(vetRoleMe.roles, ['farmer', 'vet']);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}`, dualRole.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payments?payableType=consultation&payableId=${randomUUID()}`, dualRole.accessToken, 'GET')).status, 403);
      const switchBackResponse = await sendJson(healthy.baseUrl, '/v1/auth/active-role', dualRole.accessToken, 'POST', { activeRole: 'farmer' });
      assert.equal(switchBackResponse.status, 200, await switchBackResponse.clone().text());
      const switchedBack = await switchBackResponse.json();
      assert.equal(switchedBack.activeRole, 'farmer');
      assert.equal(switchedBack.sessionId, originalFarmerSession.sessionId);
      assert.notEqual(switchedBack.accessToken, dualRole.accessToken);
      Object.assign(outsider, switchedBack);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/me', outsider.accessToken, 'GET')).status, 200);

      const visitAddressResponse = await sendJson(healthy.baseUrl, '/v1/me/addresses', farmer.accessToken, 'POST', {
        label: 'Kandang Fiktif', recipientName: 'Peternak Fiktif', phone: '080000000000',
        addressLine: 'Jalan Contoh Tanpa Nomor', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
      });
      assert.equal(visitAddressResponse.status, 201);
      const visitAddress = await visitAddressResponse.json();
      addressIds.push(visitAddress.id);
      const visitStart = new Date(`${localDate}T15:00:00+07:00`).toISOString();
      const unlinkedVisitQuote = await sendJson(healthy.baseUrl, '/v1/consultation-quotes', farmer.accessToken, 'POST',
        { vetId: vet.user.id, animalId, serviceType: 'visit', startsAt: visitStart, complaint: 'Alamat belum tertaut', addressId: visitAddress.id },
        { 'idempotency-key': `be05-unlinked-${randomUUID()}` });
      assert.equal(unlinkedVisitQuote.status, 400);
      const linkedFarm = await sendJson(healthy.baseUrl, `/v1/me/farms/${farmId}`, farmer.accessToken, 'PATCH',
        { name: 'Farm Fiktif BE-07', expectedVersion: 2, visitAddressId: visitAddress.id });
      assert.equal(linkedFarm.status, 200, await linkedFarm.clone().text());
      assert.equal((await linkedFarm.json()).visitAddressId, visitAddress.id);
      const visitQuote = await addQuote(visitStart, 'visit', 'Pemeriksaan ternak fiktif', visitAddress.id);
      assert.equal(visitQuote.quote.visitAddressSnapshot.addressLine, 'Jalan Contoh Tanpa Nomor');
      const visitBooking = await submitQuote(visitQuote.quote);
      assert.equal(visitBooking.response.status, 201);
      const visitConsultationId = (await visitBooking.response.json()).consultation.id;
      consultationIds.push(visitConsultationId);
      const prematureReview = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', {
        stars: 5, text: 'Ulasan sebelum layanan selesai.',
      });
      assert.equal(prematureReview.status, 422);
      // This fictional commission snapshot exercises exact integer arithmetic; it is not a commercial rate decision.
      await database.query('UPDATE consultations SET commission_snapshot_idr=17501 WHERE id=$1', [visitConsultationId]);
      await markPaid(visitConsultationId, 400000);
      let visitConsultation = await getConsultation(visitConsultationId);
      assert.equal(visitConsultation.status, 'requested');
      const visitAccept = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/accept`, vet.accessToken, 'POST',
        { expectedVersion: visitConsultation.version }, { 'idempotency-key': `be05-accept-${randomUUID()}` });
      assert.equal(visitAccept.status, 200);
      visitConsultation = (await visitAccept.json()).consultation;
      assert.equal(visitConsultation.visitStage, 'scheduled');
      const outOfOrderArrive = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/visit/arrive`, vet.accessToken, 'POST',
        { expectedVersion: visitConsultation.version, expectedVisitVersion: visitConsultation.visitVersion }, { 'idempotency-key': `be05-arrive-${randomUUID()}` });
      assert.equal(outOfOrderArrive.status, 409);
      const depart = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/visit/depart`, vet.accessToken, 'POST',
        { expectedVersion: visitConsultation.version, expectedVisitVersion: visitConsultation.visitVersion }, { 'idempotency-key': `be05-depart-${randomUUID()}` });
      assert.equal(depart.status, 200, await depart.clone().text());
      const departed = await depart.json();
      assert.equal(departed.visit.stage, 'en_route');
      const cancelDuringVisit = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/cancel`, farmer.accessToken, 'POST',
        { expectedVersion: departed.consultation.version, reason: 'Kunjungan sudah berjalan.' }, { 'idempotency-key': `be05-cancel-en-route-${randomUUID()}` });
      assert.equal(cancelDuringVisit.status, 409);
      const arrive = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/visit/arrive`, vet.accessToken, 'POST',
        { expectedVersion: departed.consultation.version, expectedVisitVersion: departed.visit.version }, { 'idempotency-key': `be05-arrive-${randomUUID()}` });
      assert.equal(arrive.status, 200);
      const arrived = await arrive.json();
      assert.equal(arrived.visit.stage, 'arrived');
      const examination = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/visit/start-examination`, vet.accessToken, 'POST',
        { expectedVersion: arrived.consultation.version, expectedVisitVersion: arrived.visit.version }, { 'idempotency-key': `be05-exam-${randomUUID()}` });
      assert.equal(examination.status, 200);
      const examining = await examination.json();
      assert.equal(examining.consultation.status, 'in_progress');
      assert.equal(examining.visit.stage, 'examining');
      const missingFinalNote = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: true }, { 'idempotency-key': `be05-no-note-${randomUUID()}` });
      assert.equal(missingFinalNote.status, 422);
      const notePathVisit = `/v1/consultations/${visitConsultationId}/note`;
      const finalDraft = await sendJson(healthy.baseUrl, notePathVisit, vet.accessToken, 'PUT', {
        expectedVersion: 1, complaint: 'Perubahan perilaku fiktif', findings: 'Temuan pemeriksaan fiktif',
        assessment: 'Penilaian klinis fiktif', actions: 'Tindakan pemeriksaan fiktif', careInstructions: 'Instruksi perawatan fiktif tanpa dosis',
      });
      assert.equal(finalDraft.status, 200);
      const finalize = await sendJson(healthy.baseUrl, `${notePathVisit}/finalize`, vet.accessToken, 'POST', { expectedVersion: 1 });
      assert.equal(finalize.status, 201);
      assert.equal((await getConsultation(visitConsultationId)).status, 'in_progress');
      const timelineAfterFinal = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, farmer.accessToken, 'GET');
      assert.equal(timelineAfterFinal.status, 200);
      const timelineAfterFinalEvents = await timelineAfterFinal.json();
      const finalizedTimelineEvent = timelineAfterFinalEvents.find((event) => event.description === 'Penilaian klinis fiktif');
      assert.ok(finalizedTimelineEvent);
      assert.equal(timelineAfterFinalEvents.filter((event) => event.description === 'Penilaian klinis fiktif').length, 1);
      assert.equal(finalizedTimelineEvent.kind, 'examination');
      assert.equal(finalizedTimelineEvent.provenance, 'clinical_note');
      assert.deepEqual(Object.keys(finalizedTimelineEvent).sort(), ['id', 'kind', 'occurredAt', 'description', 'provenance', 'createdAt'].sort());
      const beforeCompleteEarnings = await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json();
      assert.equal(beforeCompleteEarnings.transactions.some((entry) => entry.consultationId === visitConsultationId), false);
      const unconfirmedComplete = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: false }, { 'idempotency-key': `be05-complete-${randomUUID()}` });
      assert.equal(unconfirmedComplete.status, 422);
      const completionKey = `be15-complete-${randomUUID()}`;
      const completedVisitResponse = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: true }, { 'idempotency-key': completionKey });
      assert.equal(completedVisitResponse.status, 200, await completedVisitResponse.clone().text());
      const completedVisit = (await completedVisitResponse.json()).consultation;
      assert.equal(completedVisit.status, 'completed');
      assert.equal(completedVisit.visitStage, 'completed');
      assert.equal(completedVisit.completionAt != null, true);
      const invalidLowReview = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', { stars: 0 });
      assert.equal(invalidLowReview.status, 400);
      const invalidHighReview = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', { stars: 6 });
      assert.equal(invalidHighReview.status, 400);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, outsider.accessToken, 'POST', { stars: 5 })).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, vet.accessToken, 'POST', { stars: 5 })).status, 403);
      const reviewInput = { stars: 5, text: '  Penanganan ternak fiktif terasa jelas.  ' };
      const parallelReviewResponses = await Promise.all([
        sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', reviewInput),
        sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', reviewInput),
      ]);
      assert.deepEqual(parallelReviewResponses.map((response) => response.status), [201, 201]);
      const parallelReviews = await Promise.all(parallelReviewResponses.map((response) => response.json()));
      assert.equal(parallelReviews[0].id, parallelReviews[1].id);
      assert.equal(parallelReviews[0].text, 'Penanganan ternak fiktif terasa jelas.');
      const ownReview = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'GET');
      assert.equal(ownReview.status, 200);
      assert.deepEqual(await ownReview.json(), parallelReviews[0]);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, vet.accessToken, 'GET')).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/review`, farmer.accessToken, 'POST', { stars: 4 })).status, 409);
      const firstReviewList = await sendJson(healthy.baseUrl, `/v1/vets/${vet.user.id}/reviews`, farmer.accessToken, 'GET');
      assert.equal(firstReviewList.status, 200);
      assert.equal((await firstReviewList.json()).items.length, 1);
      const firstVetProfile = await sendJson(healthy.baseUrl, `/v1/vets/${vet.user.id}`, farmer.accessToken, 'GET');
      assert.equal(firstVetProfile.status, 200);
      const firstVetSummary = await firstVetProfile.json();
      assert.equal(firstVetSummary.ratingAverage, 5);
      assert.equal(firstVetSummary.ratingCount, 1);
      const completedEarningRow = await database.query(
        'SELECT id FROM earning_transactions WHERE consultation_id=$1', [visitConsultationId]);
      assert.equal(completedEarningRow.rowCount, 1);
      const earningId = completedEarningRow.rows[0].id;
      const earningDetailResponse = await sendJson(healthy.baseUrl, `/v1/me/vet/transactions/${earningId}`, vet.accessToken, 'GET');
      assert.equal(earningDetailResponse.status, 200);
      const earningDetail = await earningDetailResponse.json();
      assert.equal(earningDetail.gross, 400000);
      assert.equal(earningDetail.commission, 17501);
      assert.equal(earningDetail.net, 382499);
      assert.equal(earningDetail.gross - earningDetail.commission, earningDetail.net);
      assert.equal(earningDetail.status, 'pending');
      const afterCompletePending = await (await sendJson(healthy.baseUrl, `/v1/me/vet/earnings?period=${new Date().toISOString().slice(0, 7)}`, vet.accessToken, 'GET')).json();
      assert.equal(afterCompletePending.balances.pending, 382499);
      assert.equal(afterCompletePending.balances.available, 0);
      assert.equal(afterCompletePending.totals.net, 382499);
      assert.ok(afterCompletePending.transactions.some((entry) => entry.id === earningId));
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/vet/transactions/${earningId}`, unverifiedVet.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/vet/transactions/${earningId}`, farmer.accessToken, 'GET')).status, 403);
      const completionReplay = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: true }, { 'idempotency-key': completionKey });
      assert.equal(completionReplay.status, 200);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM earning_transactions WHERE consultation_id=$1', [visitConsultationId])).rows[0].count, 1);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM ledger_entries WHERE earning_id=$1 AND kind='earn_pending'", [earningId])).rows[0].count, 1);

      const pendingSettlement = adapterPending({ reference: `LOCAL-PENDING-${earningId}` });
      const pendingSettlementResult = await earnings.recordEarningSettlementResult(earningId, pendingSettlement);
      assert.equal(pendingSettlementResult.status, 'pending');
      assert.equal((await earnings.recordEarningSettlementResult(earningId, pendingSettlement)).duplicate, true);
      const successfulSettlement = adapterSucceeded({ reference: `LOCAL-SETTLED-${earningId}` });
      const settled = await earnings.recordEarningSettlementResult(earningId, successfulSettlement);
      assert.equal(settled.status, 'available');
      assert.equal((await earnings.recordEarningSettlementResult(earningId, successfulSettlement)).duplicate, true);
      await assert.rejects(earnings.recordEarningSettlementResult(earningId, {
        ...adapterFailed('SETTLEMENT_CONFLICT', 'Fixture conflict.', true), operationId: successfulSettlement.operationId,
      }));
      assert.equal((await database.query('SELECT status FROM earning_transactions WHERE id=$1', [earningId])).rows[0].status, 'available');
      for (const kind of ['release_pending', 'credit_available']) {
        assert.equal((await database.query('SELECT count(*)::int AS count FROM ledger_entries WHERE earning_id=$1 AND kind=$2', [earningId, kind])).rows[0].count, 1);
      }
      const afterSettlement = await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json();
      assert.deepEqual(afterSettlement.balances, { pending: 0, available: 382499, reserved: 0, paidOut: 0 });

      const withdrawalKey = `be15-withdraw-${randomUUID()}`;
      const firstWithdrawalResponses = await Promise.all([
        sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
          { amount: 200000, destinationId: payoutDestinationId }, { 'idempotency-key': withdrawalKey }),
        sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vetDeviceB.accessToken, 'POST',
          { amount: 200000, destinationId: payoutDestinationId }, { 'idempotency-key': withdrawalKey }),
      ]);
      assert.deepEqual(firstWithdrawalResponses.map((response) => response.status), [201, 201]);
      const firstWithdrawalBodies = await Promise.all(firstWithdrawalResponses.map((response) => response.json()));
      assert.equal(firstWithdrawalBodies[0].withdrawal.id, firstWithdrawalBodies[1].withdrawal.id);
      const withdrawalRows = await database.query('SELECT count(*)::int AS withdrawals FROM withdrawals WHERE vet_id=$1 AND operation_key=$2',
        [vet.user.id, withdrawalKey]);
      assert.equal(withdrawalRows.rows[0].withdrawals, 1);
      const reserveRows = await database.query("SELECT count(*)::int AS entries FROM ledger_entries WHERE operation_key=$1", [
        `withdrawal:${firstWithdrawalBodies[0].withdrawal.id}:reserve`,
      ]);
      assert.equal(reserveRows.rows[0].entries, 1);
      const firstWithdrawalOperation = firstWithdrawalBodies[0];
      const firstWithdrawal = firstWithdrawalOperation.withdrawal;
      assert.equal(firstWithdrawalOperation.adapterOutcome, 'succeeded');
      assert.equal(firstWithdrawal.status, 'submitted');
      assert.equal(firstWithdrawal.amount, 200000);
      assert.equal(firstWithdrawal.fee, 0);
      assert.equal(firstWithdrawal.netAmount, 200000);
      assert.equal(firstWithdrawal.destination.accountMasked, '•••• 4567');
      assert.equal(firstWithdrawal.destinationId, undefined);
      const withdrawalReplayResponse = await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
        { amount: 200000, destinationId: payoutDestinationId }, { 'idempotency-key': withdrawalKey });
      assert.equal(withdrawalReplayResponse.status, 201);
      const withdrawalReplay = await withdrawalReplayResponse.json();
      assert.equal(withdrawalReplay.replayed, true);
      assert.equal(withdrawalReplay.withdrawal.id, firstWithdrawal.id);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
        { amount: 199999, destinationId: payoutDestinationId }, { 'idempotency-key': withdrawalKey })).status, 409);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', farmer.accessToken, 'GET')).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/vet/withdrawals/${firstWithdrawal.id}`, unverifiedVet.accessToken, 'GET')).status, 404);
      const afterFirstReserve = await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json();
      assert.deepEqual(afterFirstReserve.balances, { pending: 0, available: 182499, reserved: 200000, paidOut: 0 });

      const concurrentKeys = [`be15-race-a-${randomUUID()}`, `be15-race-b-${randomUUID()}`];
      const concurrentResponses = await Promise.all(concurrentKeys.map((key) => sendJson(
        healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
        { amount: 100000, destinationId: payoutDestinationId }, { 'idempotency-key': key },
      )));
      assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [201, 422]);
      const concurrentSuccessIndex = concurrentResponses.findIndex((response) => response.status === 201);
      const concurrentWithdrawal = (await concurrentResponses[concurrentSuccessIndex].json()).withdrawal;
      const concurrentRejected = concurrentResponses[1 - concurrentSuccessIndex];
      assert.equal((await concurrentRejected.json()).code, 'RULE_VIOLATION');
      let currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 82499, reserved: 300000, paidOut: 0 });

      const failedWithdrawalKey = `be15-failed-submit-${randomUUID()}`;
      const failingWithdrawalService = new EarningsService(
        localDb, new LocalEarningSettlementAdapter('pending'), new LocalWithdrawalSubmissionAdapter('failed'),
      );
      await assert.rejects(failingWithdrawalService.createWithdrawal(vetPrincipal, failedWithdrawalKey,
        { amount: 50000, destinationId: payoutDestinationId }));
      await assert.rejects(failingWithdrawalService.createWithdrawal(vetPrincipal, failedWithdrawalKey,
        { amount: 50000, destinationId: payoutDestinationId }));
      const failedWithdrawalRow = await database.query(
        'SELECT id,status FROM withdrawals WHERE vet_id=$1 AND operation_key=$2', [vet.user.id, failedWithdrawalKey]);
      assert.equal(failedWithdrawalRow.rows[0].status, 'failed');
      assert.equal((await database.query("SELECT count(*)::int AS count FROM ledger_entries WHERE withdrawal_id=$1 AND kind='reserve_withdrawal'", [failedWithdrawalRow.rows[0].id])).rows[0].count, 1);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM ledger_entries WHERE withdrawal_id=$1 AND kind='release_withdrawal'", [failedWithdrawalRow.rows[0].id])).rows[0].count, 1);
      currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 82499, reserved: 300000, paidOut: 0 });

      const paidFirstEvent = adapterSucceeded({ status: 'paid', reference: `LOCAL-PAID-${firstWithdrawal.id}` });
      const firstPaid = await earnings.recordPayoutAdapterResult(firstWithdrawal.id, paidFirstEvent);
      assert.equal(firstPaid.withdrawal.status, 'paid');
      assert.equal((await earnings.recordPayoutAdapterResult(firstWithdrawal.id, paidFirstEvent)).duplicate, true);
      currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 82499, reserved: 100000, paidOut: 200000 });
      const failedPayoutEvent = adapterFailed('LOCAL_PAYOUT_FAILED', 'Kegagalan payout fiktif.', true);
      const failedPayout = await earnings.recordPayoutAdapterResult(concurrentWithdrawal.id, failedPayoutEvent);
      assert.equal(failedPayout.withdrawal.status, 'failed');
      assert.equal((await earnings.recordPayoutAdapterResult(concurrentWithdrawal.id, failedPayoutEvent)).duplicate, true);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM ledger_entries WHERE withdrawal_id=$1 AND kind='release_withdrawal'", [concurrentWithdrawal.id])).rows[0].count, 1);
      currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 182499, reserved: 0, paidOut: 200000 });

      const pendingWithdrawalService = new EarningsService(
        localDb, new LocalEarningSettlementAdapter('pending'), new LocalWithdrawalSubmissionAdapter('pending'),
      );
      const pendingWithdrawalOperation = await pendingWithdrawalService.createWithdrawal(vetPrincipal, `be15-pending-${randomUUID()}`,
        { amount: 50000, destinationId: payoutDestinationId });
      assert.equal(pendingWithdrawalOperation.adapterOutcome, 'pending');
      assert.equal(pendingWithdrawalOperation.withdrawal.status, 'submitting');
      assert.equal(pendingWithdrawalOperation.withdrawal.submittedAt, null);
      const submissionAccepted = adapterSucceeded({ reference: `LOCAL-ACCEPTED-${pendingWithdrawalOperation.operationId}` });
      await pendingWithdrawalService.recordWithdrawalSubmissionResult(pendingWithdrawalOperation.operationId, submissionAccepted);
      assert.equal((await pendingWithdrawalService.getWithdrawal(vetPrincipal, pendingWithdrawalOperation.operationId)).status, 'submitted');
      const paidPendingEvent = adapterSucceeded({ status: 'paid', reference: `LOCAL-PAID-${pendingWithdrawalOperation.operationId}` });
      await pendingWithdrawalService.recordPayoutAdapterResult(pendingWithdrawalOperation.operationId, paidPendingEvent);
      assert.equal((await pendingWithdrawalService.getWithdrawal(vetPrincipal, pendingWithdrawalOperation.operationId)).status, 'paid');

      const zeroingWithdrawalResponse = await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
        { amount: 132499, destinationId: payoutDestinationId }, { 'idempotency-key': `be15-zeroing-${randomUUID()}` });
      assert.equal(zeroingWithdrawalResponse.status, 201);
      const zeroingWithdrawal = (await zeroingWithdrawalResponse.json()).withdrawal;
      currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 0, reserved: 132499, paidOut: 250000 });
      const zeroBalanceAttemptKey = `be15-zero-balance-${randomUUID()}`;
      const zeroBalanceAttempt = await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals', vet.accessToken, 'POST',
        { amount: 1, destinationId: payoutDestinationId }, { 'idempotency-key': zeroBalanceAttemptKey });
      assert.equal(zeroBalanceAttempt.status, 422);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM withdrawals WHERE operation_key=$1', [zeroBalanceAttemptKey])).rows[0].count, 0);
      const paidZeroBalanceEvent = adapterSucceeded({ status: 'paid', reference: `LOCAL-PAID-${zeroingWithdrawal.id}` });
      await earnings.recordPayoutAdapterResult(zeroingWithdrawal.id, paidZeroBalanceEvent);
      currentBalances = (await (await sendJson(healthy.baseUrl, '/v1/me/vet/earnings', vet.accessToken, 'GET')).json()).balances;
      assert.deepEqual(currentBalances, { pending: 0, available: 0, reserved: 0, paidOut: 382499 });

      const withdrawalPageOneResponse = await sendJson(healthy.baseUrl, '/v1/me/vet/withdrawals?limit=2', vet.accessToken, 'GET');
      assert.equal(withdrawalPageOneResponse.status, 200);
      const withdrawalPageOne = await withdrawalPageOneResponse.json();
      assert.equal(withdrawalPageOne.items.length, 2);
      assert.equal(withdrawalPageOne.hasMore, true);
      const withdrawalPageTwo = await (await sendJson(healthy.baseUrl,
        `/v1/me/vet/withdrawals?limit=2&cursor=${encodeURIComponent(withdrawalPageOne.nextCursor)}`, vet.accessToken, 'GET')).json();
      assert.equal(withdrawalPageTwo.items.length, 2);
      assert.equal(new Set([...withdrawalPageOne.items, ...withdrawalPageTwo.items].map((row) => row.id)).size, 4);
      const history = await sendJson(healthy.baseUrl, '/v1/consultations?status=completed', farmer.accessToken, 'GET');
      assert.equal(history.status, 200);
      assert.ok((await history.json()).some((item) => item.id === visitConsultationId));
      await database.query(
        `INSERT INTO consultations
           (id, display_code, farmer_id, vet_id, animal_id, service_type, complaint, status,
            starts_at, ends_at, fee_snapshot_idr, commission_snapshot_idr)
         VALUES ($1, $2, $3, $4, $5, 'chat', 'Keluhan fiktif untuk smoke check', 'scheduled',
                 now() + interval '1 hour', now() + interval '2 hours', 1000, 0)`,
        [consultationId, `BE07-${consultationId}`, farmer.user.id, vet.user.id, animalId],
      );
      await database.query(
        `INSERT INTO payments (owner_id, payable_type, payable_id, method, amount_idr, status, operation_key)
         VALUES ($1, 'consultation', $2, 'local-test', 1000, 'succeeded', $3)`,
        [farmer.user.id, consultationId, `be07-smoke-${consultationId}`],
      );
      const acceptedInterval=await database.query('SELECT starts_at,ends_at FROM consultations WHERE id=$1',[consultationId]);
      const conflictingBlock=await sendJson(healthy.baseUrl,'/v1/me/vet/blocked-times',vet.accessToken,'POST',{startsAt:acceptedInterval.rows[0].starts_at.toISOString(),endsAt:acceptedInterval.rows[0].ends_at.toISOString(),reason:'Konflik interval fiktif'});
      assert.equal(conflictingBlock.status,409);
      const vetProfileBefore=await database.query('SELECT count(*)::int AS count FROM consultations WHERE vet_id=$1',[vet.user.id]);
      const updatedAvailability=await sendJson(healthy.baseUrl,'/v1/me/vet/availability',vet.accessToken,'PUT',{...availBody,expectedVersion:Number(availabilityResult.value.version),acceptingNewRequests:false});
      assert.equal(updatedAvailability.status,200,await updatedAvailability.clone().text());
      assert.equal(Number((await database.query('SELECT count(*)::int AS count FROM consultations WHERE vet_id=$1',[vet.user.id])).rows[0].count),Number(vetProfileBefore.rows[0].count));
      const createdAnimalResponse = await sendJson(healthy.baseUrl, '/v1/livestock', farmer.accessToken, 'POST', {
        farmId: secondFarm.id, displayCode: 'new-001', name: 'Anak Fiktif', species: 'kambing', sex: 'unknown', estimatedAgeMonths: 2, weightKg: 12.5,
      });
      assert.equal(createdAnimalResponse.status, 201);
      const createdAnimal = await createdAnimalResponse.json();
      assert.equal(createdAnimal.displayCode, 'NEW-001');
      assert.equal(createdAnimal.farmId, secondFarm.id);
      assert.equal(typeof createdAnimal.weightKg,'string');
      assert.equal(Number(createdAnimal.weightKg),12.5);
      assert.ok(Number.isFinite(Date.parse(createdAnimal.createdAt)));
      assert.equal('farm_id' in createdAnimal,false);
      const pagingAnimals = [];
      for (const number of [1,2]) {
        const response = await sendJson(healthy.baseUrl,'/v1/livestock',farmer.accessToken,'POST',{
          farmId:secondFarm.id,displayCode:`PAGE-00${number}`,name:`Ternak Pagination ${number}`,species:'kambing',sex:'unknown',weightKg:number+1,
        });
        assert.equal(response.status,201,await response.clone().text());
        pagingAnimals.push(await response.json());
      }
      const farmerLivestockArrayResponse = await sendJson(healthy.baseUrl,'/v1/livestock',farmer.accessToken,'GET');
      assert.equal(farmerLivestockArrayResponse.status,200);
      const farmerLivestockArray = await farmerLivestockArrayResponse.json();
      assert.ok(Array.isArray(farmerLivestockArray));
      assert.ok(farmerLivestockArray.every((animal)=>typeof animal.farmId==='string'&&typeof animal.createdAt==='string'));
      const farmerLivestockDetail = await sendJson(healthy.baseUrl,`/v1/livestock/${createdAnimal.id}`,farmer.accessToken,'GET');
      assert.equal(farmerLivestockDetail.status,200);
      assert.deepEqual(await farmerLivestockDetail.json(),createdAnimal);
      const farmerPageIds = [];
      let farmerCursor;
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const query = farmerCursor ? `?limit=2&cursor=${encodeURIComponent(farmerCursor)}` : '?limit=2';
        const pageResponse = await sendJson(healthy.baseUrl,`/v1/livestock/page${query}`,farmer.accessToken,'GET');
        assert.equal(pageResponse.status,200,await pageResponse.clone().text());
        const page = await pageResponse.json();
        farmerPageIds.push(...page.items.map((animal)=>animal.id));
        if (!page.hasMore) {
          assert.equal(page.nextCursor,null);
          break;
        }
        assert.ok(page.nextCursor);
        assert.throws(()=>JSON.parse(page.nextCursor));
        farmerCursor = page.nextCursor;
        if (pageIndex === 0) assert.equal(farmerCursor.includes(farmer.user.id),false);
        assert.ok(pageIndex < 9,'Pagination must terminate.');
      }
      assert.equal(new Set(farmerPageIds).size,farmerPageIds.length,'Cursor pages must not repeat livestock.');
      assert.deepEqual([...farmerPageIds].sort(),farmerLivestockArray.map((animal)=>animal.id).sort(),'Cursor pages must not skip owner livestock.');
      assert.equal((await sendJson(healthy.baseUrl,`/v1/livestock/page?cursor=not-a-cursor`,farmer.accessToken,'GET')).status,400);
      assert.equal((await sendJson(healthy.baseUrl,`/v1/livestock/page?cursor=${encodeURIComponent(farmerCursor)}`,outsider.accessToken,'GET')).status,400);
      assert.deepEqual((await (await sendJson(healthy.baseUrl,'/v1/livestock/page',outsider.accessToken,'GET')).json()).items,[]);
      unpaidConsultationId = randomUUID();
      consultationIds.push(unpaidConsultationId);
      await database.query(`INSERT INTO consultations
        (id, display_code, farmer_id, vet_id, animal_id, service_type, complaint, status,
         starts_at, ends_at, fee_snapshot_idr, commission_snapshot_idr)
        VALUES ($1, $2, $3, $4, $5, 'chat', 'Booking fiktif belum dibayar', 'awaiting_payment',
                now() + interval '3 hours', now() + interval '4 hours', 1000, 0)`,
        [unpaidConsultationId, `BE03-${unpaidConsultationId}`, farmer.user.id, vet.user.id, createdAnimal.id]);
      const quoteResponse = await sendJson(healthy.baseUrl, `/v1/payment-quotes/consultation/${unpaidConsultationId}`, farmer.accessToken, 'GET');
      assert.equal(quoteResponse.status, 200);
      assert.equal((await quoteResponse.json()).amountIdr, 1000);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payment-quotes/consultation/${unpaidConsultationId}`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payment-quotes/order/${randomUUID()}`, farmer.accessToken, 'GET')).status, 404);
      const paymentBody = { payableType: 'consultation', payableId: unpaidConsultationId, method: 'bank_transfer' };
      const firstKey = `be06-first-${randomUUID()}`;
      const firstPaymentResponses = await Promise.all([
        sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST', paymentBody, { 'idempotency-key': firstKey }),
        sendJson(healthy.baseUrl, '/v1/payments', farmerDeviceB.accessToken, 'POST', paymentBody, { 'idempotency-key': firstKey }),
      ]);
      assert.deepEqual(firstPaymentResponses.map((response) => response.status), [201, 201]);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/payments', vet.accessToken, 'POST', paymentBody, { 'idempotency-key': `be06-vet-${randomUUID()}` })).status, 403);
      const firstPaymentBodies = await Promise.all(firstPaymentResponses.map((response) => response.json()));
      assert.equal(firstPaymentBodies[0].id, firstPaymentBodies[1].id);
      assert.equal(firstPaymentBodies[0].attempt.id, firstPaymentBodies[1].attempt.id);
      const firstPayment = firstPaymentBodies[0];
      assert.equal(firstPayment.status, 'pending');
      assert.equal(firstPayment.amountIdr, 1000);
      const paymentLookupPath = `/v1/payments?payableType=consultation&payableId=${unpaidConsultationId}`;
      const paymentReadFromDeviceB = await sendJson(healthy.baseUrl, paymentLookupPath, farmerDeviceB.accessToken, 'GET');
      assert.equal(paymentReadFromDeviceB.status, 200, await paymentReadFromDeviceB.clone().text());
      const paymentFromDeviceB = await paymentReadFromDeviceB.json();
      assert.equal(paymentFromDeviceB.id, firstPayment.id);
      assert.equal(paymentFromDeviceB.status, 'pending');
      assert.equal(paymentFromDeviceB.method, 'bank_transfer');
      assert.equal(paymentFromDeviceB.attempt.status, 'pending');
      assert.deepEqual(paymentFromDeviceB.attempts.map((attempt) => attempt.status), ['pending']);
      assert.deepEqual(paymentFromDeviceB.attempts.map((attempt) => attempt.attemptNumber), [1]);
      const paymentReadById = await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}`, farmerDeviceB.accessToken, 'GET');
      assert.equal(paymentReadById.status, 200);
      assert.equal((await paymentReadById.json()).id, firstPayment.id);
      const attemptsRead = await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}/attempts`, farmerDeviceB.accessToken, 'GET');
      assert.equal(attemptsRead.status, 200);
      assert.equal((await attemptsRead.json()).items[0].id, firstPayment.attempt.id);
      assert.equal((await sendJson(healthy.baseUrl, paymentLookupPath, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}/attempts`, outsider.accessToken, 'GET')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}`, vet.accessToken, 'GET')).status, 403);
      const concurrentPaymentRows = await database.query(`SELECT count(DISTINCT p.id)::int AS payments,count(a.id)::int AS attempts
        FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE p.payable_id=$1`, [unpaidConsultationId]);
      assert.deepEqual(concurrentPaymentRows.rows[0], { payments: 1, attempts: 1 });
      const replayResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST', paymentBody, { 'idempotency-key': firstKey });
      assert.equal((await replayResponse.json()).id, firstPayment.id);
      const parallelPending = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST', paymentBody, { 'idempotency-key': `be06-other-${randomUUID()}` });
      assert.equal(parallelPending.status, 409);
      {
        const callbackBase = { paymentId: firstPayment.id, attemptId: firstPayment.attempt.id, reference: firstPayment.attempt.reference, amountIdr: '1000' };
        await assert.rejects(localPayment.localCallback({ ...callbackBase, eventId: `be06-wrong-${randomUUID()}`, outcome: 'failed', amountIdr: '999' }));
        await assert.rejects(localPayment.localCallback({ ...callbackBase, eventId: `be06-reference-${randomUUID()}`, outcome: 'failed', reference: 'local:wrong' }));
        const failedEventId = `be06-failed-${randomUUID()}`;
        assert.equal((await localPayment.localCallback({ ...callbackBase, eventId: failedEventId, outcome: 'failed' })).status, 'failed');
        assert.equal((await localPayment.localCallback({ ...callbackBase, eventId: failedEventId, outcome: 'failed' })).status, 'failed');
        const failedPaymentRead = await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}`, farmerDeviceB.accessToken, 'GET');
        assert.equal(failedPaymentRead.status, 200);
        const failedPayment = await failedPaymentRead.json();
        assert.equal(failedPayment.status, 'failed');
        assert.equal(failedPayment.attempt.status, 'failed');
        assert.deepEqual(failedPayment.attempts.map((attempt) => attempt.status), ['failed']);
        const secondKey = `be06-retry-${randomUUID()}`;
        const retryResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmerDeviceB.accessToken, 'POST', paymentBody, { 'idempotency-key': secondKey });
        assert.equal(retryResponse.status, 201);
        const retried = await retryResponse.json();
        assert.equal(retried.id, firstPayment.id);
        assert.notEqual(retried.attempt.id, firstPayment.attempt.id);
        assert.equal(retried.status, 'pending');
        const retryHistoryRead = await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}`, farmer.accessToken, 'GET');
        assert.equal(retryHistoryRead.status, 200);
        const retryHistory = await retryHistoryRead.json();
        assert.equal(retryHistory.status, 'pending');
        assert.equal(retryHistory.attempt.id, retried.attempt.id);
        assert.deepEqual(retryHistory.attempts.map((attempt) => attempt.status), ['failed', 'pending']);
        assert.deepEqual(retryHistory.attempts.map((attempt) => attempt.attemptNumber), [1, 2]);
        const successEventId = `be06-success-${randomUUID()}`;
        const successInput = { paymentId: retried.id, attemptId: retried.attempt.id, reference: retried.attempt.reference, amountIdr: '1000', eventId: successEventId, outcome: 'succeeded' };
        assert.equal((await localPayment.localCallback(successInput)).status, 'succeeded');
        assert.equal((await localPayment.localCallback(successInput)).status, 'succeeded');
        await assert.rejects(localPayment.localCallback({ ...successInput, outcome: 'failed' }));
        const succeededRead = await sendJson(healthy.baseUrl, paymentLookupPath, farmerDeviceB.accessToken, 'GET');
        assert.equal(succeededRead.status, 200);
        const succeededPayment = await succeededRead.json();
        assert.equal(succeededPayment.id, firstPayment.id);
        assert.equal(succeededPayment.status, 'succeeded');
        assert.equal(succeededPayment.attempt.status, 'succeeded');
        assert.deepEqual(succeededPayment.attempts.map((attempt) => attempt.status), ['failed', 'succeeded']);
        const allAttemptsRead = await sendJson(healthy.baseUrl, `/v1/payments/${firstPayment.id}/attempts`, farmer.accessToken, 'GET');
        assert.equal(allAttemptsRead.status, 200);
        assert.deepEqual((await allAttemptsRead.json()).items.map((attempt) => attempt.attemptNumber), [1, 2]);
        const counts = await database.query(`SELECT count(DISTINCT p.id)::int payments,count(a.id)::int attempts
          FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE p.payable_id=$1`, [unpaidConsultationId]);
        assert.deepEqual(counts.rows[0], { payments: 1, attempts: 2 });
      }
      const farmerDeviceBPaymentRead = await sendJson(healthy.baseUrl, `/v1/consultations/${unpaidConsultationId}`, farmerDeviceB.accessToken, 'GET');
      assert.equal(farmerDeviceBPaymentRead.status, 200);
      assert.equal((await farmerDeviceBPaymentRead.json()).status, 'requested');
      const scheduleFrom=new Date().toISOString();
      const scheduleTo=new Date(Date.now()+5*60*60*1000).toISOString();
      const vetSchedule=await sendJson(healthy.baseUrl,`/v1/me/vet/schedule?from=${encodeURIComponent(scheduleFrom)}&to=${encodeURIComponent(scheduleTo)}`,vet.accessToken,'GET');
      assert.equal(vetSchedule.status,200);
      assert.deepEqual((await vetSchedule.json()).appointments.map(item=>item.id).sort(),[consultationId,unpaidConsultationId].sort());
      for (const status of ['draft', 'awaiting_payment']) {
        const hiddenPatientConsultationId = randomUUID();
        consultationIds.push(hiddenPatientConsultationId);
        await database.query(`INSERT INTO consultations
          (id, display_code, farmer_id, vet_id, animal_id, service_type, complaint, status,
           starts_at, ends_at, fee_snapshot_idr, commission_snapshot_idr)
          VALUES ($1, $2, $3, $4, $5, 'chat', 'Booking fiktif tersembunyi', $6,
                  now() + interval '5 hours', now() + interval '6 hours', 1000, 0)`,
        [hiddenPatientConsultationId, `BE16-${hiddenPatientConsultationId}`, farmer.user.id, vet.user.id, createdAnimal.id, status]);
      }
      const farmTakeover = await sendJson(healthy.baseUrl, '/v1/livestock', outsider.accessToken, 'POST', {
        farmId, displayCode: 'TAKE-001', name: 'Tidak boleh', species: 'sapi', sex: 'female',
      });
      assert.equal(farmTakeover.status, 404);
      const outsiderAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}`, outsider.accessToken, 'GET');
      assert.equal(outsiderAnimal.status, 404);
      const vetUnrelatedAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, unverifiedVet.accessToken, 'GET');
      assert.equal(vetUnrelatedAnimal.status, 404);
      const vetPatientList = await sendJson(healthy.baseUrl, '/v1/patients', vet.accessToken, 'GET');
      assert.equal(vetPatientList.status, 200);
      const vetPatients = await vetPatientList.json();
      assert.deepEqual(vetPatients.map((item) => item.id).sort(), [animalId, createdAnimal.id].sort());
      const expectedPatientFields = ['id', 'displayCode', 'name', 'species', 'breed', 'sex', 'birthDate', 'estimatedAgeMonths', 'weightKg', 'farmId', 'farmerId', 'ownerName', 'lastServiceAt', 'serviceCount', 'latestServiceType', 'latestServiceStatus'].sort();
      assert.ok(vetPatients.every((item) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(expectedPatientFields)));
      assert.ok(vetPatients.every((item) => item.ownerName === 'Peternak Fiktif BE-07'));
      assert.ok(vetPatients.every((item) => Number.isInteger(item.serviceCount) && item.serviceCount > 0));
      assert.ok(vetPatients.every((item) => Number.isFinite(Date.parse(item.lastServiceAt))));
      assert.ok(vetPatients.every((item) => ['chat', 'visit'].includes(item.latestServiceType)));
      assert.ok(vetPatients.every((item) => ['requested', 'scheduled', 'reschedule_pending', 'in_progress', 'en_route', 'arrived', 'examining', 'completed', 'rejected', 'cancelled'].includes(item.latestServiceStatus)));
      const newlyAssignedPatient = vetPatients.find((item) => item.id === createdAnimal.id);
      assert.equal(newlyAssignedPatient.latestServiceType, 'chat');
      assert.equal(newlyAssignedPatient.latestServiceStatus, 'requested', 'Draft and awaiting-payment consultations must not replace the visible service.');
      assert.ok(vetPatients.every((item) => item.weightKg === null || typeof item.weightKg === 'string'));
      const expectedPatientFacts = await database.query(`SELECT animal_id,COUNT(*)::int AS service_count,
        MAX(COALESCE(completion_at,starts_at,updated_at)) AS last_service_at
        FROM consultations WHERE vet_id=$1 AND status NOT IN ('draft','awaiting_payment') GROUP BY animal_id`, [vet.user.id]);
      for (const patient of vetPatients) {
        const fact = expectedPatientFacts.rows.find((item) => item.animal_id === patient.id);
        assert.ok(fact, `Patient ${patient.id} must be backed by an assigned non-draft, non-awaiting-payment consultation.`);
        assert.equal(patient.serviceCount, fact.service_count);
        assert.equal(Date.parse(patient.lastServiceAt), fact.last_service_at.getTime());
      }
      const vetLivestockPageOneResponse = await sendJson(healthy.baseUrl,'/v1/livestock/page?limit=1',vet.accessToken,'GET');
      assert.equal(vetLivestockPageOneResponse.status,200);
      const vetLivestockPageOne = await vetLivestockPageOneResponse.json();
      assert.equal(vetLivestockPageOne.items.length,1);
      assert.equal(vetLivestockPageOne.hasMore,true);
      const vetLivestockPageTwoResponse = await sendJson(healthy.baseUrl,`/v1/livestock/page?limit=1&cursor=${encodeURIComponent(vetLivestockPageOne.nextCursor)}`,vet.accessToken,'GET');
      assert.equal(vetLivestockPageTwoResponse.status,200);
      const vetLivestockPageTwo = await vetLivestockPageTwoResponse.json();
      assert.equal(vetLivestockPageTwo.hasMore,false);
      const vetPagedIds=[...vetLivestockPageOne.items,...vetLivestockPageTwo.items].map((animal)=>animal.id);
      assert.equal(new Set(vetPagedIds).size,vetPagedIds.length);
      assert.deepEqual(vetPagedIds.sort(),vetPatients.map((animal)=>animal.id).sort());
      const unverifiedVetPatientPage = await (await sendJson(healthy.baseUrl,'/v1/livestock/page?limit=1',unverifiedVet.accessToken,'GET')).json();
      assert.deepEqual(unverifiedVetPatientPage.items.map((animal)=>animal.id),[animalId],'A Dokter may read only the animal attached to their own request, even when verification prevents acceptance.');
      assert.equal((await sendJson(healthy.baseUrl,`/v1/livestock/page?cursor=${encodeURIComponent(farmerCursor)}`,vet.accessToken,'GET')).status,400);
      const outsiderPatientList = await sendJson(healthy.baseUrl, '/v1/patients', outsider.accessToken, 'GET');
      assert.equal(outsiderPatientList.status, 403);
      const patchAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Anak Fiktif Revisi' });
      assert.equal(patchAnimal.status, 200);
      const staleAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Stale' });
      assert.equal(staleAnimal.status, 404);
      const careBody = { kind: 'care', occurredAt: new Date().toISOString(), description: 'Catatan perawatan fiktif', sourceKey: `be03-${randomUUID()}` };
      const careFirst = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careFirst.status, 201);
      const careFirstBody = await careFirst.json();
      assert.deepEqual(Object.keys(careFirstBody).sort(), ['id', 'kind', 'occurredAt', 'description', 'provenance'].sort());
      assert.equal(careFirstBody.provenance, 'farmer_report');
      assert.equal('sourceKey' in careFirstBody, false);
      assert.equal('createdAt' in careFirstBody, false);
      const careAgain = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careAgain.status, 201);
      const careAgainBody = await careAgain.json();
      assert.equal(careAgainBody.id, careFirstBody.id);
      assert.deepEqual(Object.keys(careAgainBody).sort(), ['id', 'kind', 'occurredAt', 'description', 'provenance'].sort());
      const careConflict = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken,
        'POST', { ...careBody, description: 'Payload laporan yang berbeda' });
      assert.equal(careConflict.status, 409);

      const notePath = `/v1/consultations/${consultationId}/note`;
      assert.equal((await sendJson(healthy.baseUrl, notePath, farmer.accessToken, 'GET')).status, 404);
      const emptyDraft = await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'GET');
      assert.equal(emptyDraft.status, 200);
      assert.equal((await emptyDraft.json()).version, 1);
      assert.equal((await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'PUT', { expectedVersion: 1, assessment: 'Terlalu dini' })).status, 422);
      await database.query("UPDATE consultations SET status='in_progress' WHERE id=$1", [consultationId]);
      const partialNote = await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'PUT', { expectedVersion: 1, assessment: 'Penilaian fiktif awal' });
      assert.equal(partialNote.status, 200);
      const requiredFailure = await sendJson(healthy.baseUrl, `${notePath}/finalize`, vet.accessToken, 'POST', { expectedVersion: 1 });
      assert.equal(requiredFailure.status, 422);
      const completeDraft = await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'PUT', { expectedVersion: 1, complaint: 'Keluhan fiktif', findings: 'Temuan pemeriksaan fiktif', assessment: 'Penilaian fiktif akhir', actions: 'Tindakan fiktif', careInstructions: 'Instruksi perawatan fiktif' });
      assert.equal(completeDraft.status, 200);
      const recommendationBeforeFinal = await sendJson(healthy.baseUrl, `/v1/consultations/${consultationId}/recommendation`, vet.accessToken,
        'PUT', { expectedVersion: 1, items: [{ title: 'Item fiktif sebelum final' }] });
      assert.equal(recommendationBeforeFinal.status, 422, await recommendationBeforeFinal.clone().text());
      assert.equal((await recommendationBeforeFinal.json()).code, 'RULE_VIOLATION');
      const staleReview = await sendJson(healthy.baseUrl, `${notePath}/finalize`, vet.accessToken, 'POST', { expectedVersion: 1 });
      assert.equal(staleReview.status, 409);
      const finalizedNote = await sendJson(healthy.baseUrl, `${notePath}/finalize`, vet.accessToken, 'POST', { expectedVersion: 2 });
      assert.equal(finalizedNote.status, 201);
      assert.equal((await finalizedNote.json()).status, 'final');
      assert.equal((await database.query('SELECT status FROM consultations WHERE id=$1', [consultationId])).rows[0].status, 'in_progress');
      assert.equal((await sendJson(healthy.baseUrl, notePath, farmer.accessToken, 'GET')).status, 200);
      assert.equal((await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'PUT', { expectedVersion: 3, assessment: 'Tidak dapat mengubah final' })).status, 409);

      const followUpsPath = `/v1/consultations/${consultationId}/follow-ups`;
      const invalidFollowUp = await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'POST', {
        startsAt: new Date(`${localDate}T18:00:00+07:00`).toISOString(),
        endsAt: new Date(`${localDate}T22:30:00+07:00`).toISOString(), reason: 'Jadwal pemeriksaan ulang fiktif',
      }, { 'idempotency-key': `be09-invalid-${randomUUID()}` });
      assert.equal(invalidFollowUp.status, 422);
      assert.equal((await sendJson(healthy.baseUrl, followUpsPath, farmer.accessToken, 'POST', {
        startsAt: new Date(`${localDate}T18:00:00+07:00`).toISOString(),
        endsAt: new Date(`${localDate}T18:30:00+07:00`).toISOString(), reason: 'Pemeriksaan ulang fiktif',
      }, { 'idempotency-key': `be09-role-${randomUUID()}` })).status, 403);
      const followUpStart = new Date(`${localDate}T18:00:00+07:00`).toISOString();
      const followUpEnd = new Date(`${localDate}T18:30:00+07:00`).toISOString();
      const followUpBody = { startsAt: followUpStart, endsAt: followUpEnd, reason: 'Pemeriksaan ulang ternak fiktif.' };
      const followUpKey = `be09-follow-${randomUUID()}`;
      const followUpResponse = await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'POST', followUpBody, { 'idempotency-key': followUpKey });
      assert.equal(followUpResponse.status, 201, await followUpResponse.clone().text());
      const followUp = await followUpResponse.json();
      assert.equal(followUp.status, 'scheduled');
      assert.equal(followUp.kind, 'recheck');
      assert.equal(followUp.timezone, 'Asia/Jakarta');
      const followUpReplay = await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'POST', followUpBody, { 'idempotency-key': followUpKey });
      assert.equal(followUpReplay.status, 201);
      assert.equal((await followUpReplay.json()).id, followUp.id);
      assert.equal((await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'POST', {
        ...followUpBody, reason: 'Isi jadwal berbeda.',
      }, { 'idempotency-key': followUpKey })).status, 409);
      const overlappingFollowUp = await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'POST', {
        startsAt: new Date(`${localDate}T18:15:00+07:00`).toISOString(),
        endsAt: new Date(`${localDate}T18:45:00+07:00`).toISOString(), reason: 'Jadwal bertumpuk fiktif',
      }, { 'idempotency-key': `be09-overlap-${randomUUID()}` });
      assert.equal(overlappingFollowUp.status, 409);
      assert.equal((await sendJson(healthy.baseUrl, followUpsPath, outsider.accessToken, 'GET')).status, 404);
      const followUpPage = await sendJson(healthy.baseUrl, followUpsPath, vet.accessToken, 'GET');
      assert.ok((await followUpPage.json()).items.some((item) => item.id === followUp.id));
      const followUpById = await sendJson(healthy.baseUrl, `/v1/follow-ups/${followUp.id}`, farmer.accessToken, 'GET');
      assert.equal(followUpById.status, 200);
      assert.equal((await followUpById.json()).id, followUp.id);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/follow-ups/${followUp.id}`, outsider.accessToken, 'GET')).status, 404);
      const slotsAfterFollowUp = await (await sendJson(healthy.baseUrl,
        `/v1/vets/${vet.user.id}/slots?dateFrom=${localDate}&dateTo=${localDate}&service=chat`, farmer.accessToken, 'GET')).json();
      assert.ok(!slotsAfterFollowUp.some((slot) => new Date(slot.startsAt).toISOString() === followUpStart));
      const followUpScheduleFrom = new Date(`${localDate}T00:00:00+07:00`).toISOString();
      const followUpScheduleTo = new Date(`${localDate}T23:59:00+07:00`).toISOString();
      const vetScheduleWithFollowUp = await (await sendJson(healthy.baseUrl,
        `/v1/me/vet/schedule?from=${encodeURIComponent(followUpScheduleFrom)}&to=${encodeURIComponent(followUpScheduleTo)}`, vet.accessToken, 'GET')).json();
      assert.ok(vetScheduleWithFollowUp.followUps.some((item) => item.id === followUp.id));
      const collidingBlockedTime = await sendJson(healthy.baseUrl, '/v1/me/vet/blocked-times', vet.accessToken, 'POST', {
        startsAt: new Date(`${localDate}T18:15:00+07:00`).toISOString(),
        endsAt: new Date(`${localDate}T18:45:00+07:00`).toISOString(), reason: 'Blokir konflik follow-up fiktif',
      });
      assert.equal(collidingBlockedTime.status, 409);

      const progressReportPath = `/v1/follow-ups/${followUp.id}/progress-reports`;
      const reportKey = `be09-report-${randomUUID()}`;
      const reportBody = { text: 'Perkembangan ternak fiktif sudah dicatat.' };
      const reportResponse = await sendJson(healthy.baseUrl, progressReportPath, farmer.accessToken, 'POST', reportBody, { 'idempotency-key': reportKey });
      assert.equal(reportResponse.status, 201, await reportResponse.clone().text());
      const report = await reportResponse.json();
      assert.equal(report.farmerId, farmer.user.id);
      assert.equal(report.vetId, vet.user.id);
      assert.equal(report.viewedAt, null);
      const farmerReportById = await sendJson(healthy.baseUrl, `/v1/progress-reports/${report.id}`, farmer.accessToken, 'GET');
      assert.equal(farmerReportById.status, 200);
      assert.equal((await farmerReportById.json()).viewedAt, null);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/progress-reports/${report.id}`, outsider.accessToken, 'GET')).status, 404);
      const reportReplay = await sendJson(healthy.baseUrl, progressReportPath, farmer.accessToken, 'POST', reportBody, { 'idempotency-key': reportKey });
      assert.equal((await reportReplay.json()).id, report.id);
      assert.equal((await sendJson(healthy.baseUrl, progressReportPath, farmer.accessToken, 'POST', {
        text: 'Laporan yang berbeda.',
      }, { 'idempotency-key': reportKey })).status, 409);
      assert.equal((await sendJson(healthy.baseUrl, progressReportPath, vet.accessToken, 'POST', reportBody, { 'idempotency-key': `be09-vet-report-${randomUUID()}` })).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, progressReportPath, outsider.accessToken, 'GET')).status, 404);
      const farmerReports = await (await sendJson(healthy.baseUrl, progressReportPath, farmer.accessToken, 'GET')).json();
      assert.equal(farmerReports.items.find((item) => item.id === report.id).viewedAt, null);
      const vetReportById = await sendJson(healthy.baseUrl, `/v1/progress-reports/${report.id}`, vet.accessToken, 'GET');
      assert.equal(vetReportById.status, 200);
      assert.ok((await vetReportById.json()).viewedAt);
      const vetReports = await (await sendJson(healthy.baseUrl, progressReportPath, vet.accessToken, 'GET')).json();
      assert.ok(vetReports.items.find((item) => item.id === report.id).viewedAt);
      assert.equal((await database.query('SELECT status FROM follow_ups WHERE id=$1', [followUp.id])).rows[0].status, 'scheduled');

      const waitForNotification = async (token, eventId, expectedStatus) => {
        const deadline = Date.now() + 8_000;
        let found;
        while (Date.now() < deadline) {
          const response = await sendJson(healthy.baseUrl, '/v1/me/notifications', token, 'GET');
          assert.equal(response.status, 200);
          const inbox = await response.json();
          found = inbox.items.find((item) => item.eventId === eventId);
          if (found?.deliveryStatus === expectedStatus) return found;
          await delay(100);
        }
        assert.fail(`Notifikasi ${eventId} tidak mencapai status ${expectedStatus}; status terakhir ${found?.deliveryStatus ?? 'hilang'}`);
      };

      const followUpNotificationEvent = `follow-up-scheduled:${followUp.id}`;
      const reportNotificationEvent = `progress-report-submitted:${report.id}`;
      const failedNotification = await waitForNotification(farmer.accessToken, followUpNotificationEvent, 'failed');
      const deliveredNotification = await waitForNotification(vet.accessToken, reportNotificationEvent, 'sent');

      const defaultPreferencesResponse = await sendJson(healthy.baseUrl, '/v1/me/preferences', farmer.accessToken, 'GET');
      assert.equal(defaultPreferencesResponse.status, 200);
      const defaultPreferences = await defaultPreferencesResponse.json();
      assert.deepEqual(defaultPreferences.notifications, { consultations: true, reminders: true, commerce: true });
      const retriedNotification = await waitForNotification(farmer.accessToken, followUpNotificationEvent, 'sent');
      assert.equal(retriedNotification.id, failedNotification.id);
      const disabledReminderPreferencesResponse = await sendJson(healthy.baseUrl, '/v1/me/preferences', farmer.accessToken, 'PATCH', {
        notifications: { reminders: false },
      });
      assert.equal(disabledReminderPreferencesResponse.status, 200,
        `${await disabledReminderPreferencesResponse.clone().text()}\n${healthy.output()}`);
      const disabledReminderPreferences = await disabledReminderPreferencesResponse.json();
      assert.deepEqual(disabledReminderPreferences.notifications, { consultations: true, reminders: false, commerce: true });
      assert.equal(disabledReminderPreferences.version, defaultPreferences.version + 1);
      const preferenceReplay = await sendJson(healthy.baseUrl, '/v1/me/preferences', farmer.accessToken, 'PATCH', {
        notifications: { reminders: false },
      });
      assert.equal(preferenceReplay.status, 200);
      assert.equal((await preferenceReplay.json()).version, disabledReminderPreferences.version);

      const reminderDueAt = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString();
      const reminderBody = {
        consultationId, followUpId: followUp.id, kind: 'care', dueAt: reminderDueAt,
        instructions: 'Perawatan kandang fiktif tanpa dosis obat.',
      };
      const reminderKey = `be09-reminder-${randomUUID()}`;
      const reminderResponse = await sendJson(healthy.baseUrl, '/v1/reminders', vet.accessToken, 'POST', reminderBody, { 'idempotency-key': reminderKey });
      assert.equal(reminderResponse.status, 201, await reminderResponse.clone().text());
      const reminderOperation = await reminderResponse.json();
      let reminder = reminderOperation;
      assert.equal(reminder.kind, 'care');
      assert.equal(reminder.careStatus, 'scheduled');
      assert.equal(reminder.deliveryStatus, 'failed');
      assert.equal(reminder.deliveryOutcome.status, 'failed');
      const reminderReplay = await sendJson(healthy.baseUrl, '/v1/reminders', vet.accessToken, 'POST', reminderBody, { 'idempotency-key': reminderKey });
      assert.equal((await reminderReplay.json()).id, reminder.id);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/reminders', vet.accessToken, 'POST', {
        ...reminderBody, instructions: 'Isi reminder berbeda.',
      }, { 'idempotency-key': reminderKey })).status, 409);
      const reminderRead = await sendJson(healthy.baseUrl, '/v1/reminders', farmer.accessToken, 'GET');
      assert.ok((await reminderRead.json()).items.some((item) => item.id === reminder.id));
      const farmerReminderById = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}`, farmer.accessToken, 'GET');
      assert.equal(farmerReminderById.status, 200);
      assert.equal((await farmerReminderById.json()).id, reminder.id);
      const vetReminderById = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}`, vet.accessToken, 'GET');
      assert.equal(vetReminderById.status, 200);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}`, outsider.accessToken, 'GET')).status, 404);
      const wrongOwnerCompletion = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}/complete`, outsider.accessToken, 'POST',
        { confirmation: true }, { 'idempotency-key': `be09-outsider-care-${randomUUID()}` });
      assert.equal(wrongOwnerCompletion.status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}/complete`, vet.accessToken, 'POST',
        { confirmation: true }, { 'idempotency-key': `be09-vet-care-${randomUUID()}` })).status, 403);
      const retryDeliveryKey = `be09-delivery-retry-${randomUUID()}`;
      const deliveryRetry = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}`, vet.accessToken, 'PATCH',
        { action: 'retry_delivery' }, { 'idempotency-key': retryDeliveryKey });
      assert.equal(deliveryRetry.status, 200, await deliveryRetry.clone().text());
      reminder = await deliveryRetry.json();
      assert.equal(reminder.deliveryStatus, 'sent');
      assert.equal(reminder.careStatus, 'scheduled');
      assert.equal(reminder.deliveryAttempt, 2);
      assert.equal(reminder.deliveryOutcome.status, 'succeeded');
      const deliveryReplay = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}`, vet.accessToken, 'PATCH',
        { action: 'retry_delivery' }, { 'idempotency-key': retryDeliveryKey });
      assert.equal((await deliveryReplay.json()).deliveryAttempt, 2);
      const unconfirmedCare = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}/complete`, farmer.accessToken, 'POST',
        { confirmation: false }, { 'idempotency-key': `be09-care-unconfirmed-${randomUUID()}` });
      assert.equal(unconfirmedCare.status, 422);
      const careCompleteKey = `be09-care-${randomUUID()}`;
      const careCompletedResponse = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}/complete`, farmer.accessToken, 'POST',
        { confirmation: true }, { 'idempotency-key': careCompleteKey });
      assert.equal(careCompletedResponse.status, 200, await careCompletedResponse.clone().text());
      const careCompleted = await careCompletedResponse.json();
      assert.equal(careCompleted.reminder.careStatus, 'done');
      assert.equal(careCompleted.reminder.deliveryStatus, 'sent');
      const careReplay = await sendJson(healthy.baseUrl, `/v1/reminders/${reminder.id}/complete`, farmer.accessToken, 'POST',
        { confirmation: true }, { 'idempotency-key': careCompleteKey });
      assert.equal((await careReplay.json()).healthEventId, careCompleted.healthEventId);
      assert.equal((await database.query("SELECT count(*)::int AS count FROM health_events WHERE provenance='reminder' AND source_key=$1", [`reminder:${reminder.id}`])).rows[0].count, 1);
      const careTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, farmer.accessToken, 'GET');
      assert.equal(careTimeline.status, 200);
      assert.equal((await careTimeline.json()).filter((event) => event.description === reminderBody.instructions).length, 1);
      assert.equal((await database.query('SELECT status FROM follow_ups WHERE id=$1', [followUp.id])).rows[0].status, 'scheduled');
      for (const [eventId, actorId, recipientId, type] of [
        [`follow-up-scheduled:${followUp.id}`, vet.user.id, farmer.user.id, 'follow_up_scheduled'],
        [`progress-report-submitted:${report.id}`, farmer.user.id, vet.user.id, 'progress_report_submitted'],
        [`reminder-created:${reminder.id}`, vet.user.id, farmer.user.id, 'reminder_created'],
        [`care-completed:${reminder.id}`, farmer.user.id, vet.user.id, 'care_completed'],
      ]) {
        const notification = await database.query('SELECT actor_id,recipient_id,type FROM notifications WHERE event_id=$1', [eventId]);
        assert.deepEqual(notification.rows[0], { actor_id: actorId, recipient_id: recipientId, type });
      }

      const retryEventId = `progress-report-submitted:${report.id}`;
      assert.equal((await database.query('SELECT count(*)::int AS count FROM domain_events WHERE event_key=$1', [retryEventId])).rows[0].count, 1);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND event_id=$2', [vet.user.id, retryEventId])).rows[0].count, 1);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM notification_outbox WHERE recipient_id=$1 AND event_id=$2', [vet.user.id, retryEventId])).rows[0].count, 1);

      const reminderNotificationEvent = `reminder-created:${reminder.id}`;
      const suppressedNotification = await waitForNotification(farmer.accessToken, reminderNotificationEvent, 'suppressed');
      assert.equal(failedNotification.contextId, followUp.id);
      assert.equal(deliveredNotification.contextId, report.id);
      assert.equal(suppressedNotification.contextId, reminder.id);
      assert.equal(suppressedNotification.category, 'reminders');
      assert.equal((await database.query(
        `SELECT outcome FROM notification_delivery_attempts WHERE notification_id=$1 ORDER BY attempt DESC LIMIT 1`,
        [deliveredNotification.id],
      )).rows[0].outcome, 'succeeded');
      assert.equal((await database.query(
        `SELECT outcome FROM notification_delivery_attempts WHERE notification_id=$1 ORDER BY attempt DESC LIMIT 1`,
        [retriedNotification.id],
      )).rows[0].outcome, 'succeeded');
      assert.deepEqual((await database.query(
        'SELECT outcome FROM notification_delivery_attempts WHERE notification_id=$1 ORDER BY attempt',
        [retriedNotification.id],
      )).rows.map((row) => row.outcome), ['failed', 'succeeded']);
      assert.equal((await database.query(
        `SELECT count(*)::int AS count FROM notification_delivery_attempts WHERE notification_id=$1`,
        [suppressedNotification.id],
      )).rows[0].count, 0);

      const farmerInbox = await (await sendJson(healthy.baseUrl, '/v1/me/notifications', farmer.accessToken, 'GET')).json();
      assert.ok(farmerInbox.items.some((item) => item.id === suppressedNotification.id));
      assert.equal(farmerInbox.unreadCount, farmerInbox.items.filter((item) => !item.readAt).length);
      const readNotificationResponse = await sendJson(healthy.baseUrl, `/v1/me/notifications/${failedNotification.id}/read`, farmer.accessToken, 'POST');
      assert.equal(readNotificationResponse.status, 200, await readNotificationResponse.clone().text());
      const readNotification = await readNotificationResponse.json();
      assert.equal(readNotification.contextId, followUp.id);
      assert.equal(readNotification.contextType, 'follow_up');
      const readReplay = await sendJson(healthy.baseUrl, `/v1/me/notifications/${failedNotification.id}/read`, farmer.accessToken, 'POST');
      assert.equal(readReplay.status, 200);
      assert.equal((await readReplay.json()).notification.readAt, readNotification.notification.readAt);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/notifications/${failedNotification.id}/read`, outsider.accessToken, 'POST')).status, 404);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/me/notifications/${failedNotification.id}/read`, vet.accessToken, 'POST')).status, 404);

      const hiddenLinkNotificationId = randomUUID();
      const hiddenLinkEventId = `be14-hidden-link-${randomUUID()}`;
      const hiddenLinkContextId = randomUUID();
      const hiddenLinkDomainEventId = randomUUID();
      await database.query(
        `INSERT INTO domain_events(id,event_key,event_type,aggregate_type,aggregate_id,actor_id,occurred_at,aggregate_version,payload)
         VALUES($1,$2,'reminder_created','reminder',$3,$4,now(),1,$5::jsonb)`,
        [hiddenLinkDomainEventId, hiddenLinkEventId, hiddenLinkContextId, vet.user.id,
          JSON.stringify({ contextId: hiddenLinkContextId, title: 'Tautan uji privat', body: 'Fixture akses tautan fiktif.', category: 'reminders' })],
      );
      await database.query(
        `INSERT INTO notifications(id,actor_id,recipient_id,type,category,context_type,context_id,event_id,domain_event_id,title,body)
         VALUES($1,$2,$3,'reminder_created','reminders','reminder',$4,$5,$6,'Tautan uji privat','Fixture akses tautan fiktif.')`,
        [hiddenLinkNotificationId, vet.user.id, farmer.user.id, hiddenLinkContextId, hiddenLinkEventId, hiddenLinkDomainEventId],
      );
      await database.query(
        `INSERT INTO notification_outbox(notification_id,recipient_id,event_id,delivery_status)
         VALUES($1,$2,$3,'suppressed')`,
        [hiddenLinkNotificationId, farmer.user.id, hiddenLinkEventId],
      );
      const hiddenLinkRead = await sendJson(healthy.baseUrl, `/v1/me/notifications/${hiddenLinkNotificationId}/read`, farmer.accessToken, 'POST');
      assert.equal(hiddenLinkRead.status, 404);
      assert.equal((await database.query('SELECT read_at FROM notifications WHERE id=$1', [hiddenLinkNotificationId])).rows[0].read_at, null);

      const cancelFollowUp = await sendJson(healthy.baseUrl, `/v1/follow-ups/${followUp.id}`, farmer.accessToken, 'PATCH',
        { action: 'cancel', expectedVersion: followUp.version }, { 'idempotency-key': `be09-cancel-${randomUUID()}` });
      assert.equal(cancelFollowUp.status, 200, await cancelFollowUp.clone().text());
      assert.equal((await cancelFollowUp.json()).status, 'cancelled');

      const recommendationPath = `/v1/consultations/${consultationId}/recommendation`;
      const emptyRecommendation = await sendJson(healthy.baseUrl, `${recommendationPath}/send`, vet.accessToken, 'POST', { expectedVersion: 1 });
      assert.equal(emptyRecommendation.status, 422);
      const savedEmpty = await sendJson(healthy.baseUrl, recommendationPath, vet.accessToken, 'PUT', { expectedVersion: 1, items: [] });
      assert.equal(savedEmpty.status, 200);
      const editOne = await sendJson(healthy.baseUrl, recommendationPath, vet.accessToken, 'PUT', { expectedVersion: 1, items: [{ title: 'Produk fiktif satu', instructions: 'Instruksi fiktif satu' }] });
      assert.equal(editOne.status, 200);
      const inactiveProductLink = await sendJson(healthy.baseUrl, recommendationPath, vet.accessToken, 'PUT', {
        expectedVersion: 2,
        items: [{ productId: productIds[3], title: 'Judul nonaktif dari client' }],
      });
      assert.equal(inactiveProductLink.status, 422);
      const editTwo = await sendJson(healthy.baseUrl, recommendationPath, vet.accessToken, 'PUT', {
        expectedVersion: 2,
        items: [{ productId: productIds[0], title: 'Judul harga dari client yang tidak dipercaya', note: 'Catatan rekomendasi fiktif' }],
      });
      assert.equal(editTwo.status, 200);
      const linkedRecommendation = await editTwo.json();
      assert.equal(linkedRecommendation.items[0].title, 'BE-10 Sikat Kandang Seruni');
      assert.equal(linkedRecommendation.items[0].productId, productIds[0]);
      const sentRecommendation = await sendJson(healthy.baseUrl, `${recommendationPath}/send`, vet.accessToken, 'POST', { expectedVersion: 3 });
      assert.equal(sentRecommendation.status, 201);
      assert.equal((await sentRecommendation.json()).status, 'sent');
      await database.query('UPDATE products SET unit_price_idr=18750 WHERE id=$1', [productIds[0]]);
      const repricedProduct = await sendJson(healthy.baseUrl, `/v1/products/${productIds[0]}`, farmer.accessToken, 'GET');
      assert.equal((await repricedProduct.json()).unitPriceIdr, 18750);
      await database.query('UPDATE products SET active=false WHERE id=$1', [productIds[0]]);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/products/${productIds[0]}`, farmer.accessToken, 'GET')).status, 404);
      const farmerRecommendation = await sendJson(healthy.baseUrl, recommendationPath, farmer.accessToken, 'GET');
      assert.equal(farmerRecommendation.status, 200);
      const sentRecommendationResult = await farmerRecommendation.json();
      assert.equal(sentRecommendationResult.items[0].title, 'BE-10 Sikat Kandang Seruni');
      assert.equal(sentRecommendationResult.items[0].productId, productIds[0]);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/orders', vet.accessToken, 'GET')).status, 403);
      const hiddenDraftTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, farmer.accessToken, 'GET');
      assert.equal(hiddenDraftTimeline.status, 200);
      assert.equal((await hiddenDraftTimeline.json()).length, 3);
      const finalTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, vet.accessToken, 'GET');
      assert.equal(finalTimeline.status, 200);
      const finalEvents = await finalTimeline.json();
      assert.equal(finalEvents.length, 3);
      assert.ok(finalEvents.some((event) => event.description === 'Penilaian fiktif akhir'));
      assert.ok(finalEvents.every((event) => !('attachments' in event)));
      assert.ok(finalEvents.every((event) => JSON.stringify(Object.keys(event).sort()) === JSON.stringify(['id', 'kind', 'occurredAt', 'description', 'provenance', 'createdAt'].sort())));
      assert.equal(finalEvents.filter((event) => event.description === 'Penilaian fiktif akhir' && event.provenance === 'clinical_note').length, 1);
      assert.ok(finalEvents.every((event) => !('actorId' in event) && !('findings' in event) && !('careInstructions' in event)));

      const patientClinicalNotes = await sendJson(healthy.baseUrl, `/v1/patients/${animalId}/clinical-notes`, vet.accessToken, 'GET');
      assert.equal(patientClinicalNotes.status, 200);
      const projectedNotes = await patientClinicalNotes.json();
      const projectedNote = projectedNotes.find((note) => note.consultationId === consultationId);
      assert.ok(projectedNote);
      assert.deepEqual(Object.keys(projectedNote).sort(), ['id', 'consultationId', 'complaint', 'findings', 'assessment', 'actions', 'careInstructions', 'finalizedAt'].sort());
      assert.deepEqual([
        projectedNote.complaint, projectedNote.findings, projectedNote.assessment,
        projectedNote.actions, projectedNote.careInstructions,
      ], ['Keluhan fiktif', 'Temuan pemeriksaan fiktif', 'Penilaian fiktif akhir', 'Tindakan fiktif', 'Instruksi perawatan fiktif']);
      assert.ok(Number.isFinite(Date.parse(projectedNote.finalizedAt)));
      assert.equal((await sendJson(healthy.baseUrl, `/v1/patients/${animalId}/clinical-notes`, farmer.accessToken, 'GET')).status, 403);
      assert.equal((await sendJson(healthy.baseUrl, `/v1/patients/${createdAnimal.id}/clinical-notes`, unverifiedVet.accessToken, 'GET')).status, 404);

      const messagesPath = `/v1/consultations/${consultationId}/messages`;
      const ownerList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, farmer.accessToken, 'GET');
      assert.equal(ownerList.status, 200);
      assert.deepEqual((await ownerList.json()).items, []);
      const relatedList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, vet.accessToken, 'GET');
      assert.equal(relatedList.status, 200);
      const outsiderList = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, outsider.accessToken, 'GET');
      assert.equal(outsiderList.status, 404);

      const clientMessageId = randomUUID();
      const firstBody = { clientMessageId, text: 'Pesan fiktif untuk retry BE-07' };
      await database.query("UPDATE vet_profiles SET verification_status='pending' WHERE user_id=$1",[vet.user.id]);
      const unverifiedSend = await sendJson(healthy.baseUrl, messagesPath, vet.accessToken, 'POST', firstBody);
      assert.equal(unverifiedSend.status, 403);
      const farmerToUnverifiedVet = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(farmerToUnverifiedVet.status, 403);
      await database.query("UPDATE vet_profiles SET verification_status = 'verified' WHERE user_id = $1", [vet.user.id]);

      const firstSend = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(firstSend.status, 201);
      const failedMessage = await firstSend.json();
      assert.equal(failedMessage.deliveryStatus, 'failed');
      assert.equal(failedMessage.deliveryAttempt, 1);
      const recipientBeforeRetry = await sendJson(healthy.baseUrl, `${messagesPath}?limit=10`, vet.accessToken, 'GET');
      assert.deepEqual((await recipientBeforeRetry.json()).items, []);

      const retried = await sendJson(healthy.baseUrl, `${messagesPath}/${failedMessage.id}/retry`, farmer.accessToken, 'POST');
      assert.equal(retried.status, 200);
      const deliveredMessage = await retried.json();
      assert.equal(deliveredMessage.id, failedMessage.id);
      assert.equal(deliveredMessage.deliveryStatus, 'sent');
      assert.equal(deliveredMessage.deliveryAttempt, 2);
      const duplicate = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', firstBody);
      assert.equal(duplicate.status, 201);
      assert.equal((await duplicate.json()).id, failedMessage.id);
      const fingerprintConflict = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', { ...firstBody, text: 'Isi berbeda' });
      assert.equal(fingerprintConflict.status, 409);

      for (let index = 0; index < 3; index += 1) {
        const response = await sendJson(healthy.baseUrl, messagesPath, vet.accessToken, 'POST', {
          clientMessageId: randomUUID(),
          text: `Pesan fiktif ${index + 1}`,
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).deliveryStatus, 'sent');
      }

      const uploadKey = `be07-upload-${randomUUID()}`;
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
      failedStorageServer = await startServer(await availablePort(), {
        MEDIA_STORAGE_DIR: '/dev/null/vetlink-be07-private-media',
        MEDIA_IMAGE_MAX_BYTES: String(10 * 1024 * 1024),
        MEDIA_VIDEO_MAX_BYTES: String(50 * 1024 * 1024),
      });
      const failedUpload = await fetch(`${failedStorageServer.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': uploadKey },
        body: uploadBody(consultationId, jpeg, 'image/jpeg', 'ternak.jpg'),
      });
      assert.equal(failedUpload.status, 503);
      await stopServer(failedStorageServer.child);
      failedStorageServer = undefined;

      const invalidMime = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': `be07-invalid-${randomUUID()}` },
        body: uploadBody(consultationId, jpeg, 'image/png', 'bukan-png.png'),
      });
      assert.equal(invalidMime.status, 400);
      const tooLargeBytes = Buffer.alloc(10 * 1024 * 1024 + 1);
      tooLargeBytes.set([0xff, 0xd8, 0xff]);
      const oversized = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': `be07-large-${randomUUID()}` },
        body: uploadBody(consultationId, tooLargeBytes, 'image/jpeg', 'terlalu-besar.jpg'),
      });
      assert.equal(oversized.status, 400);

      const uploadedResponse = await fetch(`${healthy.baseUrl}/v1/attachments/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${farmer.accessToken}`, 'Idempotency-Key': uploadKey },
        body: uploadBody(consultationId, jpeg, 'image/jpeg', 'ternak.jpg'),
      });
      assert.equal(uploadedResponse.status, 201);
      const uploaded = await uploadedResponse.json();
      assert.equal(uploaded.uploadStatus, 'uploaded');
      assert.equal('storageKey' in uploaded, false);
      assert.equal('localUri' in uploaded, false);
      const committedResponse = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}/commit`, farmer.accessToken, 'POST');
      assert.equal(committedResponse.status, 200);
      const committed = await committedResponse.json();
      assert.equal(committed.uploadStatus, 'committed');
      const hiddenBeforeMessage = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}`, vet.accessToken, 'GET');
      assert.equal(hiddenBeforeMessage.status, 404);

      const mediaMessageResponse = await sendJson(healthy.baseUrl, messagesPath, farmer.accessToken, 'POST', {
        clientMessageId: randomUUID(),
        attachmentIds: [uploaded.id],
      });
      assert.equal(mediaMessageResponse.status, 201);
      const mediaMessage = await mediaMessageResponse.json();
      assert.equal(mediaMessage.deliveryStatus, 'sent');
      assert.equal(mediaMessage.attachments[0].id, uploaded.id);
      const recipientMetadata = await sendJson(healthy.baseUrl, `/v1/attachments/${uploaded.id}`, vet.accessToken, 'GET');
      assert.equal(recipientMetadata.status, 200);
      const downloaded = await fetch(`${healthy.baseUrl}/v1/attachments/${uploaded.id}/content`, {
        headers: { authorization: `Bearer ${vet.accessToken}` },
      });
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
      assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), jpeg);
      const outsiderDownload = await fetch(`${healthy.baseUrl}/v1/attachments/${uploaded.id}/content`, {
        headers: { authorization: `Bearer ${outsider.accessToken}` },
      });
      assert.equal(outsiderDownload.status, 404);

      const pageOneResponse = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2`, farmer.accessToken, 'GET');
      assert.equal(pageOneResponse.status, 200);
      const pageOne = await pageOneResponse.json();
      assert.equal(pageOne.items.length, 2);
      assert.equal(pageOne.hasMore, true);
      assert.ok(pageOne.nextCursor);
      const pageTwoResponse = await sendJson(healthy.baseUrl, `${messagesPath}?limit=2&cursor=${encodeURIComponent(pageOne.nextCursor)}`, farmer.accessToken, 'GET');
      assert.equal(pageTwoResponse.status, 200);
      const pageTwo = await pageTwoResponse.json();
      assert.equal(pageTwo.items.length, 2);
      assert.equal(new Set([...pageOne.items, ...pageTwo.items].map((item) => item.id)).size, 4);

      const chatVersion = Number((await database.query('SELECT version FROM consultations WHERE id=$1', [consultationId])).rows[0].version);
      const completeChat = await sendJson(healthy.baseUrl, `/v1/consultations/${consultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: chatVersion, confirmation: true }, { 'idempotency-key': `be05-complete-chat-${randomUUID()}` });
      assert.equal(completeChat.status, 200, await completeChat.clone().text());
      assert.equal((await completeChat.json()).consultation.status, 'completed');
      const secondReviewResponse = await sendJson(healthy.baseUrl, `/v1/consultations/${consultationId}/review`, farmer.accessToken, 'POST', { stars: 4 });
      assert.equal(secondReviewResponse.status, 201, await secondReviewResponse.clone().text());
      const firstReviewPage = await (await sendJson(healthy.baseUrl, `/v1/vets/${vet.user.id}/reviews?limit=1`, farmer.accessToken, 'GET')).json();
      assert.equal(firstReviewPage.items.length, 1);
      assert.equal(firstReviewPage.hasMore, true);
      const secondReviewPage = await (await sendJson(healthy.baseUrl,
        `/v1/vets/${vet.user.id}/reviews?limit=1&cursor=${encodeURIComponent(firstReviewPage.nextCursor)}`, vet.accessToken, 'GET')).json();
      assert.equal(secondReviewPage.items.length, 1);
      assert.equal(secondReviewPage.hasMore, false);
      const allRatings = [...firstReviewPage.items, ...secondReviewPage.items].map((review) => review.stars);
      assert.equal(allRatings.length, 2);
      assert.equal(allRatings.reduce((sum, rating) => sum + rating, 0) / allRatings.length, 4.5);
      const finalVetProfile = await (await sendJson(healthy.baseUrl, `/v1/vets/${vet.user.id}`, farmer.accessToken, 'GET')).json();
      assert.equal(finalVetProfile.ratingAverage, 4.5);
      assert.equal(finalVetProfile.ratingCount, 2);
      const vetDirectory = await (await sendJson(healthy.baseUrl, '/v1/vets', farmer.accessToken, 'GET')).json();
      const directoryVet = vetDirectory.find((item) => item.id === vet.user.id);
      assert.equal(directoryVet.ratingAverage, 4.5);
      assert.equal(directoryVet.ratingCount, 2);

      console.log('BE-03/04/05/06/07/08/09/10/11/12/13/14/15 smoke: owner/role scope; assigned patient clinical-note projection; completed-consultation reviews; follow-up slot reservation, report ownership, reminder delivery/care completion, one HealthEvent; BE-14 event/outbox deduplication, notification delivery outcomes, preference suppression, inbox persistence, idempotent read and linked-resource access; catalog, commerce/shipment, earnings/withdrawals, chat/media lulus.');
    } finally {
      if (failedStorageServer) await stopServer(failedStorageServer.child);
      // Smoke teardown is a fixture reset; it must remove immutable final-note rows
      // without weakening the production immutability trigger.
      await database.query("SET session_replication_role = 'replica'");
      const allConsultationIds = [...new Set([...consultationIds, consultationId, unpaidConsultationId].filter(Boolean))];
      const allOrderIds = [...new Set(orderIds)];
      try {
        await database.query('DELETE FROM ledger_entries WHERE vet_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM earning_settlement_events WHERE earning_id IN (SELECT id FROM earning_transactions WHERE vet_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM earning_transactions WHERE vet_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM withdrawal_adapter_events WHERE withdrawal_id IN (SELECT id FROM withdrawals WHERE vet_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM withdrawals WHERE vet_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM payout_destinations WHERE vet_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM shipment_events WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id = ANY($1::uuid[]))', [allOrderIds]);
        await database.query('DELETE FROM shipments WHERE order_id = ANY($1::uuid[])', [allOrderIds]);
        await database.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [allOrderIds]);
        await database.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [allOrderIds]);
        await database.query('DELETE FROM checkout_quotes WHERE id = ANY($1::uuid[])', [checkoutQuoteIds]);
        await database.query('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE farmer_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM carts WHERE farmer_id = ANY($1::uuid[])', [actors]);
        await database.query("DELETE FROM payment_callback_events WHERE payment_id IN (SELECT id FROM payments WHERE payable_type='order' AND payable_id = ANY($1::uuid[]))", [allOrderIds]);
        await database.query("DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE payable_type='order' AND payable_id = ANY($1::uuid[]))", [allOrderIds]);
        await database.query("DELETE FROM payments WHERE payable_type='order' AND payable_id = ANY($1::uuid[])", [allOrderIds]);
        await database.query('DELETE FROM recommendation_items WHERE recommendation_id IN (SELECT id FROM recommendations WHERE consultation_id = ANY($1::uuid[]))', [allConsultationIds]);
        await database.query('DELETE FROM recommendations WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM progress_report_attachments WHERE report_id IN (SELECT id FROM progress_reports WHERE consultation_id = ANY($1::uuid[]))', [allConsultationIds]);
        await database.query('DELETE FROM care_coordination_operations WHERE actor_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM reminder_delivery_attempts WHERE reminder_id IN (SELECT id FROM reminders WHERE farmer_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM progress_reports WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM notification_delivery_attempts WHERE notification_id IN (SELECT id FROM notifications WHERE actor_id = ANY($1::uuid[]) OR recipient_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM notification_outbox WHERE recipient_id = ANY($1::uuid[]) OR notification_id IN (SELECT id FROM notifications WHERE actor_id = ANY($1::uuid[]))', [actors]);
        await database.query('DELETE FROM notifications WHERE actor_id = ANY($1::uuid[]) OR recipient_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM domain_events WHERE actor_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM reminders WHERE farmer_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM follow_ups WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM message_attachments WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_messages WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM attachments WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM health_events WHERE actor_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM clinical_notes WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM payment_callback_events WHERE payment_id IN (SELECT id FROM payments WHERE payable_type=\'consultation\' AND payable_id = ANY($1::uuid[]))', [allConsultationIds]);
        await database.query('DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE payable_type=\'consultation\' AND payable_id = ANY($1::uuid[]))', [allConsultationIds]);
        await database.query('DELETE FROM payments WHERE payable_type=\'consultation\' AND payable_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_actions WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_schedule_proposals WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_reviews WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_visits WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM idempotency_operations WHERE actor_id = ANY($1::uuid[])', [actors]);
        await database.query('DELETE FROM consultations WHERE id = ANY($1::uuid[])', [allConsultationIds]);
        await database.query('DELETE FROM consultation_quotes WHERE id = ANY($1::uuid[])', [quoteIds]);
        await database.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
        if (actors.length > 0) {
          await database.query('DELETE FROM addresses WHERE owner_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM livestock WHERE farmer_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM farms WHERE owner_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM vet_blocked_times WHERE vet_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM vet_service_rates WHERE vet_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM vet_availabilities WHERE vet_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM vet_directory_profiles WHERE vet_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM professional_documents WHERE owner_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM farmer_profiles WHERE user_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM vet_profiles WHERE user_id = ANY($1::uuid[])', [actors]);
          await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [actors]);
        }
      } finally {
        await database.query("SET session_replication_role = 'origin'").catch(() => undefined);
        await localDb.onModuleDestroy();
        await database.end();
      }
    }
  } else {
    console.log('BE-07 runtime smoke tidak dijalankan karena PostgreSQL readiness mengembalikan 503.');
  }
} finally {
  await stopServer(healthy.child);
  await rm(smokeMediaDirectory, { recursive: true, force: true });
}

const unavailable = await startServerWithRetry({ DATABASE_PORT: '1' });
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

console.log('API smoke selesai: health live/ready, OpenAPI/auth, unauthenticated /me, login rate-limit, tidak log password, reset response generik, dan error 503 tervalidasi.');
