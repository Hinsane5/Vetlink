import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { EarningsService } from '../.test-build/src/application/EarningsService.js';
import { fixtureEntities, fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  let serial = 9000;
  const repo = new SqliteDomainRepository(db);
  const service = new EarningsService(repo, { create: () => `fe23-generated-${++serial}` }, () => new Date('2026-10-20T12:00:00.000Z'));
  return { db, repo, service };
}

test('FE23 earnings use owner scoped assigned services, exact net and separate ledger buckets', async () => {
  const s = await setup();
  try {
    const snapshot = await s.service.load(ids.vetZero, 'vet', '2026-10');
    assert.equal(snapshot.periodLabel, 'Oktober 2026');
    assert.deepEqual(snapshot.balances, { pending: 81000, available: 88000, reserved: 20000, paidOut: 0 });
    assert.deepEqual(snapshot.totals, { gross: 210000, commission: 21000, net: 189000 });
    for (const earning of snapshot.transactions) assert.equal(earning.gross - earning.commission, earning.net);
    assert.deepEqual(new Set(snapshot.transactions.map((item) => item.status)), new Set(['pending', 'available']));
    assert.equal(snapshot.transactions.some((item) => item.consultationId === ids.completedPending), true);
    await assert.rejects(s.service.load(ids.vetZero, 'farmer'), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.getTransaction(ids.rani, 'vet', snapshot.transactions[0].id), { code: 'NOT_FOUND' });
  } finally { s.db.close(); }
});

test('FE23 submitted withdrawal reserves only the requested integer rupiah and remains unpaid', async () => {
  const s = await setup();
  try {
    const destination = (await s.repo.listByOwner('payoutDestination', ids.vetZero))[0];
    const submitted = await s.service.submitWithdrawal(ids.vetZero, 'vet', 45000, destination.id, 'fe23-partial-001');
    assert.equal(submitted.amount, 45000);
    assert.equal(submitted.fee, 0);
    assert.equal(submitted.netAmount, 45000);
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.destination.label, 'Bank Contoh •••• 1234');

    const snapshot = await s.service.load(ids.vetZero, 'vet', '2026-10');
    assert.deepEqual(snapshot.balances, { pending: 81000, available: 43000, reserved: 65000, paidOut: 0 });
    assert.equal(snapshot.history.filter((item) => item.id === submitted.id).length, 1);
    assert.equal(snapshot.history.find((item) => item.id === submitted.id).status, 'submitted');
    const reserveEntries = (await s.repo.listByOwner('ledgerEntry', ids.vetZero)).filter((item) => item.payload.withdrawalId === submitted.id);
    assert.equal(reserveEntries.length, 1);
    assert.equal(reserveEntries[0].payload.kind, 'reserve_withdrawal');
    assert.equal(reserveEntries[0].payload.amount, 45000);
    assert.deepEqual(await s.db.getAllAsync('PRAGMA foreign_key_check'), []);
  } finally { s.db.close(); }
});

test('FE23 rejects zero, negative, fractional, unsafe, over-available and zero-balance requests', async () => {
  const s = await setup();
  try {
    const destination = (await s.repo.listByOwner('payoutDestination', ids.vetZero))[0];
    for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(s.service.submitWithdrawal(ids.vetZero, 'vet', amount, destination.id, `invalid-${String(amount).replaceAll('.', '-')}`), { code: 'VALIDATION_FAILED' });
    }
    await assert.rejects(s.service.submitWithdrawal(ids.vetZero, 'vet', 88001, destination.id, 'fe23-over-available'), { code: 'VALIDATION_FAILED' });

    const raniDestination = {
      id: 'fe23-rani-destination', kind: 'payoutDestination', ownerId: ids.rani, contextId: null,
      createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', version: 1,
      payload: { vetId: ids.rani, bankLabel: 'Bank Contoh', accountMasked: '•••• 0002', accountHolder: 'Rani Contoh' },
    };
    await s.repo.create(raniDestination);
    await assert.rejects(s.service.submitWithdrawal(ids.rani, 'vet', 1, raniDestination.id, 'fe23-zero-balance'), { code: 'INVALID_STATE' });
    assert.equal((await s.repo.listByOwner('withdrawal', ids.vetZero)).length, 1);
  } finally { s.db.close(); }
});

test('FE23 retry and concurrent same-key confirmation create one withdrawal and one reserve', async () => {
  const s = await setup();
  try {
    const destination = (await s.repo.listByOwner('payoutDestination', ids.vetZero))[0];
    const [first, retry] = await Promise.all([
      s.service.submitWithdrawal(ids.vetZero, 'vet', 50000, destination.id, 'fe23-idempotent-001'),
      s.service.submitWithdrawal(ids.vetZero, 'vet', 50000, destination.id, 'fe23-idempotent-001'),
    ]);
    assert.equal(first.id, retry.id);
    assert.equal((await s.repo.listByOwner('withdrawal', ids.vetZero)).filter((item) => item.payload.operationKey === 'fe23-idempotent-001').length, 1);
    assert.equal((await s.repo.listByOwner('ledgerEntry', ids.vetZero)).filter((item) => item.payload.operationKey === 'reserve-withdrawal:fe23-idempotent-001').length, 1);
    await assert.rejects(s.service.submitWithdrawal(ids.vetZero, 'vet', 49000, destination.id, 'fe23-idempotent-001'), { code: 'VERSION_CONFLICT' });
  } finally { s.db.close(); }
});

test('FE23 concurrent distinct submissions cannot reserve more than available', async () => {
  const s = await setup();
  try {
    const destination = (await s.repo.listByOwner('payoutDestination', ids.vetZero))[0];
    const results = await Promise.allSettled([
      s.service.submitWithdrawal(ids.vetZero, 'vet', 70000, destination.id, 'fe23-race-70000'),
      s.service.submitWithdrawal(ids.vetZero, 'vet', 30000, destination.id, 'fe23-race-30000'),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
    const snapshot = await s.service.load(ids.vetZero, 'vet', '2026-10');
    assert.ok(snapshot.balances.available >= 0);
    assert.ok(snapshot.balances.reserved <= 108000);
    assert.equal(snapshot.balances.available + snapshot.balances.reserved, 108000);
  } finally { s.db.close(); }
});

test('FE23 transaction failure rolls back withdrawal and reserve so the same key can retry', async () => {
  const s = await setup();
  try {
    const destination = (await s.repo.listByOwner('payoutDestination', ids.vetZero))[0];
    const before = await s.db.snapshot();
    s.db.failKind = 'ledgerEntry';
    await assert.rejects(s.service.submitWithdrawal(ids.vetZero, 'vet', 10000, destination.id, 'fe23-rollback-001'), /storage failure/);
    assert.deepEqual(await s.db.snapshot(), before);
    s.db.failKind = null;
    const retry = await s.service.submitWithdrawal(ids.vetZero, 'vet', 10000, destination.id, 'fe23-rollback-001');
    assert.equal(retry.status, 'submitted');
    assert.equal((await s.repo.listByOwner('withdrawal', ids.vetZero)).filter((item) => item.payload.operationKey === 'fe23-rollback-001').length, 1);
  } finally { s.db.close(); }
});

test('FE23 period boundaries follow Asia/Jakarta and transaction detail is read from assigned record', async () => {
  const s = await setup();
  try {
    const original = fixtureEntities.find((item) => item.id === ids.earningAvailable);
    const boundary = {
      ...original,
      id: 'fe23-period-boundary',
      createdAt: '2026-10-31T19:00:00.000Z',
      updatedAt: '2026-10-31T19:00:00.000Z',
      payload: { ...original.payload, gross: 10000, commission: 1000, net: 9000, earnedAt: '2026-10-31T19:00:00.000Z' },
    };
    await s.repo.create(boundary, [{ sourceId: boundary.id, targetId: ids.completed, relationship: 'consultation' }]);
    const november = await s.service.load(ids.vetZero, 'vet', '2026-11');
    assert.equal(november.transactions.length, 1);
    assert.equal(november.transactions[0].id, boundary.id);
    assert.deepEqual(november.totals, { gross: 10000, commission: 1000, net: 9000 });
    const detail = await s.service.getTransaction(ids.vetZero, 'vet', ids.earningAvailable);
    assert.equal(detail.displayCode, 'VL-V-100');
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  failKind = null;
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) {
    if (sql.includes('INSERT INTO entities') && bindings[1] === this.failKind) throw new Error('storage failure');
    return this.database.prepare(sql).run(...bindings);
  }
  async withExclusiveTransactionAsync(action) {
    const task = this.queue.then(async () => {
      this.database.exec('BEGIN IMMEDIATE');
      try { await action(this); this.database.exec('COMMIT'); }
      catch (cause) { this.database.exec('ROLLBACK'); throw cause; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  snapshot() { return this.database.prepare('SELECT * FROM entities ORDER BY id').all(); }
  close() { this.database.close(); }
}
