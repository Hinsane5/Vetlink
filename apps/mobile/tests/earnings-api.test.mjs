import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiEarningsRepository } from '../.test-build/src/data/remote/HttpApiEarningsRepository.js';

const ids = {
  earning: '11111111-1111-4111-8111-111111111111',
  consultation: '22222222-2222-4222-8222-222222222222',
  destination: '33333333-3333-4333-8333-333333333333',
  withdrawal: '44444444-4444-4444-8444-444444444444',
};
const destination = { id: ids.destination, label: 'Rekening fiktif', bankLabel: 'Bank Contoh', accountMasked: '****1234', accountHolder: 'Dokter Fiktif' };
const transaction = { id: ids.earning, consultationId: ids.consultation, displayCode: 'VL-C-1', serviceLabel: 'Konsultasi', gross: 100000, commission: 10000, net: 90000, status: 'available', earnedAt: '2026-11-17T10:00:00.000Z' };
const withdrawal = { id: ids.withdrawal, amount: 50000, fee: 0, netAmount: 50000, status: 'submitted', submittedAt: '2026-11-17T11:00:00.000Z', adapterOutcome: 'succeeded', destination };
const summary = {
  period: '2026-11', periodLabel: 'November 2026', periods: [{ value: '2026-11', label: 'November 2026' }],
  balances: { pending: 0, available: 40000, reserved: 50000, paidOut: 0 },
  totals: { gross: 100000, commission: 10000, net: 90000 },
  transactions: [transaction], nextCursor: null, hasMore: false,
  withdrawals: [withdrawal], history: [withdrawal], destinations: [destination],
};

test('earnings API reads scoped summary, transaction, destinations, and withdrawal page', async () => {
  const calls = [];
  const repository = new HttpApiEarningsRepository(apiClient(async (url) => {
    calls.push(url);
    if (url.includes('/earnings?')) return response(200, summary);
    if (url.includes('/transactions/')) return response(200, transaction);
    if (url.endsWith('/payout-destinations')) return response(200, { items: [destination] });
    if (url.includes('/withdrawals?')) return response(200, { items: [withdrawal], nextCursor: null, hasMore: false });
    if (url.endsWith(`/withdrawals/${ids.withdrawal}`)) return response(200, withdrawal);
    throw new Error(`Unexpected URL: ${url}`);
  }));
  assert.equal((await repository.getEarnings({ period: '2026-11', limit: 1 })).balances.available, 40000);
  assert.equal((await repository.getTransaction(ids.earning)).net, 90000);
  assert.equal((await repository.getDestinations())[0].accountMasked, '****1234');
  assert.equal((await repository.getWithdrawals({ limit: 1, cursor: 'opaque-token' })).items[0].status, 'submitted');
  assert.equal((await repository.getWithdrawal(ids.withdrawal)).amount, 50000);
  assert.ok(calls[0].endsWith('/v1/me/vet/earnings?period=2026-11&limit=1'));
  assert.ok(calls[3].includes('cursor=opaque-token'));
  assert.ok(calls.every((url) => !url.includes('vetId=')));
});

test('withdrawal POST uses integer rupiah and caller idempotency key without automatic retry', async () => {
  const requests = [];
  const repository = new HttpApiEarningsRepository(apiClient(async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new Error('response lost');
    return response(201, { operationId: ids.withdrawal, replayed: true, adapterOutcome: 'succeeded', withdrawal });
  }));
  const operation = Object.freeze({ idempotencyKey: 'withdrawal:operation-1', payload: Object.freeze({ amount: 50000, destinationId: ids.destination, vetId: ids.earning }) });
  await assert.rejects(repository.createWithdrawal(operation), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(requests.length, 1);
  const replay = await repository.createWithdrawal(operation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.withdrawal.status, 'submitted');
  assert.equal(requests[1].init.headers['Idempotency-Key'], operation.idempotencyKey);
  assert.deepEqual(JSON.parse(requests[0].init.body), { amount: 50000, destinationId: ids.destination });
  assert.equal(requests[0].init.body, requests[1].init.body);
});

test('confirmed payout adapter failure is distinct from an uncertain transport error', async () => {
  const repository = new HttpApiEarningsRepository(apiClient(async () => response(503, {
    code: 'WITHDRAWAL_FAILED', message: 'Adapter pencairan gagal; reservasi saldo telah dilepas.', requestId: 'request-1',
  })));
  await assert.rejects(repository.createWithdrawal({
    idempotencyKey: 'withdrawal:confirmed-failure',
    payload: { amount: 50000, destinationId: ids.destination },
  }), { code: 'ADAPTER_FAILED' });
});

test('earnings adapter rejects invalid money, balance math, query, and response before success', async () => {
  let calls = 0;
  const repository = new HttpApiEarningsRepository(apiClient(async () => { calls += 1; return response(200, summary); }));
  await assert.rejects(repository.createWithdrawal({ idempotencyKey: 'withdrawal:bad-1', payload: { amount: 0, destinationId: ids.destination } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createWithdrawal({ idempotencyKey: 'withdrawal:bad-2', payload: { amount: 1.5, destinationId: ids.destination } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getEarnings({ period: '2026-13' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getEarnings({ from: '2026-11-17' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getWithdrawals({ limit: 101 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getWithdrawal('not-uuid'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const malformed = [
    { ...summary, totals: { gross: 100000, commission: 10000, net: 100000 } },
    { ...summary, transactions: [{ ...transaction, net: 100000 }] },
    { ...summary, withdrawals: [{ ...withdrawal, amount: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...summary, balances: { ...summary.balances, available: -1 } },
  ];
  for (const value of malformed) {
    const invalid = new HttpApiEarningsRepository(apiClient(async () => response(200, value)));
    await assert.rejects(invalid.getEarnings(), { code: 'API_RESPONSE_INVALID' });
  }
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}

function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
