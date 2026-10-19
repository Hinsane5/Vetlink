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
import { adapterFailed } from '../dist/communication/adapter-result.js';
import { PostgresConsultationActionAdapter } from '../dist/consultation/consultation-action.adapter.js';
import { ConsultationService } from '../dist/consultation/consultation.service.js';
import { LocalPaymentService } from '../dist/payment/payment.adapter.js';
import { PaymentsService } from '../dist/payment/payment.service.js';

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
  assert.ok(openApi.paths['/v1/auth/logout']?.post);
  assert.ok(openApi.paths['/v1/auth/refresh']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset']?.post);
  assert.ok(openApi.paths['/v1/auth/password-reset/confirm']?.post);
  assert.ok(openApi.paths['/v1/me']?.get);
  assert.ok(openApi.paths['/v1/products']?.get);
  assert.ok(openApi.paths['/v1/products/{id}']?.get);
  assert.equal(openApi.paths['/v1/internal/products'], undefined);
  assert.equal(openApi.paths['/v1/products']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProductPageResponseDto');
  assert.equal(openApi.paths['/v1/products/{id}']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref, '#/components/schemas/ProductResponseDto');
  assert.ok(openApi.paths['/v1/products']?.get?.parameters?.some((parameter) => parameter.name === 'maxPrice'));
  assert.ok(openApi.paths['/v1/vets']?.get);
  assert.ok(openApi.paths['/v1/vets/{id}']?.get);
  assert.ok(openApi.paths['/v1/vets/{id}/slots']?.get);
  assert.ok(openApi.paths['/v1/me/vet/availability']?.put);
  assert.ok(openApi.paths['/v1/me/vet/blocked-times']?.post);
  assert.ok(openApi.paths['/v1/consultation-quotes']?.post);
  assert.ok(openApi.paths['/v1/consultations']?.post);
  assert.ok(openApi.paths['/v1/consultations']?.get);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/accept']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/schedule-proposals/{proposalId}/respond']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/visit/depart']?.post);
  assert.ok(openApi.paths['/v1/consultations/{consultationId}/complete']?.post);
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
    const addressIds = [];
    const productIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const localDb = new DatabaseService();
    const workflow = new ConsultationService(localDb, new PostgresConsultationActionAdapter());
    const localPayment = new PaymentsService(localDb, new LocalPaymentService(), workflow);
    let consultationId;
    let unpaidConsultationId;
    let failedStorageServer;
    try {
      const farmer = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Fiktif BE-07');
      const vet = await registerSmokeUser(healthy.baseUrl, 'vet', 'Dokter Fiktif BE-07');
      const outsider = await registerSmokeUser(healthy.baseUrl, 'farmer', 'Peternak Lain Fiktif BE-07');
      const unverifiedVet = await registerSmokeUser(healthy.baseUrl, 'vet', 'Dokter Belum Terverifikasi BE-04');
      actors.push(farmer.user.id, vet.user.id, outsider.user.id,unverifiedVet.user.id);

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
      const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+48*60*60*1000));
      const weekday = Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',weekday:'short'}).format(new Date(`${localDate}T12:00:00+07:00`)).replace(/^Sun$/,'0').replace(/^Mon$/,'1').replace(/^Tue$/,'2').replace(/^Wed$/,'3').replace(/^Thu$/,'4').replace(/^Fri$/,'5').replace(/^Sat$/,'6'));
      const availBody={expectedVersion:1,acceptingNewRequests:true,services:['chat','visit'],timezone:'Asia/Jakarta',weekdayRules:[{weekday,start:'00:00',end:'23:59'}],chatDurationMinutes:60,visitDurationMinutes:60,rates:{chat:125000,visit:400000},experienceYears:7,specialties:['hewan besar'],species:['sapi'],practiceLocation:'Bogor',serviceAreas:['Bogor']};
      const savedAvailability=await sendJson(healthy.baseUrl,'/v1/me/vet/availability',vet.accessToken,'PUT',availBody);
      assert.equal(savedAvailability.status,200);
      const availabilityResult=await savedAvailability.json();
      assert.equal(availabilityResult.status,'succeeded');
      assert.equal(Number(availabilityResult.value.rates.chat),125000);
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
      const slotResponse=await sendJson(healthy.baseUrl,`/v1/vets/${vet.user.id}/slots?dateFrom=${localDate}&dateTo=${localDate}&service=chat`,farmer.accessToken,'GET');
      assert.equal(slotResponse.status,200,`${await slotResponse.clone().text()}\n${healthy.output()}`);
      const availableSlots=await slotResponse.json();
      assert.ok(availableSlots.length>0);
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
      await database.query(
        `INSERT INTO livestock (id, farmer_id, farm_id, display_code, name, species, sex)
         VALUES ($1, $2, $3, 'BE07-001', 'Ternak Fiktif BE-07', 'sapi', 'female')`,
        [animalId, farmer.user.id, farmId],
      );

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

      await database.query("INSERT INTO role_memberships(user_id,role) VALUES($1,'vet') ON CONFLICT DO NOTHING", [outsider.user.id]);
      await database.query("INSERT INTO vet_profiles(user_id,verification_status) VALUES($1,'pending') ON CONFLICT DO NOTHING", [outsider.user.id]);
      const dualRoleLogin = await fetch(`${healthy.baseUrl}/v1/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: outsider.user.email, password: 'smoke-only-password-not-secret', activeRole: 'vet' }),
      });
      assert.equal(dualRoleLogin.status, 200);
      const dualRole = await dualRoleLogin.json();
      assert.equal((await sendJson(healthy.baseUrl, `/v1/consultations/${chatConsultationId}`, dualRole.accessToken, 'GET')).status, 404);

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
        { name: 'Farm Fiktif BE-07', expectedVersion: 1, visitAddressId: visitAddress.id });
      assert.equal(linkedFarm.status, 200, await linkedFarm.clone().text());
      assert.equal((await linkedFarm.json()).visit_address_id, visitAddress.id);
      const visitQuote = await addQuote(visitStart, 'visit', 'Pemeriksaan ternak fiktif', visitAddress.id);
      assert.equal(visitQuote.quote.visitAddressSnapshot.addressLine, 'Jalan Contoh Tanpa Nomor');
      const visitBooking = await submitQuote(visitQuote.quote);
      assert.equal(visitBooking.response.status, 201);
      const visitConsultationId = (await visitBooking.response.json()).consultation.id;
      consultationIds.push(visitConsultationId);
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
      assert.ok((await timelineAfterFinal.json()).some((event) => event.description === 'Penilaian klinis fiktif'));
      const unconfirmedComplete = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: false }, { 'idempotency-key': `be05-complete-${randomUUID()}` });
      assert.equal(unconfirmedComplete.status, 422);
      const completedVisitResponse = await sendJson(healthy.baseUrl, `/v1/consultations/${visitConsultationId}/complete`, vet.accessToken, 'POST',
        { expectedVersion: examining.consultation.version, expectedVisitVersion: examining.visit.version, confirmation: true }, { 'idempotency-key': `be05-complete-${randomUUID()}` });
      assert.equal(completedVisitResponse.status, 200, await completedVisitResponse.clone().text());
      const completedVisit = (await completedVisitResponse.json()).consultation;
      assert.equal(completedVisit.status, 'completed');
      assert.equal(completedVisit.visitStage, 'completed');
      assert.equal(completedVisit.completionAt != null, true);
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
        farmId, displayCode: 'new-001', name: 'Anak Fiktif', species: 'sapi', sex: 'unknown', estimatedAgeMonths: 2, weightKg: 12.5,
      });
      assert.equal(createdAnimalResponse.status, 201);
      const createdAnimal = await createdAnimalResponse.json();
      assert.equal(createdAnimal.display_code, 'NEW-001');
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
      const firstPaymentResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST', paymentBody, { 'idempotency-key': firstKey });
      assert.equal(firstPaymentResponse.status, 201);
      assert.equal((await sendJson(healthy.baseUrl, '/v1/payments', vet.accessToken, 'POST', paymentBody, { 'idempotency-key': `be06-vet-${randomUUID()}` })).status, 403);
      const firstPayment = await firstPaymentResponse.json();
      assert.equal(firstPayment.status, 'pending');
      assert.equal(firstPayment.amountIdr, 1000);
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
        const secondKey = `be06-retry-${randomUUID()}`;
        const retryResponse = await sendJson(healthy.baseUrl, '/v1/payments', farmer.accessToken, 'POST', paymentBody, { 'idempotency-key': secondKey });
        assert.equal(retryResponse.status, 201);
        const retried = await retryResponse.json();
        assert.equal(retried.id, firstPayment.id);
        assert.notEqual(retried.attempt.id, firstPayment.attempt.id);
        assert.equal(retried.status, 'pending');
        const successEventId = `be06-success-${randomUUID()}`;
        const successInput = { paymentId: retried.id, attemptId: retried.attempt.id, reference: retried.attempt.reference, amountIdr: '1000', eventId: successEventId, outcome: 'succeeded' };
        assert.equal((await localPayment.localCallback(successInput)).status, 'succeeded');
        assert.equal((await localPayment.localCallback(successInput)).status, 'succeeded');
        await assert.rejects(localPayment.localCallback({ ...successInput, outcome: 'failed' }));
        const counts = await database.query(`SELECT count(DISTINCT p.id)::int payments,count(a.id)::int attempts
          FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE p.payable_id=$1`, [unpaidConsultationId]);
        assert.deepEqual(counts.rows[0], { payments: 1, attempts: 2 });
      }
      const scheduleFrom=new Date().toISOString();
      const scheduleTo=new Date(Date.now()+5*60*60*1000).toISOString();
      const vetSchedule=await sendJson(healthy.baseUrl,`/v1/me/vet/schedule?from=${encodeURIComponent(scheduleFrom)}&to=${encodeURIComponent(scheduleTo)}`,vet.accessToken,'GET');
      assert.equal(vetSchedule.status,200);
      assert.deepEqual((await vetSchedule.json()).appointments.map(item=>item.id).sort(),[consultationId,unpaidConsultationId].sort());
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
      assert.deepEqual((await vetPatientList.json()).map((item) => item.id).sort(), [animalId, createdAnimal.id].sort());
      const outsiderPatientList = await sendJson(healthy.baseUrl, '/v1/patients', outsider.accessToken, 'GET');
      assert.equal(outsiderPatientList.status, 403);
      const patchAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Anak Fiktif Revisi' });
      assert.equal(patchAnimal.status, 200);
      const staleAnimal = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}`, farmer.accessToken, 'PATCH', { expectedVersion: 1, name: 'Stale' });
      assert.equal(staleAnimal.status, 404);
      const careBody = { kind: 'care', occurredAt: new Date().toISOString(), description: 'Catatan perawatan fiktif', sourceKey: `be03-${randomUUID()}` };
      const careFirst = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careFirst.status, 201);
      const careAgain = await sendJson(healthy.baseUrl, `/v1/livestock/${createdAnimal.id}/care-events`, farmer.accessToken, 'POST', careBody);
      assert.equal(careAgain.status, 201);
      assert.equal((await careAgain.json()).id, (await careFirst.json()).id);

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
      const staleReview = await sendJson(healthy.baseUrl, `${notePath}/finalize`, vet.accessToken, 'POST', { expectedVersion: 1 });
      assert.equal(staleReview.status, 409);
      const finalizedNote = await sendJson(healthy.baseUrl, `${notePath}/finalize`, vet.accessToken, 'POST', { expectedVersion: 2 });
      assert.equal(finalizedNote.status, 201);
      assert.equal((await finalizedNote.json()).status, 'final');
      assert.equal((await database.query('SELECT status FROM consultations WHERE id=$1', [consultationId])).rows[0].status, 'in_progress');
      assert.equal((await sendJson(healthy.baseUrl, notePath, farmer.accessToken, 'GET')).status, 200);
      assert.equal((await sendJson(healthy.baseUrl, notePath, vet.accessToken, 'PUT', { expectedVersion: 3, assessment: 'Tidak dapat mengubah final' })).status, 409);
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
      assert.equal((await sendJson(healthy.baseUrl, '/v1/orders', vet.accessToken, 'GET')).status, 404);
      const hiddenDraftTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, farmer.accessToken, 'GET');
      assert.equal(hiddenDraftTimeline.status, 200);
      assert.equal((await hiddenDraftTimeline.json()).length, 2);
      const finalTimeline = await sendJson(healthy.baseUrl, `/v1/livestock/${animalId}/health-events`, vet.accessToken, 'GET');
      assert.equal(finalTimeline.status, 200);
      const finalEvents = await finalTimeline.json();
      assert.equal(finalEvents.length, 2);
      assert.ok(finalEvents.some((event) => event.description === 'Penilaian fiktif akhir'));
      assert.ok(finalEvents.every((event) => !('attachments' in event)));

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

      console.log('BE-03/04/05/06/07/08/10 smoke: owner/role scope; active catalog filters/cursor/detail and authoritative IDR; recommendation active-product link/snapshot; booking/slot race and payment; verified access, visit/completion, chat/media lulus.');
    } finally {
      if (failedStorageServer) await stopServer(failedStorageServer.child);
      // Smoke teardown is a fixture reset; it must remove immutable final-note rows
      // without weakening the production immutability trigger.
      await database.query("SET session_replication_role = 'replica'");
      const allConsultationIds = [...new Set([...consultationIds, consultationId, unpaidConsultationId].filter(Boolean))];
      try {
        await database.query('DELETE FROM recommendation_items WHERE recommendation_id IN (SELECT id FROM recommendations WHERE consultation_id = ANY($1::uuid[]))', [allConsultationIds]);
        await database.query('DELETE FROM recommendations WHERE consultation_id = ANY($1::uuid[])', [allConsultationIds]);
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

console.log('API smoke selesai: health live/ready, OpenAPI/auth, unauthenticated /me, login rate-limit, tidak log password, reset response generik, dan error 503 tervalidasi.');
