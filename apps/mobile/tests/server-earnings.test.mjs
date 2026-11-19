import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerEarningsService } from '../.test-build/src/application/ServerEarningsService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';

const vetId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const withdrawalId = '33333333-3333-4333-8333-333333333333';

function makeSnapshot(available = 40000) {
  return {
    period: '2026-11', periodLabel: 'November 2026', periods: [{ value: '2026-11', label: 'November 2026' }],
    balances: { pending: 0, available, reserved: 0, paidOut: 0 },
    totals: { gross: 50000, commission: 10000, net: 40000 },
    transactions: [], nextCursor: null, hasMore: false, withdrawals: [], history: [],
    destinations: [{ id: destinationId, label: 'Bank Contoh', bankLabel: 'Bank Contoh', accountMasked: '•••• 1234', accountHolder: 'Dokter Fiktif' }],
  };
}

function makeAction({ withdrawal: withdrawalOverrides = {}, ...actionOverrides } = {}) {
  const withdrawal = {
    id: withdrawalId, amount: 25000, fee: 0, netAmount: 25000, status: 'submitting', submittedAt: null,
    adapterOutcome: 'pending', destination: { id: destinationId, label: 'Bank Contoh', bankLabel: 'Bank Contoh', accountMasked: '•••• 1234', accountHolder: 'Dokter Fiktif' },
    ...withdrawalOverrides,
  };
  return { operationId: withdrawal.id, replayed: false, adapterOutcome: withdrawal.adapterOutcome, ...actionOverrides, withdrawal };
}

function makeHarness({ snapshot = makeSnapshot(), create, id = 'withdrawal-key-0001' } = {}) {
  const operations = [];
  let pending = null;
  let reads = 0;
  const repository = {
    async getEarnings() { reads += 1; return snapshot; },
    async getTransaction() { throw new Error('not expected'); },
    async getWithdrawal() { throw new Error('not expected'); },
    async createWithdrawal(operation) { operations.push(operation); return create ? create(operation) : makeAction(); },
  };
  const store = {
    async read() { return pending; },
    async write(_userId, operation) {
      if (pending && JSON.stringify(pending) !== JSON.stringify(operation)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'pending');
      pending = operation;
    },
    async clear() { pending = null; },
  };
  const service = new ServerEarningsService(repository, store, () => id);
  return { service, repository, store, operations, get pending() { return pending; }, get reads() { return reads; } };
}

test('server earnings rejects Farmer role before repository access', async () => {
  const harness = makeHarness();
  await assert.rejects(harness.service.load('farmer', vetId), { code: 'FORBIDDEN' });
  await assert.rejects(harness.service.submitWithdrawal('farmer', vetId, 25000, destinationId), { code: 'FORBIDDEN' });
  assert.equal(harness.reads, 0);
  assert.equal(harness.operations.length, 0);
});

test('server withdrawal requires positive safe-integer IDR, available balance, and owned destination before journaling', async () => {
  const invalidAmounts = [0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1, NaN];
  for (const amount of invalidAmounts) {
    const harness = makeHarness();
    await assert.rejects(harness.service.submitWithdrawal('vet', vetId, amount, destinationId), { code: 'VALIDATION_FAILED' });
    assert.equal(harness.pending, null);
    assert.equal(harness.operations.length, 0);
  }
  const tooMuch = makeHarness();
  await assert.rejects(tooMuch.service.submitWithdrawal('vet', vetId, 40001, destinationId), { code: 'VALIDATION_FAILED' });
  assert.equal(tooMuch.pending, null);
  const foreignDestination = makeHarness({ snapshot: { ...makeSnapshot(), destinations: [] } });
  await assert.rejects(foreignDestination.service.submitWithdrawal('vet', vetId, 1000, destinationId), { code: 'NOT_FOUND' });
  assert.equal(foreignDestination.pending, null);
});

test('server withdrawal journals before POST and uncertain retry reuses identical key and payload after restart', async () => {
  let fail = true;
  const harness = makeHarness({ create: async () => {
    if (fail) throw new DomainError('SERVICE_UNAVAILABLE', 'network unknown');
    return makeAction();
  } });
  await assert.rejects(harness.service.submitWithdrawal('vet', vetId, 25000, destinationId), { code: 'SERVICE_UNAVAILABLE' });
  const saved = harness.pending;
  assert.deepEqual(saved, { idempotencyKey: 'withdrawal-key-0001', amount: 25000, destinationId });
  assert.deepEqual(harness.operations[0], { idempotencyKey: saved.idempotencyKey, payload: { amount: saved.amount, destinationId: saved.destinationId } });

  fail = false;
  const restarted = new ServerEarningsService(harness.repository, harness.store, () => 'unused-new-key-0002');
  const result = await restarted.retryPending('vet', vetId);
  assert.equal(result.withdrawal.status, 'submitting');
  assert.equal(result.withdrawal.adapterOutcome, 'pending');
  assert.equal(harness.operations.length, 2);
  assert.deepEqual(harness.operations[1], harness.operations[0]);
  assert.equal(harness.pending, null);
});

test('a pending operation blocks changed payloads and response mismatch preserves the journal', async () => {
  const harness = makeHarness({ create: async () => makeAction({ withdrawal: { amount: 20000 } }) });
  await assert.rejects(harness.service.submitWithdrawal('vet', vetId, 25000, destinationId), { code: 'API_RESPONSE_INVALID' });
  assert.ok(harness.pending);
  await assert.rejects(harness.service.submitWithdrawal('vet', vetId, 20000, destinationId), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(harness.operations.length, 1);
});

test('definitive adapter failure clears the retry journal because the server releases the reservation', async () => {
  const harness = makeHarness({ create: async () => { throw new DomainError('ADAPTER_FAILED', 'server confirmed failure'); } });
  await assert.rejects(harness.service.submitWithdrawal('vet', vetId, 25000, destinationId), { code: 'ADAPTER_FAILED' });
  assert.equal(harness.pending, null);
  assert.equal(harness.operations.length, 1);
});
