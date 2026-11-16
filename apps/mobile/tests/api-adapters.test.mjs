import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiPaymentGateway } from '../.test-build/src/application/ApiPaymentGateway.js';
import { ApiPaymentOperationJournal } from '../.test-build/src/application/ApiPaymentOperationJournal.js';
import { ServerAuthService } from '../.test-build/src/application/ServerAuthService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { ApiClient, normalizeApiBaseUrl } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpServerAuthRepository } from '../.test-build/src/data/remote/ApiAuthRepository.js';
import { HttpApiPaymentRepository } from '../.test-build/src/data/remote/HttpApiPaymentRepository.js';

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
    idempotencyKey: 'pay-order-operation-1',
  }), (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('API base URL rejects non-private HTTP and embedded credentials', () => {
  assert.equal(normalizeApiBaseUrl('http://192.168.1.42:3000/'), 'http://192.168.1.42:3000');
  assert.equal(normalizeApiBaseUrl('https://api.example.test/'), 'https://api.example.test');
  assert.throws(() => normalizeApiBaseUrl('http://api.example.test'), (error) => error instanceof DomainError);
  assert.throws(() => normalizeApiBaseUrl('https://user:password@example.test'), (error) => error instanceof DomainError);
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

test('API role switching never grants a role absent from server membership and fails closed without a route', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const auth = new ServerAuthService({
    login: async () => authResponse(), register: async () => authResponse(), logout: async () => {},
    me: async () => ({
      id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik', roles: ['farmer'],
      activeRole: 'farmer', sessionId: 'session-1',
    }),
  }, sessions);

  await assert.rejects(auth.switchRole('vet'), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
});

test('API payment uses integer server quote, sends no client amount, and preserves server pending status', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const calls = [];
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/payment-quotes/order/order-1')) {
      return response(200, { payableType: 'order', payableId: 'order-1', amountIdr: 125000, currency: 'IDR' });
    }
    return response(201, {
      id: 'payment-1', payableType: 'order', payableId: 'order-1', amountIdr: 125000,
      currency: 'IDR', status: 'pending', attempt: { id: 'attempt-1', status: 'pending', reference: 'local:opaque' },
    });
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), createPaymentOperationJournal());

  const payment = await gateway.submit('farmer', 'order', 'order-1', 'bank_transfer');
  assert.equal(payment.status, 'pending');
  assert.equal(payment.amount, 125000);
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'pay:order:order-1:bank_transfer:1');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    payableType: 'order', payableId: 'order-1', method: 'bank_transfer',
  });
  assert.equal(Object.hasOwn(JSON.parse(calls[1].init.body), 'amount'), false);
});

test('payment failure is returned only when persisted by API; transport failure propagates with no local success fallback', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  let failCreate = false;
  const api = new ApiClient('http://localhost:3000', sessions, async (url) => {
    if (url.endsWith('/v1/payment-quotes/consultation/consultation-1')) {
      return response(200, { payableType: 'consultation', payableId: 'consultation-1', amountIdr: 30000, currency: 'IDR' });
    }
    if (failCreate) throw new Error('response lost');
    return response(201, {
      id: 'payment-2', payableType: 'consultation', payableId: 'consultation-1', amountIdr: 30000,
      currency: 'IDR', status: 'failed', attempt: { id: 'attempt-2', status: 'failed', reference: null },
    });
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), createPaymentOperationJournal());

  const failed = await gateway.submit('farmer', 'consultation', 'consultation-1', 'e_wallet');
  assert.equal(failed.status, 'failed');
  failCreate = true;
  await assert.rejects(
    gateway.submit('farmer', 'consultation', 'consultation-1', 'e_wallet'),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE',
  );
});

test('payment retry after a lost response reuses the same persisted key and payload', async () => {
  const sessions = new MemoryServerSessionStore(tokenSet());
  const persistence = new MemoryOperationPersistence();
  const operations = new ApiPaymentOperationJournal(persistence);
  const createRequests = [];
  let loseFirstResponse = true;
  const api = new ApiClient('http://localhost:3000', sessions, async (url, init) => {
    if (url.endsWith('/v1/payment-quotes/order/order-2')) {
      return response(200, { payableType: 'order', payableId: 'order-2', amountIdr: 67000, currency: 'IDR' });
    }
    createRequests.push({ headers: init.headers, body: init.body });
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error('response lost after server commit');
    }
    return response(201, {
      id: 'payment-3', payableType: 'order', payableId: 'order-2', amountIdr: 67000,
      currency: 'IDR', status: 'pending', attempt: { id: 'attempt-3', status: 'pending', reference: 'local:opaque' },
    });
  });
  const gateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), operations);

  await assert.rejects(gateway.submit('farmer', 'order', 'order-2', 'bank_transfer'),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  const retryGateway = new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ApiPaymentOperationJournal(persistence));
  const retry = await retryGateway.submit('farmer', 'order', 'order-2', 'bank_transfer');
  assert.equal(retry.status, 'pending');
  assert.equal(createRequests.length, 2);
  assert.equal(createRequests[0].headers['Idempotency-Key'], createRequests[1].headers['Idempotency-Key']);
  assert.equal(createRequests[0].body, createRequests[1].body);
  assert.equal((await new ApiPaymentOperationJournal(persistence).getOrCreate({ payableType: 'order', payableId: 'order-2', method: 'bank_transfer' })), createRequests[1].headers['Idempotency-Key']);
});

test('payment operation journal survives a new service instance and only advances after a server failure', async () => {
  const persistence = new MemoryOperationPersistence();
  const input = { payableType: 'order', payableId: 'order-3', method: 'e_wallet' };
  const first = await new ApiPaymentOperationJournal(persistence).getOrCreate(input);
  const afterRestart = new ApiPaymentOperationJournal(persistence);

  assert.equal(first, 'pay:order:order-3:e_wallet:1');
  assert.equal(await afterRestart.getOrCreate(input), first);
  const storedRecord = JSON.parse([...persistence.values.values()][0]);
  assert.equal(storedRecord.operationKey, first);
  assert.equal(Object.hasOwn(storedRecord, 'amount'), false);
  await afterRestart.recordOutcome(first, 'failed');
  assert.equal(await new ApiPaymentOperationJournal(persistence).getOrCreate(input), 'pay:order:order-3:e_wallet:2');
});

test('remote payment gate rejects vet role before making API requests', async () => {
  let calls = 0;
  const gateway = new ApiPaymentGateway({
    getQuote: async () => { calls += 1; throw new Error('must not call'); },
    create: async () => { calls += 1; throw new Error('must not call'); },
  }, createPaymentOperationJournal());
  await assert.rejects(
    gateway.submit('vet', 'order', 'order-1', 'bank_transfer'),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(calls, 0);
});

function tokenSet(accessToken = 'access-token-1', refreshToken = 'refresh-token-1') {
  return {
    accessToken, refreshToken, sessionId: 'session-1', activeRole: 'farmer',
    accessExpiresAt: '2026-11-16T10:00:00.000Z', expiresAt: '2026-12-16T10:00:00.000Z',
  };
}

function authResponse(accessToken = 'access-token-1', refreshToken = 'refresh-token-1') {
  return {
    accessToken, refreshToken, sessionId: 'session-1', tokenType: 'Bearer', activeRole: 'farmer',
    accessExpiresAt: '2026-11-16T10:00:00.000Z', sessionExpiresAt: '2026-12-16T10:00:00.000Z',
    user: { id: 'farmer-id', email: 'owner@example.test', fullName: 'Pemilik Ternak', roles: ['farmer'] },
  };
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
