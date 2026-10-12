import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AvailabilityService } from '../.test-build/src/application/AvailabilityService.js';
import { CareCoordinationService } from '../.test-build/src/application/CareCoordinationService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  const booking = new SqliteBookingRepository(db);
  const repository = new SqliteDomainRepository(db);
  const media = { async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store() { throw new Error('unused'); }, async remove() {} };
  let sequence = 0;
  const factory = { create: () => `care-test-${++sequence}` };
  const service = new CareCoordinationService(booking, now);
  const availability = new AvailabilityService(booking, media, factory, now);
  return { db, repository, service, availability };
}

async function change(repository, kind, id, patch) {
  const record = await repository.findById(kind, id);
  await repository.update({ ...record, version: record.version + 1, payload: { ...record.payload, ...patch } }, record.version);
}

test('FE16 schedules a recheck in doctor local time and projects it into the doctor calendar', async () => {
  const s = await setup();
  try {
    const input = { startsAt: '2026-10-16 10:00', endsAt: '2026-10-16 10:30', reason: 'Pemeriksaan ulang fiktif.', operationKey: 'fe16-recheck-oct16' };
    const [created, retry] = await Promise.all([
      s.service.scheduleFollowUp(ids.vetZero, ids.completed, input),
      s.service.scheduleFollowUp(ids.vetZero, ids.completed, input),
    ]);
    assert.equal(created.id, retry.id);
    assert.equal(created.payload.startsAt, '2026-10-16T03:00:00.000Z');
    assert.equal(created.payload.endsAt, '2026-10-16T03:30:00.000Z');
    assert.equal(created.payload.timezone, 'Asia/Jakarta');
    assert.equal((await s.repository.listByKind('followUp')).filter((item) => item.payload.operationKey === input.operationKey).length, 1);
    const calendar = await s.availability.calendar(ids.vetZero);
    assert.ok(calendar.entries.some((entry) => entry.id === created.id && entry.kind === 'followUp' && entry.startsAt === created.payload.startsAt));
    await assert.rejects(s.service.scheduleFollowUp(ids.vetZero, ids.completed, { ...input, startsAt: '2026-02-30 10:00', operationKey: 'fe16-bad-date-key' }), { code: 'VALIDATION_FAILED' });
  } finally { s.db.close(); }
});

test('FE16 keeps farmer reports separate and exposes them only to the assigned doctor', async () => {
  const s = await setup();
  try {
    const first = await s.service.submitProgressReport(ids.sari, ids.followUp, { text: 'Kondisi ternak membaik menurut pengamatan peternak.', operationKey: 'fe16-report-first' });
    const retry = await s.service.submitProgressReport(ids.sari, ids.followUp, { text: 'Kondisi ternak membaik menurut pengamatan peternak.', operationKey: 'fe16-report-first' });
    assert.equal(first.record.id, retry.record.id);
    assert.equal((await s.repository.listByKind('healthEvent')).length, 1);
    assert.equal((await s.repository.listByKind('progressReport')).length, 1);
    await assert.rejects(s.service.load(ids.rani, 'vet', ids.completed), { code: 'FORBIDDEN' });
    const doctorView = await s.service.load(ids.vetZero, 'vet', ids.completed);
    assert.equal(doctorView.reports.length, 1);
    assert.equal(doctorView.reports[0].text, 'Kondisi ternak membaik menurut pengamatan peternak.');
    assert.equal(doctorView.reports[0].viewedAt, now().toISOString());
    assert.equal((await s.repository.findById('progressReport', first.record.id)).payload.viewedAt, now().toISOString());
  } finally { s.db.close(); }
});

test('FE16 separates reminder delivery from care and records exactly one HealthEvent on completion', async () => {
  const s = await setup();
  try {
    const reminder = await s.service.createReminder(ids.sari, 'farmer', {
      consultationId: ids.completed,
      followUpId: ids.followUp,
      kind: 'care',
      dueAt: '2026-10-20 09:00',
      instructions: 'Pantau kondisi dan catat perubahan yang terlihat.',
      operationKey: 'fe16-care-reminder-1',
    });
    await change(s.repository, 'reminder', reminder.record.id, { deliveryStatus: 'sent' });
    const sent = await s.service.getReminder(ids.sari, reminder.record.id);
    assert.equal(sent.deliveryStatus, 'sent');
    assert.equal(sent.careStatus, 'scheduled');

    await assert.rejects(s.service.completeCare(ids.budi, reminder.record.id), { code: 'FORBIDDEN' });
    const [done, retried] = await Promise.all([
      s.service.completeCare(ids.sari, reminder.record.id),
      s.service.completeCare(ids.sari, reminder.record.id),
    ]);
    assert.equal(done.careStatus, 'done');
    assert.equal(done.deliveryStatus, 'sent');
    assert.equal(retried.careStatus, 'done');
    assert.equal(retried.deliveryStatus, 'sent');
    const events = (await s.repository.listByKind('healthEvent')).filter((item) => item.payload.sourceKey === `reminder:${reminder.record.id}`);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.reminderId, reminder.record.id);
    assert.deepEqual((await s.repository.listRelated('healthEvent', events[0].id, 'reminder')).map((item) => item.id), [reminder.record.id]);
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  queue = Promise.resolve();
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) { return this.database.prepare(sql).run(...bindings); }
  async withExclusiveTransactionAsync(action) {
    const task = this.queue.then(async () => {
      this.database.exec('BEGIN IMMEDIATE');
      try { await action(this); this.database.exec('COMMIT'); }
      catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  close() { this.database.close(); }
}
