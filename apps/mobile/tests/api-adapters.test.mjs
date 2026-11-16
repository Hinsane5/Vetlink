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
