import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiPaymentGateway } from '../.test-build/src/application/ApiPaymentGateway.js';
import { ApiPaymentOperationJournal } from '../.test-build/src/application/ApiPaymentOperationJournal.js';
import { ServerAuthService } from '../.test-build/src/application/ServerAuthService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { ApiClient, normalizeApiBaseUrl } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpServerAuthRepository } from '../.test-build/src/data/remote/ApiAuthRepository.js';
import { HttpApiCatalogRepository } from '../.test-build/src/data/remote/HttpApiCatalogRepository.js';
import { HttpApiFarmReadRepository } from '../.test-build/src/data/remote/HttpApiFarmReadRepository.js';
import { HttpApiFarmWriteRepository } from '../.test-build/src/data/remote/HttpApiFarmWriteRepository.js';
import { HttpApiLivestockReadRepository } from '../.test-build/src/data/remote/HttpApiLivestockReadRepository.js';
import { HttpApiLivestockWriteRepository } from '../.test-build/src/data/remote/HttpApiLivestockWriteRepository.js';
import { HttpApiLivestockHealthRepository } from '../.test-build/src/data/remote/HttpApiLivestockHealthRepository.js';
import { HttpApiPatientReadRepository } from '../.test-build/src/data/remote/HttpApiPatientReadRepository.js';
import { HttpApiPatientClinicalReadRepository } from '../.test-build/src/data/remote/HttpApiPatientClinicalReadRepository.js';
import { HttpApiPatientMediaReadRepository } from '../.test-build/src/data/remote/HttpApiPatientMediaReadRepository.js';
import { HttpApiPaymentRepository } from '../.test-build/src/data/remote/HttpApiPaymentRepository.js';
import { HttpApiVetDirectoryReadRepository } from '../.test-build/src/data/remote/HttpApiVetDirectoryReadRepository.js';

test('API client refreshes a rejected access token once and replays with server session', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet('old-access-token', 'old-refresh-token'));
  const requests = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/v1/me') && init.headers.Authorization === 'Bearer old-access-token') {
      return response(401, { code: 'SESSION_INVALID', message: 'Token kedaluwarsa.' });
    }
    if (url.endsWith('/v1/auth/refresh')) {
      return response(200, authResponse('n'.repeat(48), 'x'.repeat(48)));
    }
    return response(200, { id: 'user-1', activeRole: 'farmer' });
  });

  const me = await api.request('/v1/me');
  assert.equal(me.id, 'user-1');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer old-access-token');
  assert.equal(requests[1].init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(requests[1].init.body), { refreshToken: 'old-refresh-token' });
  assert.equal(requests[2].init.headers.Authorization, `Bearer ${'n'.repeat(48)}`);
  assert.equal((await sessions.read()).refreshToken, 'x'.repeat(48));
});

test('API client does not retry an uncertain network failure', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', sessions, async () => {
    calls += 1;
    throw new Error('socket closed');
  });

  await assert.rejects(api.request('/v1/payments', {
    method: 'POST',
    body: { payableType: 'order', payableId: 'order-1', method: 'bank_transfer' },
    idempotencyKey: 'pay:order:order-1:bank_transfer:1',
  }), (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('API base URL rejects non-private HTTP and embedded credentials', () => {
  assert.equal(normalizeApiBaseUrl('http://192.168.1.42:3000/'), 'http://192.168.1.42:3000');
  assert.equal(normalizeApiBaseUrl('https://api.example.test/'), 'https://api.example.test');
  assert.throws(() => normalizeApiBaseUrl('http://api.example.test'), (error) => error instanceof DomainError);
  assert.throws(() => normalizeApiBaseUrl('https://user:password@example.test'), (error) => error instanceof DomainError);
});

test('catalog read adapter sends BE-10 filters and follows the opaque server cursor', async () => {
  const requests = [];
  const cursor = 'eyJuYW1lIjoiZmlrdGlmIn0';
  const first = catalogProductFixture('11111111-1111-4111-8111-111111111111', 'Paket perawatan fiktif', 45000);
  const second = catalogProductFixture('22222222-2222-4222-8222-222222222222', 'Peralatan kandang fiktif', 67000);
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    const query = new URL(url).searchParams;
    if (query.has('cursor')) return response(200, { items: [second], nextCursor: null, hasMore: false });
    return response(200, { items: [first], nextCursor: cursor, hasMore: true });
  });
  const repository = new HttpApiCatalogRepository(api);

  const firstPage = await repository.search({
    name: '  perawatan fiktif ', category: ' care ', species: 'cattle',
    minPriceIdr: 12000, maxPriceIdr: 45000, limit: 1,
  });
  const secondPage = await repository.search({ cursor: firstPage.nextCursor, limit: 1 });

  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextCursor, cursor);
  assert.equal(firstPage.items[0].id, first.id);
  assert.equal(firstPage.items[0].unitPrice, 45000);
  assert.equal(firstPage.items[0].currency, 'IDR');
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(secondPage.items[0].id, second.id);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'access-token-1'}`);
  const firstQuery = new URL(requests[0].url).searchParams;
  assert.equal(firstQuery.get('name'), 'perawatan fiktif');
  assert.equal(firstQuery.get('category'), 'care');
  assert.equal(firstQuery.get('species'), 'cattle');
  assert.equal(firstQuery.get('minPrice'), '12000');
  assert.equal(firstQuery.get('maxPrice'), '45000');
  assert.equal(firstQuery.get('limit'), '1');
  assert.equal(firstQuery.has('ownerId'), false, 'owner scope comes from the authenticated server session');
  const secondQuery = new URL(requests[1].url).searchParams;
  assert.equal(secondQuery.get('cursor'), cursor, 'the returned cursor is passed back unchanged');
  assert.equal(secondQuery.get('limit'), '1');
});

test('catalog detail uses the server product UUID and preserves its error envelope', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith(`/v1/products/${id}`)) return response(200, catalogProductFixture(id, 'Produk fiktif untuk detail', 125000));
    return response(404, {
      code: 'RESOURCE_NOT_FOUND', message: 'Produk fiktif tidak ditemukan.',
      fieldErrors: {}, requestId: 'req-fixture-catalog-404',
    });
  });
  const repository = new HttpApiCatalogRepository(api);

  const product = await repository.getById(id);
  assert.equal(product.id, id);
  assert.equal(product.unitPrice, 125000);
  assert.equal(requests[0].url, `http://localhost:3000/v1/products/${id}`);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'access-token-1'}`);
  await assert.rejects(repository.getById('44444444-4444-4444-8444-444444444444'), (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, 'Produk fiktif tidak ditemukan.');
    return true;
  });
});

test('catalog adapter rejects invalid query filters and malformed server product/page DTOs', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(200, { items: [], nextCursor: null, hasMore: false });
  });
  const repository = new HttpApiCatalogRepository(api);

  await assert.rejects(repository.search({ minPriceIdr: 200, maxPriceIdr: 100 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ limit: 101 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ cursor: '' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getById('not-a-server-id'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);

  const malformedPages = [
    { items: [catalogProductFixture('55555555-5555-4555-8555-555555555555', 'Harga pecahan fiktif', 12000.5)], nextCursor: null, hasMore: false },
    { items: [{ ...catalogProductFixture('66666666-6666-4666-8666-666666666666', 'Produk nonaktif fiktif', 12000), active: false }], nextCursor: null, hasMore: false },
    { items: [{ ...catalogProductFixture('88888888-8888-4888-8888-888888888888', 'Produk tanpa attachment fiktif', 12000), imageAttachmentId: undefined }], nextCursor: null, hasMore: false },
    { items: [{ ...catalogProductFixture('99999999-9999-4999-8999-999999999999', 'Spesies tak dikenal fiktif', 12000), species: ['unknown'] }], nextCursor: null, hasMore: false },
    { items: [catalogProductFixture('77777777-7777-4777-8777-777777777777', 'Cursor halaman fiktif', 12000)], nextCursor: null, hasMore: true },
  ];
  for (const payload of malformedPages) {
    const invalidApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, payload));
    await assert.rejects(new HttpApiCatalogRepository(invalidApi).search(), { code: 'API_RESPONSE_INVALID' });
  }
});

test('server authentication stores opaque tokens and validates identity against /me', async () => {
  const sessions = new MemoryServerSessionStore(null);
  const requests = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/v1/auth/login')) return response(200, authResponse('a'.repeat(48), 'r'.repeat(48)));
    if (url.endsWith('/v1/me')) return response(200, {
      id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik Ternak', roles: ['farmer'],
      activeRole: 'farmer', sessionId: 'session-1',
    });
    throw new Error(`Unexpected route: ${url}`);
  });
  const auth = new ServerAuthService(new HttpServerAuthRepository(api), sessions);

  const loggedIn = await auth.login({ email: ' OWNER@EXAMPLE.TEST ', password: 'kata-sandi-server-aman', role: 'farmer' });
  assert.equal(loggedIn.userId, 'farmer-id');
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    email: 'owner@example.test', password: 'kata-sandi-server-aman', activeRole: 'farmer',
  });
  assert.equal((await sessions.read()).accessToken, 'a'.repeat(48));
  assert.equal((await auth.restoreSession()).sessionId, 'session-1');
  assert.equal(requests[1].init.headers.Authorization, `Bearer ${'a'.repeat(48)}`);
});

test('server role switch rotates tokens for the same server session and role membership', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const requests = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/v1/me')) return response(200, {
      id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik', roles: ['farmer', 'vet'],
      activeRole: 'farmer', sessionId: 'session-1',
    });
    if (url.endsWith('/v1/auth/active-role')) {
      return response(200, authResponse('v'.repeat(48), 'w'.repeat(48), 'vet', ['farmer', 'vet']));
    }
    throw new Error(`Unexpected route: ${url}`);
  });
  const auth = new ServerAuthService(new HttpServerAuthRepository(api), sessions);

  const switched = await auth.switchRole('vet');

  assert.equal(switched.activeRole, 'vet');
  assert.equal(switched.sessionId, 'session-1');
  assert.equal(switched.expiresAt, '2026-12-16T10:00:00.000Z');
  assert.deepEqual(switched.roles, ['farmer', 'vet']);
  assert.equal(requests[1].url, 'http://localhost:3000/v1/auth/active-role');
  assert.equal(requests[1].init.headers.Authorization, `Bearer ${'access-token-1'}`);
  assert.deepEqual(JSON.parse(requests[1].init.body), { activeRole: 'vet' });
  assert.equal((await sessions.read()).accessToken, 'v'.repeat(48));
  assert.equal((await sessions.read()).refreshToken, 'w'.repeat(48));
  assert.equal((await sessions.read()).activeRole, 'vet');
});

test('server role switch rejects a role absent from verified server membership', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  let switchCalls = 0;
  const auth = new ServerAuthService({
    login: async () => authResponse(), register: async () => authResponse(), logout: async () => {},
    switchActiveRole: async () => { switchCalls += 1; return authResponse(); },
    me: async () => ({
      id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik', roles: ['farmer'],
      activeRole: 'farmer', sessionId: 'session-1',
    }),
  }, sessions);

  await assert.rejects(auth.switchRole('vet'), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
  assert.equal(switchCalls, 0);
});

test('payment repository parses server status, integer IDR, and ordered attempt history', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const requests = [];
  const record = paymentRecord({
    status: 'failed',
    attempts: [attemptRecord(1, 'failed'), attemptRecord(2, 'failed')],
  });
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    requests.push({ url, init });
    if (url.includes('/v1/payments?')) return response(200, record);
    if (url.endsWith('/v1/payments/payment-1')) return response(200, record);
    if (url.endsWith('/v1/payments/payment-1/attempts')) return response(200, { items: record.attempts });
    throw new Error(`Unexpected route: ${url}`);
  });
  const repository = new HttpApiPaymentRepository(api);

  const byPayable = await repository.getForPayable('order', 'order-1');
  const byId = await repository.getById('payment-1');
  const attempts = await repository.getAttempts('payment-1');

  assert.equal(byPayable.status, 'failed');
  assert.equal(byPayable.amountIdr, 125000);
  assert.deepEqual(byPayable.attempts.map((attempt) => attempt.attemptNumber), [1, 2]);
  assert.equal(byId.id, 'payment-1');
  assert.equal(attempts[1].status, 'failed');
  assert.equal(requests[0].url, 'http://localhost:3000/v1/payments?payableType=order&payableId=order-1');
  assert.equal(requests[1].url, 'http://localhost:3000/v1/payments/payment-1');
  assert.equal(requests[2].url, 'http://localhost:3000/v1/payments/payment-1/attempts');
});

test('API payment uses integer server quote, sends no client amount, and preserves server pending status', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const calls = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/v1/payments?')) return response(404, { code: 'NOT_FOUND', message: 'Belum ada pembayaran.' });
    if (url.endsWith('/v1/payment-quotes/order/order-1')) {
      return response(200, { payableType: 'order', payableId: 'order-1', amountIdr: 125000, currency: 'IDR' });
    }
    return response(201, paymentCreateResponse({ status: 'pending' }));
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), createPaymentOperationJournal());

  const payment = await gateway.submit('farmer', 'order', 'order-1', 'bank_transfer');
  assert.equal(payment.status, 'pending');
  assert.equal(payment.amount, 125000);
  assert.equal(calls[2].init.headers['Idempotency-Key'], 'pay:order:order-1:bank_transfer:1');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    payableType: 'order', payableId: 'order-1', method: 'bank_transfer',
  });
  assert.equal(Object.hasOwn(JSON.parse(calls[2].init.body), 'amount'), false);
});

test('payment gateway exposes only a matching safe-integer server quote', async () => {
  const quote = { payableType: 'consultation', payableId: 'consultation-2', amountIdr: 87500, currency: 'IDR' };
  const gateway = new ApiPaymentGateway({ getQuote: async () => quote }, createPaymentOperationJournal());
  assert.deepEqual(await gateway.getQuote('consultation', 'consultation-2'), quote);

  const mismatched = new ApiPaymentGateway({
    getQuote: async () => ({ ...quote, payableId: 'another-consultation' }),
  }, createPaymentOperationJournal());
  await assert.rejects(mismatched.getQuote('consultation', 'consultation-2'),
    (error) => error instanceof DomainError && error.code === 'API_RESPONSE_INVALID');
});

test('server 404 on payment lookup means no record, but malformed integer IDR is rejected', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const api = new ApiClient('http://localhost:3000', sessions, async (url) => {
    if (url.includes('/v1/payments?')) return response(404, { code: 'NOT_FOUND' });
    if (url.endsWith('/v1/payment-quotes/order/order-1')) {
      return response(200, { payableType: 'order', payableId: 'order-1', amountIdr: 125000.5, currency: 'IDR' });
    }
    throw new Error(`Unexpected route: ${url}`);
  });
  const repository = new HttpApiPaymentRepository(api);
  assert.equal(await repository.getForPayable('order', 'order-1'), null);
  await assert.rejects(repository.getQuote('order', 'order-1'),
    (error) => error instanceof DomainError && error.code === 'API_RESPONSE_INVALID');
});

test('network failure cannot become local payment success or retry automatically', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const persistence = new MemoryOperationPersistence();
  const calls = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/v1/payments?')) return response(404, { code: 'NOT_FOUND' });
    if (url.endsWith('/v1/payment-quotes/consultation/consultation-1')) {
      return response(200, { payableType: 'consultation', payableId: 'consultation-1', amountIdr: 30000, currency: 'IDR' });
    }
    throw new Error('response lost');
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), createPaymentOperationJournal(persistence));

  await assert.rejects(gateway.submit('farmer', 'consultation', 'consultation-1', 'e_wallet'),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 1);
  assert.equal(JSON.parse([...persistence.values.values()][0]).operationKey, 'pay:consultation:consultation-1:e_wallet:1');
});

test('retry after an uncommitted network failure reuses its saved key and payload after a new service instance', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const persistence = new MemoryOperationPersistence();
  const createRequests = [];
  let loseFirstResponse = true;
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    if (url.includes('/v1/payments?')) return response(404, { code: 'NOT_FOUND' });
    if (url.endsWith('/v1/payment-quotes/order/order-2')) {
      return response(200, { payableType: 'order', payableId: 'order-2', amountIdr: 67000, currency: 'IDR' });
    }
    createRequests.push({ headers: init.headers, body: init.body });
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error('network failed before commit');
    }
    return response(201, paymentCreateResponse({ payableId: 'order-2', amountIdr: 67000, status: 'pending' }));
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ApiPaymentOperationJournal(persistence));

  await assert.rejects(gateway.submit('farmer', 'order', 'order-2', 'bank_transfer'),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  const storedOperation = JSON.parse([...persistence.values.values()][0]);
  assert.equal(storedOperation.attempt, 1);
  assert.equal(Object.hasOwn(storedOperation, 'outcome'), false);
  const retryGateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ApiPaymentOperationJournal(persistence));
  const retry = await retryGateway.submit('farmer', 'order', 'order-2', 'bank_transfer');
  assert.equal(retry.status, 'pending');
  assert.equal(createRequests.length, 2);
  assert.equal(createRequests[0].headers['Idempotency-Key'], createRequests[1].headers['Idempotency-Key']);
  assert.equal(createRequests[0].body, createRequests[1].body);
});

test('payment recovery on a second session reads pending, retries failed with a new key, and stops after success', async () => {
  const deviceAStore = new MemoryOperationPersistence();
  const deviceBStore = new MemoryOperationPersistence();
  const server = { payment: null, createRequests: [], loseFirstResponse: true };
  const deviceA = createPaymentGateway(server, new MemoryServerSessionStore(tokenSet()), deviceAStore);
  const deviceB = createPaymentGateway(server, new MemoryServerSessionStore(tokenSet('device-b-access-token', 'device-b-refresh-token')), deviceBStore);

  await assert.rejects(deviceA.submit('farmer', 'order', 'order-4', 'bank_transfer'),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(server.createRequests.length, 1);
  assert.equal(server.payment.status, 'pending');

  const recoveredPending = await deviceB.submit('farmer', 'order', 'order-4', 'bank_transfer');
  assert.equal(recoveredPending.status, 'pending');
  assert.equal(server.createRequests.length, 1, 'pending status must not create another attempt');

  server.payment = withPaymentStatus(server.payment, 'failed');
  const retried = await deviceB.submit('farmer', 'order', 'order-4', 'bank_transfer');
  assert.equal(retried.status, 'pending');
  assert.equal(server.createRequests.length, 2);
  assert.notEqual(server.createRequests[0].key, server.createRequests[1].key);
  assert.equal(server.createRequests[1].key, 'pay:order:order-4:bank_transfer:2');
  assert.deepEqual(server.createRequests[1].body, server.createRequests[0].body);

  server.payment = withPaymentStatus(server.payment, 'succeeded');
  const recoveredSuccess = await deviceB.getPaymentForPayable('order', 'order-4');
  assert.equal(recoveredSuccess.status, 'succeeded');
  assert.equal((await deviceB.getAttempts('payment-4')).length, 2);
  const repeated = await deviceB.submit('farmer', 'order', 'order-4', 'bank_transfer');
  assert.equal(repeated.status, 'succeeded');
  assert.equal(server.createRequests.length, 2, 'succeeded status must not create another attempt');
});

test('remote payment gate rejects vet role before making API requests', async () => {
  let calls = 0;
  const gateway = new ApiPaymentGateway({
    getQuote: async () => { calls += 1; throw new Error('must not call'); },
    getForPayable: async () => { calls += 1; throw new Error('must not call'); },
    getById: async () => { calls += 1; throw new Error('must not call'); },
    getAttempts: async () => { calls += 1; throw new Error('must not call'); },
    create: async () => { calls += 1; throw new Error('must not call'); },
  }, createPaymentOperationJournal());
  await assert.rejects(gateway.submit('vet', 'order', 'order-1', 'bank_transfer'),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
  assert.equal(calls, 0);
});

test('Farm and address reads use owner-scoped routes and preserve decimal coordinates', async () => {
  const farmId = '11111111-1111-4111-8111-111111111111';
  const addressId = '22222222-2222-4222-8222-222222222222';
  const requests = [];
  const farm = farmReadFixture(farmId);
  const address = addressReadFixture(addressId);
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/v1/me/farms')) return response(200, [farm]);
    if (url.endsWith(`/v1/me/farms/${farmId}`)) return response(200, farm);
    if (url.endsWith('/v1/me/addresses')) return response(200, [address]);
    if (url.endsWith(`/v1/me/addresses/${addressId}`)) return response(200, address);
    throw new Error(`Unexpected route: ${url}`);
  });
  const repository = new HttpApiFarmReadRepository(api);

  const farms = await repository.listFarms();
  const detail = await repository.getFarmById(farmId);
  const addresses = await repository.listAddresses();
  const addressDetail = await repository.getAddressById(addressId);

  assert.equal(farms[0].id, farmId);
  assert.deepEqual(farms[0].location, { district: 'Bogor' });
  assert.equal(detail.visitAddressId, addressId);
  assert.equal(addresses[0].latitude, '-6.123456');
  assert.equal(addresses[0].longitude, '106.123456');
  assert.equal(addressDetail.version, 2);
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    '/v1/me/farms', `/v1/me/farms/${farmId}`, '/v1/me/addresses', `/v1/me/addresses/${addressId}`,
  ]);
  for (const request of requests) {
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.headers.Authorization, 'Bearer access-token-1');
    assert.equal(new URL(request.url).searchParams.has('ownerId'), false);
  }
});

test('BE-02 farm reads accept empty species and still reject invalid or duplicate values', async () => {
  const farmId = '33333333-3333-4333-8333-333333333333';
  let farms = [{ ...farmReadFixture(farmId), species: [] }];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, farms));
  const repository = new HttpApiFarmReadRepository(api);

  assert.deepEqual((await repository.listFarms())[0].species, []);

  for (const species of [['unknown'], ['cattle', 'cattle']]) {
    farms = [{ ...farmReadFixture(farmId), species }];
    await assert.rejects(repository.listFarms(), { code: 'API_RESPONSE_INVALID' });
  }
});

test('Farm and address adapters reject invalid UUIDs, decimal strings, and timestamps', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(200, []);
  });
  const repository = new HttpApiFarmReadRepository(api);
  await assert.rejects(repository.getFarmById('local-farm-id'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getAddressById('local-address-id'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);

  const malformedFarm = { ...farmReadFixture('33333333-3333-4333-8333-333333333333'), updatedAt: '2026-11-16T10:00:00' };
  const malformedAddress = { ...addressReadFixture('44444444-4444-4444-8444-444444444444'), latitude: 6.25 };
  const invalidApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url) => {
    return response(200, url.endsWith('/farms') ? [malformedFarm] : [malformedAddress]);
  });
  const invalidRepository = new HttpApiFarmReadRepository(invalidApi);
  await assert.rejects(invalidRepository.listFarms(), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(invalidRepository.listAddresses(), { code: 'API_RESPONSE_INVALID' });
});

test('BE-02 farm and address writes use allowlisted payloads and validate server DTOs', async () => {
  const farmId = '33333333-3333-4333-8333-333333333333';
  const addressId = '44444444-4444-4444-8444-444444444444';
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    if (init.method === 'POST' && url.endsWith('/v1/me/farms')) {
      const body = JSON.parse(init.body);
      return response(201, { ...farmReadFixture(farmId), name: body.name, species: body.species ?? [] });
    }
    if (init.method === 'PATCH' && url.endsWith(`/v1/me/farms/${farmId}`)) {
      return response(200, { ...farmReadFixture(farmId), name: 'Farm Kedua', version: 2 });
    }
    if (init.method === 'POST' && url.endsWith('/v1/me/addresses')) return response(201, addressReadFixture(addressId));
    if (init.method === 'PATCH' && url.endsWith(`/v1/me/addresses/${addressId}`)) {
      return response(200, { ...addressReadFixture(addressId), version: 3 });
    }
    if (init.method === 'DELETE' && url.endsWith(`/v1/me/addresses/${addressId}`)) return response(200, { deleted: true });
    throw new Error(`Unexpected route: ${init.method} ${url}`);
  });
  const repository = new HttpApiFarmWriteRepository(api);

  const createdFarm = await repository.createFarm({
    name: 'Farm Pertama', species: ['cattle', 'goat'], timezone: 'Asia/Jakarta', visitAddressId: addressId,
    ownerId: 'must-not-be-sent',
  });
  const emptySpeciesFarm = await repository.createFarm({ name: 'Farm tanpa pembatas spesies' });
  const updatedFarm = await repository.updateFarm(farmId, { name: 'Farm Kedua', expectedVersion: 1, ownerId: 'must-not-be-sent' });
  const createdAddress = await repository.createAddress({
    label: 'Kandang Utama', recipientName: 'Peternak Fiktif', phone: '+628123456789',
    addressLine: 'Jalan Fiktif Nomor 1', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
    latitude: -6.123456, longitude: 106.123456, ownerId: 'must-not-be-sent',
  });
  const updatedAddress = await repository.updateAddress(addressId, {
    label: 'Kandang Cadangan', recipientName: 'Peternak Fiktif', phone: '+628123456789',
    addressLine: 'Jalan Fiktif Nomor 2', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
    latitude: -6.123456, longitude: 106.123456, expectedVersion: 2, ownerId: 'must-not-be-sent',
  });
  await repository.deleteAddress(addressId);

  assert.equal(createdFarm.id, farmId);
  assert.deepEqual(emptySpeciesFarm.species, [], 'BE-02 permits an empty species list to mean unrestricted');
  assert.equal(updatedFarm.version, 2);
  assert.equal(createdAddress.latitude, '-6.123456', 'read DTO keeps PostgreSQL coordinates as decimal strings');
  assert.equal(updatedAddress.version, 3);
  assert.deepEqual(requests.map(({ init }) => init.method), ['POST', 'POST', 'PATCH', 'POST', 'PATCH', 'DELETE']);
  const firstFarmBody = JSON.parse(requests[0].init.body);
  assert.deepEqual(firstFarmBody, {
    name: 'Farm Pertama', species: ['cattle', 'goat'], timezone: 'Asia/Jakarta', visitAddressId: addressId,
  });
  assert.deepEqual(JSON.parse(requests[1].init.body), { name: 'Farm tanpa pembatas spesies' });
  assert.deepEqual(JSON.parse(requests[2].init.body), { name: 'Farm Kedua', expectedVersion: 1 });
  assert.equal(JSON.parse(requests[3].init.body).latitude, -6.123456);
  assert.equal(JSON.parse(requests[4].init.body).expectedVersion, 2);
  for (const request of requests) {
    assert.equal(request.init.headers.Authorization, 'Bearer access-token-1');
    assert.equal(Object.hasOwn(JSON.parse(request.init.body ?? '{}'), 'ownerId'), false);
  }
});

test('BE-02 rejects invalid IDs, species, coordinates, bounds, and unsafe versions before HTTP', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(200, farmReadFixture('55555555-5555-4555-8555-555555555555'));
  });
  const repository = new HttpApiFarmWriteRepository(api);
  const address = {
    label: 'Kandang', recipientName: 'Peternak', phone: '12345', addressLine: 'Jalan Contoh',
    city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
  };

  await assert.rejects(repository.updateFarm('local-farm', { name: 'Valid', expectedVersion: 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateAddress('local-address', { ...address, expectedVersion: 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createFarm({ name: 'Farm', species: ['bad-species'] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createFarm({ name: 'x'.repeat(121) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateFarm('55555555-5555-4555-8555-555555555555', { expectedVersion: Number.MAX_SAFE_INTEGER + 1, name: 'Farm' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createAddress({ ...address, latitude: -6.1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createAddress({ ...address, latitude: -91, longitude: 106 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createAddress({ ...address, latitude: -6.1234567, longitude: 106.123456 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateFarm('55555555-5555-4555-8555-555555555555', { expectedVersion: 1 }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
});

test('BE-02 rejects malformed write DTOs and malformed address deletion results', async () => {
  let calls = 0;
  const farmId = '55555555-5555-4555-8555-555555555555';
  const addressId = '66666666-6666-4666-8666-666666666666';
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    calls += 1;
    if (init.method === 'POST' && url.endsWith('/v1/me/farms')) {
      return response(201, { ...farmReadFixture(farmId), species: ['unknown'] });
    }
    if (init.method === 'POST' && url.endsWith('/v1/me/addresses')) {
      return response(201, { ...addressReadFixture(addressId), latitude: '91' });
    }
    if (init.method === 'DELETE') return response(200, { deleted: false });
    throw new Error(`Unexpected route: ${init.method} ${url}`);
  });
  const repository = new HttpApiFarmWriteRepository(api);
  const address = {
    label: 'Kandang', recipientName: 'Peternak', phone: '12345', addressLine: 'Jalan Contoh',
    city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
  };

  await assert.rejects(repository.createFarm({ name: 'Farm valid' }), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(repository.createAddress(address), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(repository.deleteAddress(addressId), { code: 'API_RESPONSE_INVALID' });
  assert.equal(calls, 3);
});

test('BE-03 creates livestock for explicit farms, patches with a safe version, and sends no owner identity', async () => {
  const farmOneId = '11111111-1111-4111-8111-111111111111';
  const farmTwoId = '22222222-2222-4222-8222-222222222222';
  const livestockId = '77777777-7777-4777-8777-777777777777';
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    if (init.method === 'POST') {
      const farmId = body.farmId;
      return response(201, { ...livestockReadFixture(livestockId, '1234.50'), farmId, birthDate: null, estimatedAgeMonths: 0 });
    }
    if (init.method === 'PATCH') return response(200, { ...livestockReadFixture(livestockId, '1235.00'), version: 2, name: 'Sapi Fiktif Revisi' });
    throw new Error(`Unexpected route: ${init.method} ${url}`);
  });
  const repository = new HttpApiLivestockWriteRepository(api);

  const first = await repository.create({
    farmId: farmOneId, displayCode: ' sapi-01 ', name: ' Sapi Fiktif ', species: 'cattle', sex: 'female',
    estimatedAgeMonths: 0, weightKg: 1234.5, ownerId: 'must-not-be-sent', farmerId: 'must-not-be-sent',
  });
  const second = await repository.create({
    farmId: farmTwoId, displayCode: 'sapi-01', name: 'Sapi Fiktif', species: 'cattle', sex: 'female', weightKg: 1234.5,
  });
  const updated = await repository.update(livestockId, { expectedVersion: 1, name: 'Sapi Fiktif Revisi', ownerId: 'must-not-be-sent' });

  assert.equal(first.farmId, farmOneId);
  assert.equal(second.farmId, farmTwoId, 'the same farmer may create records under a second Farm');
  assert.equal(first.weightKg, '1234.50', 'decimal response precision is preserved');
  assert.equal(updated.version, 2);
  assert.deepEqual(requests.map(({ init }) => init.method), ['POST', 'POST', 'PATCH']);
  assert.deepEqual(requests[0].body, {
    farmId: farmOneId, displayCode: ' sapi-01 ', name: ' Sapi Fiktif ', species: 'cattle', sex: 'female',
    estimatedAgeMonths: 0, weightKg: 1234.5,
  });
  assert.equal(requests[1].body.farmId, farmTwoId);
  assert.deepEqual(requests[2].body, { expectedVersion: 1, name: 'Sapi Fiktif Revisi' });
  for (const request of requests) {
    assert.equal(request.init.headers.Authorization, 'Bearer access-token-1');
    assert.equal(Object.hasOwn(request.body, 'ownerId'), false);
    assert.equal(Object.hasOwn(request.body, 'farmerId'), false);
  }
});

test('BE-03 rejects invalid livestock request bounds and malformed write response DTOs', async () => {
  let calls = 0;
  const validId = '88888888-8888-4888-8888-888888888888';
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(201, livestockReadFixture(validId, '1000000.00'));
  });
  const repository = new HttpApiLivestockWriteRepository(api);
  const base = {
    farmId: '99999999-9999-4999-8999-999999999999', displayCode: 'ID-1', name: 'Ternak Fiktif',
    species: 'cattle', sex: 'unknown',
  };

  await assert.rejects(repository.create({ ...base, farmId: 'local-farm' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, species: 'not-real' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, sex: 'other' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, name: 'x'.repeat(121) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, birthDate: '2025-02-30' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, birthDate: '2025-02-01', estimatedAgeMonths: 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, weightKg: 1.234 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ ...base, weightKg: 1000000 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.update('local-livestock', { expectedVersion: 1, name: 'Nama' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.update(validId, { expectedVersion: Number.MAX_SAFE_INTEGER + 1, name: 'Nama' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.update(validId, { expectedVersion: 1 }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);

  await assert.rejects(repository.create(base), { code: 'API_RESPONSE_INVALID' });
  assert.equal(calls, 1, 'an invalid server DTO is rejected without a local success result');
});

test('Farm and livestock mutations preserve server 403/404/409/422 envelopes as domain errors', async () => {
  const cases = [
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'VERSION_CONFLICT'],
    [422, 'INVALID_STATE'],
  ];
  for (const [status, code] of cases) {
    let calls = 0;
    const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
      calls += 1;
      return response(status, {
        code: status === 403 ? 'FORBIDDEN' : status === 404 ? 'RESOURCE_NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'RULE_VIOLATION',
        message: `Server menolak perubahan ${status}.`,
        fieldErrors: status === 422 ? { name: ['Tidak sesuai aturan.'] } : {},
        requestId: `req-write-${status}`,
      });
    });
    const repository = new HttpApiLivestockWriteRepository(api);
    await assert.rejects(repository.update('88888888-8888-4888-8888-888888888888', { expectedVersion: 7, name: 'Nama Fiktif' }), (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, code);
      assert.equal(error.message, `Server menolak perubahan ${status}.`);
      return true;
    });
    assert.equal(calls, 1, 'the adapter does not retry a rejected mutation or return local success');
  }

  let calls = 0;
  const offlineApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    throw new Error('connection lost');
  });
  await assert.rejects(
    new HttpApiLivestockWriteRepository(offlineApi).create({
      farmId: '11111111-1111-4111-8111-111111111111', displayCode: 'ID-1', name: 'Ternak Fiktif', species: 'cattle', sex: 'unknown',
    }),
    { code: 'SERVICE_UNAVAILABLE' },
  );
  assert.equal(calls, 1, 'network failure cannot return an optimistic local result or trigger an automatic retry');
});

test('livestock page and detail preserve opaque cursor and decimal weight strings', async () => {
  const livestockId = '55555555-5555-4555-8555-555555555555';
  const cursor = 'cursor value/+opaque==';
  const first = livestockReadFixture(livestockId, '1250.10');
  const second = livestockReadFixture('66666666-6666-4666-8666-666666666666', null);
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/page') && parsed.searchParams.has('cursor')) {
      return response(200, { items: [second], nextCursor: null, hasMore: false });
    }
    if (parsed.pathname.endsWith('/page')) return response(200, { items: [first], nextCursor: cursor, hasMore: true });
    return response(200, first);
  });
  const repository = new HttpApiLivestockReadRepository(api);

  const page = await repository.listPage({ limit: 1 });
  const next = await repository.listPage({ cursor: page.nextCursor, limit: 1 });
  const detail = await repository.getById(livestockId);

  assert.equal(page.items[0].weightKg, '1250.10');
  assert.equal(next.items[0].weightKg, null);
  assert.equal(next.nextCursor, null);
  assert.equal(detail.farmId, first.farmId);
  assert.equal(new URL(requests[1].url).searchParams.get('cursor'), cursor);
  assert.equal(new URL(requests[1].url).searchParams.get('limit'), '1');
  assert.equal(new URL(requests[0].url).searchParams.has('ownerId'), false);
  assert.equal(requests.every((request) => request.init.method === 'GET'), true);
});

test('livestock adapter validates bounds and rejects malformed DTOs before mapping', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(200, { items: [], nextCursor: null, hasMore: false });
  });
  const repository = new HttpApiLivestockReadRepository(api);
  await assert.rejects(repository.listPage({ limit: 0 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.listPage({ limit: 101 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.listPage({ cursor: '' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getById('not-a-uuid'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);

  const malformed = livestockReadFixture('77777777-7777-4777-8777-777777777777', 250.25);
  const malformedApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, {
    items: [malformed], nextCursor: null, hasMore: false,
  }));
  await assert.rejects(new HttpApiLivestockReadRepository(malformedApi).listPage(), { code: 'API_RESPONSE_INVALID' });
});

test('BE-03 health timeline parses the raw array, provenance, and server createdAt unchanged', async () => {
  const livestockId = '11111111-1111-4111-8111-111111111111';
  const timeline = [
    apiHealthEventFixture('22222222-2222-4222-8222-222222222222', {
      kind: 'examination', provenance: 'clinical_note', description: 'Penilaian pemeriksaan fiktif',
    }),
    apiHealthEventFixture('33333333-3333-4333-8333-333333333333', {
      kind: 'care', provenance: 'farmer_report', description: 'Perawatan ternak fiktif',
    }),
    apiHealthEventFixture('44444444-4444-4444-8444-444444444444', {
      kind: 'care', provenance: 'reminder', description: 'Perawatan pengingat fiktif',
    }),
  ];
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    return response(200, timeline);
  });
  const repository = new HttpApiLivestockHealthRepository(api);

  const result = await repository.listHealthEvents(livestockId);

  assert.deepEqual(result, timeline, 'the BE-03 projection remains distinct from a richer local UI note');
  assert.deepEqual(result.map((event) => event.provenance), ['clinical_note', 'farmer_report', 'reminder']);
  assert.equal(result[0].createdAt, timeline[0].createdAt);
  assert.equal(requests[0].url, `http://localhost:3000/v1/livestock/${livestockId}/health-events`);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer access-token-1');
  assert.equal(new URL(requests[0].url).searchParams.has('ownerId'), false);
});

test('BE-03 care write allowlists farmer report fields and preserves the server result', async () => {
  const livestockId = '55555555-5555-4555-8555-555555555555';
  const input = {
    kind: 'vaccine', occurredAt: '2026-11-17T10:15:00+07:00',
    description: 'Vaksinasi fiktif tanpa dosis obat.', sourceKey: 'care-source-key-0001',
    ownerId: 'must-not-be-sent', actorId: 'must-not-be-sent', provenance: 'clinical_note',
  };
  const returned = apiCareEventFixture('66666666-6666-4666-8666-666666666666', {
    kind: 'vaccine', description: input.description,
  });
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    return response(201, returned);
  });
  const repository = new HttpApiLivestockHealthRepository(api);

  const event = await repository.createCareEvent(livestockId, input);

  assert.deepEqual(event, returned);
  assert.equal(requests[0].url, `http://localhost:3000/v1/livestock/${livestockId}/care-events`);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer access-token-1');
  assert.equal(requests[0].init.headers['Idempotency-Key'], undefined, 'sourceKey in the request body is the BE-03 idempotency contract');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    kind: 'vaccine', occurredAt: input.occurredAt, description: input.description, sourceKey: input.sourceKey,
  });
  assert.equal(Object.hasOwn(event, 'createdAt'), false, 'the POST response does not contain createdAt');
  assert.equal(event.provenance, 'farmer_report', 'care report cannot be promoted to a clinical note');
});

test('BE-03 care validates UUID, farmer kinds, timestamp, description, and sourceKey bounds before transport', async () => {
  let calls = 0;
  const validResponse = apiCareEventFixture('77777777-7777-4777-8777-777777777777');
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(201, validResponse);
  });
  const repository = new HttpApiLivestockHealthRepository(api);
  const validInput = {
    kind: 'care', occurredAt: '2026-11-17T10:15:00.123456+07:00',
    description: 'Catatan perawatan fiktif.', sourceKey: 'x'.repeat(128),
  };

  await repository.createCareEvent('88888888-8888-4888-8888-888888888888', { ...validInput, sourceKey: 'x'.repeat(8) });
  await repository.createCareEvent('88888888-8888-4888-8888-888888888888', validInput);
  assert.equal(calls, 2, '8 and 128 characters are valid sourceKey boundary lengths');

  await assert.rejects(repository.createCareEvent('local-animal-id', validInput), { code: 'VALIDATION_FAILED' });
  for (const input of [
    { ...validInput, kind: 'examination' },
    { ...validInput, occurredAt: '2026-11-17T10:15:00' },
    { ...validInput, occurredAt: '2026-02-30T10:15:00Z' },
    { ...validInput, occurredAt: '2026-11-17T10:15:00+14:30' },
    { ...validInput, description: '' },
    { ...validInput, description: ' '.repeat(20) },
    { ...validInput, description: 'x'.repeat(2001) },
    { ...validInput, sourceKey: 'short' },
    { ...validInput, sourceKey: 'x'.repeat(129) },
    { ...validInput, sourceKey: ' '.repeat(8) },
  ]) {
    await assert.rejects(repository.createCareEvent('88888888-8888-4888-8888-888888888888', input), { code: 'VALIDATION_FAILED' });
  }
  assert.equal(calls, 2, 'invalid inputs are rejected before an API request');
});

test('BE-03 same sourceKey and payload retries recover the same event; uncertain transport never succeeds locally', async () => {
  const livestockId = '99999999-9999-4999-8999-999999999999';
  const input = {
    kind: 'care', occurredAt: '2026-11-17T10:15:00Z',
    description: 'Perawatan fiktif dicatat.', sourceKey: 'farmer-care-retry-001',
  };
  const committed = apiCareEventFixture('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    ...input, occurredAt: '2026-11-17T10:15:00.000Z',
  });
  const requests = [];
  let hasCommitted = false;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    if (!hasCommitted) {
      hasCommitted = true;
      throw new Error('server committed but response was lost');
    }
    if (body.sourceKey !== input.sourceKey || JSON.stringify(body) !== JSON.stringify({
      kind: input.kind, occurredAt: input.occurredAt, description: input.description, sourceKey: input.sourceKey,
    })) return response(409, { code: 'CONFLICT', message: 'sourceKey sudah digunakan untuk laporan yang berbeda.' });
    return response(200, committed);
  });
  const repository = new HttpApiLivestockHealthRepository(api);

  await assert.rejects(repository.createCareEvent(livestockId, input), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(requests.length, 1, 'a possibly committed POST is not retried automatically');
  const recovered = await repository.createCareEvent(livestockId, input);
  assert.deepEqual(recovered, committed);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(requests[0].init.headers['Idempotency-Key'], undefined);

  await assert.rejects(repository.createCareEvent(livestockId, { ...input, description: 'Payload berbeda.' }), { code: 'VERSION_CONFLICT' });
  assert.equal(requests.length, 3);
});

test('BE-03 care write preserves server doctor denial without fabricating a result', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async () => {
    calls += 1;
    return response(403, { code: 'FORBIDDEN', message: 'Aksi hanya untuk Peternak.' });
  });
  const repository = new HttpApiLivestockHealthRepository(api);
  await assert.rejects(repository.createCareEvent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    kind: 'care', occurredAt: '2026-11-17T10:15:00Z', description: 'Perawatan fiktif.', sourceKey: 'doctor-denied-key',
  }), { code: 'FORBIDDEN' });
  assert.equal(calls, 1);
});

test('BE-16 patients adapter parses assigned patient metrics and latest service without inventing photo', async () => {
  const patient = apiPatientFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async (url, init) => {
    requests.push({ url, init });
    return response(200, [patient]);
  });
  const repository = new HttpApiPatientReadRepository(api);

  const patients = await repository.listPatients();

  assert.deepEqual(patients, [patient]);
  assert.equal(patients[0].weightKg, '850.50');
  assert.equal(patients[0].ownerName, 'Peternak Fiktif');
  assert.equal(patients[0].serviceCount, 2);
  assert.equal(patients[0].latestServiceType, 'visit');
  assert.equal(patients[0].latestServiceStatus, 'arrived');
  assert.equal(Object.hasOwn(patients[0], 'photo'), false);
  assert.equal(requests[0].url, 'http://localhost:3000/v1/patients');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'access-token-1'}`);
});

test('BE-16 patient clinical adapter reads only the final-note projection and allowlists its fields', async () => {
  const animalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const note = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    consultationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    complaint: 'Keluhan fiktif', findings: 'Temuan fiktif', assessment: 'Penilaian fiktif',
    actions: 'Tindakan fiktif', careInstructions: 'Instruksi perawatan fiktif',
    finalizedAt: '2026-11-19T01:00:00.000Z', actorId: 'private-actor', attachments: ['private-media'],
  };
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async (url, init) => {
    requests.push({ url, init });
    return response(200, [note]);
  });
  const notes = await new HttpApiPatientClinicalReadRepository(api).listFinalNotes(animalId);

  assert.deepEqual(notes, [{
    id: note.id, consultationId: note.consultationId, complaint: note.complaint, findings: note.findings,
    assessment: note.assessment, actions: note.actions, careInstructions: note.careInstructions, finalizedAt: note.finalizedAt,
  }]);
  assert.equal(requests[0].url, `http://localhost:3000/v1/patients/${animalId}/clinical-notes`);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'access-token-1'}`);
});

test('BE-16 patient clinical adapter rejects malformed final-note projections', async () => {
  const animalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const note = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    consultationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    complaint: 'Keluhan fiktif', findings: 'Temuan fiktif', assessment: 'Penilaian fiktif',
    actions: 'Tindakan fiktif', careInstructions: 'Instruksi perawatan fiktif', finalizedAt: '2026-11-19T01:00:00.000Z',
  };
  for (const invalid of [{ ...note, id: 'not-a-uuid' }, { ...note, complaint: '' }, { ...note, finalizedAt: 'not-a-date' }, { ...note, findings: 'f'.repeat(8001) }]) {
    const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async () => response(200, [invalid]));
    await assert.rejects(new HttpApiPatientClinicalReadRepository(api).listFinalNotes(animalId), { code: 'API_RESPONSE_INVALID' });
  }
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async () => response(200, { items: [note] }));
  await assert.rejects(new HttpApiPatientClinicalReadRepository(api).listFinalNotes(animalId), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(new HttpApiPatientClinicalReadRepository(api).listFinalNotes('not-a-uuid'), { code: 'VALIDATION_FAILED' });
});

test('BE-16 patient media adapter reads only assigned-patient attachment metadata', async () => {
  const animalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const attachmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const media = {
    id: attachmentId,
    consultationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    recordId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    source: 'progress_report', kind: 'image', mimeType: 'image/jpeg', filename: 'foto-fiktif.jpg', byteSize: 1234,
    url: `/v1/attachments/${attachmentId}/content`, createdAt: '2026-11-19T01:00:00.000Z',
  };
  const requests = [];
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async (url, init) => {
    requests.push({ url, init });
    return response(200, [media]);
  });
  const records = await new HttpApiPatientMediaReadRepository(api).listForPatient(animalId);

  assert.deepEqual(records, [media]);
  assert.equal(requests[0].url, `http://localhost:3000/v1/patients/${animalId}/media`);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'access-token-1'}`);
});

test('BE-16 patient media adapter rejects malformed metadata, envelopes, and patient IDs', async () => {
  const animalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const attachmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const media = {
    id: attachmentId, consultationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    recordId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', source: 'message', kind: 'image', mimeType: 'image/jpeg',
    filename: 'foto-fiktif.jpg', byteSize: 1234, url: `/v1/attachments/${attachmentId}/content`, createdAt: '2026-11-19T01:00:00.000Z',
  };
  for (const invalid of [{ ...media, id: 'not-a-uuid' }, { ...media, kind: 'video' }, { ...media, byteSize: Number.MAX_SAFE_INTEGER + 1 }, { ...media, url: 'https://example.test/photo.jpg' }]) {
    const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async () => response(200, [invalid]));
    await assert.rejects(new HttpApiPatientMediaReadRepository(api).listForPatient(animalId), { code: 'API_RESPONSE_INVALID' });
  }
  const envelopeApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore({ ...tokenSet(), activeRole: 'vet' }), async () => response(200, { items: [media] }));
  await assert.rejects(new HttpApiPatientMediaReadRepository(envelopeApi).listForPatient(animalId), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(new HttpApiPatientMediaReadRepository(envelopeApi).listForPatient('not-a-uuid'), { code: 'VALIDATION_FAILED' });
});

test('BE-03 health, care, and patient adapters reject malformed actual service projections', async () => {
  const livestockId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const healthRecord = apiHealthEventFixture('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  const invalidHealthRecords = [
    [{ ...healthRecord, id: 'not-a-uuid' }],
    [{ ...healthRecord, provenance: 'unknown' }],
    [{ ...healthRecord, createdAt: '2026-11-17T10:15:00' }],
    [{ ...healthRecord, occurredAt: '2026-02-30T10:15:00.000Z' }],
    { items: [healthRecord] },
  ];
  for (const payload of invalidHealthRecords) {
    const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, payload));
    await assert.rejects(new HttpApiLivestockHealthRepository(api).listHealthEvents(livestockId), { code: 'API_RESPONSE_INVALID' });
  }

  const wrongCare = apiCareEventFixture('ffffffff-ffff-4fff-8fff-ffffffffffff', { provenance: 'clinical_note' });
  const careApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(201, wrongCare));
  await assert.rejects(new HttpApiLivestockHealthRepository(careApi).createCareEvent(livestockId, {
    kind: 'care', occurredAt: '2026-11-17T10:15:00Z', description: 'Perawatan fiktif.', sourceKey: 'source-key-0001',
  }), { code: 'API_RESPONSE_INVALID' });

  const invalidPatient = { ...apiPatientFixture('abababab-abab-4bab-8bab-abababababab'), weightKg: 850.5 };
  const patientApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, [invalidPatient]));
  await assert.rejects(new HttpApiPatientReadRepository(patientApi).listPatients(), { code: 'API_RESPONSE_INVALID' });

  for (const invalid of [
    { ownerName: '' }, { lastServiceAt: '2026-11-17T10:15:00' },
    { serviceCount: 0 }, { serviceCount: 1.5 },
    { latestServiceType: 'unknown' }, { latestServiceStatus: 'awaiting_payment' },
  ]) {
    const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, [
      { ...apiPatientFixture('abababab-abab-4bab-8bab-abababababab'), ...invalid },
    ]));
    await assert.rejects(new HttpApiPatientReadRepository(api).listPatients(), { code: 'API_RESPONSE_INVALID' });
  }

  const patientEnvelopeApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, {
    items: [apiPatientFixture('abababab-abab-4bab-8bab-abababababab')],
  }));
  await assert.rejects(new HttpApiPatientReadRepository(patientEnvelopeApi).listPatients(), { code: 'API_RESPONSE_INVALID' });
});

test('verified Vet directory reads map filters, detail, slots, and exact server paging', async () => {
  const vetId = '88888888-8888-4888-8888-888888888888';
  const cursor = 'directory:opaque/+ =';
  const requests = [];
  const summary = vetDirectoryFixture(vetId);
  const detail = vetDetailFixture(vetId);
  const slot = { startsAt: '2026-11-18T03:00:00.000Z', endsAt: '2026-11-18T03:30:00.000Z' };
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async (url, init) => {
    requests.push({ url, init });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/slots')) return response(200, [slot]);
    if (parsed.pathname === `/v1/vets/${vetId}`) return response(200, detail);
    if (parsed.searchParams.has('cursor')) return response(200, { items: [summary], nextCursor: null, hasMore: false });
    return response(200, { items: [summary], nextCursor: cursor, hasMore: true });
  });
  const repository = new HttpApiVetDirectoryReadRepository(api);

  const page = await repository.search({
    name: '  Dokter Fiktif ', species: 'cattle', service: 'visit', location: ' Bogor ',
    available: false, minFeeIdr: 30000, maxFeeIdr: 350000, limit: 1,
  });
  const next = await repository.search({
    name: 'Dokter Fiktif', species: 'cattle', service: 'visit', location: 'Bogor',
    available: false, minFeeIdr: 30000, maxFeeIdr: 350000,
    cursor: page.nextCursor, limit: 1,
  });
  const vet = await repository.getById(vetId);
  const slots = await repository.getSlots(vetId, { dateFrom: '2026-11-18', dateTo: '2026-11-19', service: 'chat' });

  assert.equal(page.items[0].professionalName, 'Dokter Fiktif');
  assert.equal(page.items[0].minFeeIdr, 30000);
  assert.equal(page.nextCursor, cursor);
  assert.equal(next.nextCursor, null);
  assert.equal(vet.chatDurationMinutes, 30);
  assert.equal(vet.rates.chat, 30000);
  assert.deepEqual(slots, [slot]);
  const directoryQuery = new URL(requests[0].url).searchParams;
  assert.equal(directoryQuery.get('name'), 'Dokter Fiktif');
  assert.equal(directoryQuery.get('species'), 'cattle');
  assert.equal(directoryQuery.get('service'), 'visit');
  assert.equal(directoryQuery.get('location'), 'Bogor');
  assert.equal(directoryQuery.get('available'), 'false');
  assert.equal(directoryQuery.get('minFee'), '30000');
  assert.equal(directoryQuery.get('maxFee'), '350000');
  assert.equal(directoryQuery.get('limit'), '1');
  assert.equal(new URL(requests[1].url).searchParams.get('cursor'), cursor);
  assert.equal(new URL(requests[1].url).searchParams.get('name'), 'Dokter Fiktif');
  assert.equal(new URL(requests[1].url).searchParams.get('service'), 'visit');
  assert.equal(new URL(requests[3].url).searchParams.get('dateFrom'), '2026-11-18');
  assert.equal(new URL(requests[3].url).searchParams.get('service'), 'chat');
  assert.equal(requests.every((request) => request.init.method === 'GET'), true);
});

test('Vet directory and slot adapters reject query bounds and malformed IDR/ISO DTOs', async () => {
  let calls = 0;
  const api = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => {
    calls += 1;
    return response(200, { items: [], nextCursor: null, hasMore: false });
  });
  const repository = new HttpApiVetDirectoryReadRepository(api);
  await assert.rejects(repository.search({ name: 'x'.repeat(121) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ minFeeIdr: 20, maxFeeIdr: 10 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ minFeeIdr: Number.MAX_SAFE_INTEGER + 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ limit: 101 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.search({ cursor: '' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getById('vet-local-id'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getSlots('88888888-8888-4888-8888-888888888888', {
    dateFrom: '2026-02-30', dateTo: '2026-03-01', service: 'chat',
  }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getSlots('88888888-8888-4888-8888-888888888888', {
    dateFrom: '2026-01-01', dateTo: '2026-02-02', service: 'visit',
  }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);

  const unsafeDirectory = {
    ...vetDirectoryFixture('99999999-9999-4999-8999-999999999999'),
    fees: { chat: Number.MAX_SAFE_INTEGER + 1, visit: 300000 },
    minFeeIdr: 300000,
    maxFeeIdr: Number.MAX_SAFE_INTEGER + 1,
  };
  const badPageApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, {
    items: [unsafeDirectory], nextCursor: null, hasMore: false,
  }));
  await assert.rejects(new HttpApiVetDirectoryReadRepository(badPageApi).search(), { code: 'API_RESPONSE_INVALID' });

  const invalidSlotsApi = new ApiClient('http://localhost:3000', new MemoryServerSessionStore(tokenSet()), async () => response(200, [
    { startsAt: '2026-11-18T03:00:00', endsAt: '2026-11-18T04:00:00.000Z' },
  ]));
  await assert.rejects(new HttpApiVetDirectoryReadRepository(invalidSlotsApi).getSlots('88888888-8888-4888-8888-888888888888', {
    dateFrom: '2026-11-18', dateTo: '2026-11-18', service: 'chat',
  }), { code: 'API_RESPONSE_INVALID' });
});

function catalogProductFixture(id, name, unitPriceIdr) {
  return {
    id, name, category: 'care', species: ['cattle'],
    description: 'Fixture katalog fiktif untuk kontrak read-only.',
    unitPriceIdr, imageAttachmentId: null, active: true,
  };
}

function apiHealthEventFixture(id, overrides = {}) {
  return {
    id,
    kind: 'care',
    occurredAt: '2026-11-17T10:15:00.000Z',
    description: 'Catatan kesehatan fiktif.',
    provenance: 'farmer_report',
    createdAt: '2026-11-17T10:16:00.000Z',
    ...overrides,
  };
}

function apiCareEventFixture(id, overrides = {}) {
  const kind = overrides.kind ?? 'care';
  const occurredAt = overrides.occurredAt ?? '2026-11-17T03:15:00.000Z';
  const description = overrides.description ?? 'Perawatan fiktif.';
  const provenance = overrides.provenance ?? 'farmer_report';
  return {
    id,
    kind,
    occurredAt,
    description,
    provenance,
  };
}

function apiPatientFixture(id) {
  return {
    id, displayCode: 'SAPI-002', name: 'Sapi Fiktif', species: 'cattle', breed: null, sex: 'female',
    birthDate: '2024-03-01', estimatedAgeMonths: 32, weightKg: '850.50',
    farmId: 'abababab-abab-4bab-8bab-abababababab', farmerId: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc',
    ownerName: 'Peternak Fiktif', lastServiceAt: '2026-11-17T10:15:00.000Z', serviceCount: 2,
    latestServiceType: 'visit', latestServiceStatus: 'arrived',
  };
}

function farmReadFixture(id) {
  return {
    id, name: 'Peternakan Fiktif', species: ['cattle'], timezone: 'Asia/Jakarta',
    location: { district: 'Bogor' }, visitAddressId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T09:00:00.000Z', version: 1,
  };
}

function addressReadFixture(id) {
  return {
    id, label: 'Kandang Utama', recipientName: 'Peternak Fiktif', phone: '+628123456789',
    addressLine: 'Jalan Fiktif Nomor 1', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111',
    latitude: '-6.123456', longitude: '106.123456',
    createdAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T09:00:00.000Z', version: 2,
  };
}

function livestockReadFixture(id, weightKg) {
  return {
    id, farmerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', farmId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    displayCode: 'SAPI-001', name: 'Sapi Fiktif', species: 'cattle', breed: 'Persilangan fiktif', sex: 'female',
    birthDate: '2024-03-01', estimatedAgeMonths: 32, weightKg,
    createdAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T09:00:00.000Z', version: 1,
  };
}

function vetDirectoryFixture(id) {
  return {
    id, professionalName: 'Dokter Fiktif', experienceYears: 8, specialties: ['Layanan fiktif'], species: ['cattle'],
    practiceLocation: 'Bogor', serviceAreas: ['Bogor'], acceptingNewRequests: true, services: ['chat', 'visit'],
    timezone: 'Asia/Jakarta', weekdayRules: [{ weekday: 3, start: '09:00', end: '12:00' }],
    fees: { chat: 30000, visit: 300000 }, minFeeIdr: 30000, maxFeeIdr: 300000,
    ratingAverage: 4.75, ratingCount: 4,
  };
}

function vetDetailFixture(id) {
  const { fees, minFeeIdr, maxFeeIdr, ...summary } = vetDirectoryFixture(id);
  return { ...summary, chatDurationMinutes: 30, visitDurationMinutes: 90, rates: fees };
}

function tokenSet(accessToken = 'access-token-1', refreshToken = 'refresh-token-1') {
  return {
    accessToken, refreshToken, sessionId: 'session-1', activeRole: 'farmer',
    accessExpiresAt: '2026-11-16T10:00:00.000Z', expiresAt: '2026-12-16T10:00:00.000Z',
  };
}

function authResponse(accessToken = 'access-token-1', refreshToken = 'refresh-token-1', activeRole = 'farmer', roles = ['farmer']) {
  return {
    accessToken, refreshToken, sessionId: 'session-1', tokenType: 'Bearer', activeRole,
    accessExpiresAt: '2026-11-16T10:00:00.000Z', sessionExpiresAt: '2026-12-16T10:00:00.000Z',
    user: { id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik Ternak', roles },
  };
}

function paymentCreateResponse({ payableId = 'order-1', amountIdr = 125000, status = 'pending', id = 'payment-1' } = {}) {
  return {
    id, payableType: 'order', payableId, amountIdr, currency: 'IDR', method: 'bank_transfer', status,
    attempt: { id: `attempt-${status}`, status, reference: status === 'pending' ? 'local:opaque' : null },
  };
}

function paymentRecord({ id = 'payment-1', payableId = 'order-1', amountIdr = 125000, status = 'pending', attempts = [attemptRecord(1, status)] } = {}) {
  const latest = attempts.at(-1);
  return {
    id, payableType: 'order', payableId, amountIdr, currency: 'IDR', method: 'bank_transfer', status,
    attempt: latest ? { id: latest.id, status: latest.status, reference: latest.reference } : null,
    attempts,
  };
}

function attemptRecord(attemptNumber, status) {
  return {
    id: `attempt-${attemptNumber}`, attemptNumber, status,
    reference: status === 'pending' ? `local:attempt-${attemptNumber}` : null,
    attemptedAt: `2026-11-16T10:0${attemptNumber}:00.000Z`,
  };
}

function withPaymentStatus(payment, status) {
  const attempts = payment.attempts.map((attempt, index) => index === payment.attempts.length - 1 ? { ...attempt, status } : attempt);
  return paymentRecord({ ...payment, status, attempts });
}

function createPaymentGateway(server, sessions, persistence) {
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    if (url.endsWith('/v1/payment-quotes/order/order-4')) {
      return response(200, { payableType: 'order', payableId: 'order-4', amountIdr: 125000, currency: 'IDR' });
    }
    if (url.includes('/v1/payments?')) {
      return server.payment
        ? response(200, server.payment)
        : response(404, { code: 'NOT_FOUND', message: 'Belum ada pembayaran.' });
    }
    if (url.endsWith('/v1/payments/payment-4/attempts')) return response(200, { items: server.payment.attempts });
    if (url.endsWith('/v1/payments')) {
      const request = { key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) };
      server.createRequests.push(request);
      if (server.loseFirstResponse) {
        server.loseFirstResponse = false;
        server.payment = paymentRecord({ id: 'payment-4', payableId: 'order-4', attempts: [attemptRecord(1, 'pending')] });
        throw new Error('server committed but response was lost');
      }
      const attemptNumber = server.payment.attempts.length + 1;
      server.payment = paymentRecord({
        id: 'payment-4', payableId: 'order-4', attempts: [...server.payment.attempts, attemptRecord(attemptNumber, 'pending')],
      });
      return response(201, paymentCreateResponse({ payableId: 'order-4', id: 'payment-4', status: 'pending' }));
    }
    if (url.endsWith('/v1/payments/payment-4')) return response(200, server.payment);
    throw new Error(`Unexpected route: ${url}`);
  });
  return new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ApiPaymentOperationJournal(persistence));
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

class MemoryServerSessionStore {
  constructor(value) { this.value = value ? structuredClone(value) : null; }
  async read() { return this.value ? structuredClone(this.value) : null; }
  async save(value) { this.value = structuredClone(value); }
  async clear() { this.value = null; }
}

function createPaymentOperationJournal(persistence = new MemoryOperationPersistence()) {
  return new ApiPaymentOperationJournal(persistence);
}

class MemoryOperationPersistence {
  values = new Map();
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async deleteItem(key) { this.values.delete(key); }
}
