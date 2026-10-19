import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NotificationService } from '../.test-build/src/application/NotificationService.js';
import { PreferencesService } from '../.test-build/src/application/PreferencesService.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-20T00:00:00.000Z');

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  let sequence = 0;
  const repository = new SqliteDomainRepository(db);
  const idFactory = { create: () => `fe22-preferences-${++sequence}` };
  return {
    db,
    repository,
    notifications: new NotificationService(repository, now),
    preferences: new PreferencesService(repository, idFactory, now),
    freshPreferences: () => new PreferencesService(repository, idFactory, now),
  };
}

test('FE22 inbox lists only the active recipient and preserves the saved context ID', async () => {
  const s = await setup();
  try {
    const farmerInbox = await s.notifications.listForRecipient(ids.budi);
    const vetInbox = await s.notifications.listForRecipient(ids.vetZero);

    assert.equal(farmerInbox.length, 1);
    assert.equal(farmerInbox[0].id, ids.notification);
    assert.equal(farmerInbox[0].recipientId, ids.budi);
    assert.equal(farmerInbox[0].contextId, ids.request);
    assert.equal(vetInbox.length, 1);
    assert.equal(vetInbox[0].id, ids.vetNotification);
    assert.equal(vetInbox[0].recipientId, ids.vetZero);
    assert.equal(vetInbox[0].contextId, ids.visit);
    assert.equal(farmerInbox.some((item) => item.recipientId !== ids.budi), false);
    assert.equal(vetInbox.some((item) => item.recipientId !== ids.vetZero), false);
    await assert.rejects(s.notifications.markRead(ids.vetZero, ids.notification), { code: 'NOT_FOUND' });
    await assert.rejects(s.notifications.listForRecipient('akun-tidak-ada'), { code: 'NOT_FOUND' });
  } finally { s.db.close(); }
});

test('FE22 marking read persists once and duplicate taps return the same stored state', async () => {
  const s = await setup();
  try {
    const first = await s.notifications.markRead(ids.budi, ids.notification);
    const stored = await s.repository.findById('notification', ids.notification);
    const retry = await s.notifications.markRead(ids.budi, ids.notification);
    assert.equal(first.readAt, '2026-10-20T00:00:00.000Z');
    assert.equal(retry.readAt, first.readAt);
    assert.equal(retry.contextId, ids.request);
    assert.equal(retry.id, ids.notification);
    assert.equal((await s.repository.findById('notification', ids.notification)).version, stored.version);
    assert.equal((await s.notifications.listForRecipient(ids.budi))[0].readAt, first.readAt);
  } finally { s.db.close(); }
});

test('FE22 preferences persist per account and do not delete or filter inbox records', async () => {
  const s = await setup();
  try {
    const farmerBefore = await s.notifications.listForRecipient(ids.budi);
    const initial = await s.preferences.load(ids.budi);
    assert.equal(initial.enabled, true);
    assert.equal(initial.notifications.commerce, false);

    const saved = await s.preferences.update(ids.budi, { enabled: false, notifications: { reminders: false } });
    const reloaded = await s.freshPreferences().load(ids.budi);
    const vetPreferences = await s.preferences.load(ids.vetZero);
    const farmerAfter = await s.notifications.listForRecipient(ids.budi);
    assert.equal(saved.enabled, false);
    assert.equal(reloaded.enabled, false);
    assert.equal(reloaded.notifications.reminders, false);
    assert.equal(reloaded.notifications.commerce, false);
    assert.equal(vetPreferences.enabled, true);
    assert.equal(vetPreferences.notifications.reminders, true);
    assert.deepEqual(farmerAfter.map((item) => item.id), farmerBefore.map((item) => item.id));

    const version = (await s.repository.findById('preferences', initial.id)).version;
    const duplicate = await s.preferences.update(ids.budi, { enabled: false, notifications: { reminders: false } });
    assert.equal(duplicate.version, version);
    assert.equal((await s.repository.listByOwner('preferences', ids.budi)).length, 1);
  } finally { s.db.close(); }
});

test('FE22 creates missing preferences once and keeps them after reloading the service', async () => {
  const s = await setup();
  try {
    const created = await s.preferences.load(ids.sari);
    const reloaded = await s.freshPreferences().load(ids.sari);
    assert.equal(created.id, reloaded.id);
    assert.equal(reloaded.enabled, true);
    assert.deepEqual(reloaded.notifications, { consultations: true, reminders: true, commerce: true });
    assert.equal((await s.repository.listByOwner('preferences', ids.sari)).length, 1);
  } finally { s.db.close(); }
});

test('FE22 extends an older seeded install once and preserves saved farmer settings and read state', async () => {
  const s = await setup();
  try {
    const read = await s.notifications.markRead(ids.budi, ids.notification);
    const saved = await s.preferences.update(ids.budi, { notifications: { commerce: true } });
    const entityCount = (await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entities')).count;
    const relationCount = (await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entity_relations')).count;

    await s.db.runAsync('DELETE FROM entity_relations WHERE source_id IN (?, ?)', ids.vetNotification, ids.vetPreferences);
    await s.db.runAsync('DELETE FROM entities WHERE id IN (?, ?)', ids.vetNotification, ids.vetPreferences);
    await s.db.runAsync('DELETE FROM domain_events WHERE id = ?', 'fixture-vet-visit-scheduled');
    await s.db.runAsync("DELETE FROM app_metadata WHERE key = 'fixture_account_version'");
    await seedFixturesIfEmpty(s.db);

    assert.equal((await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entities')).count, entityCount);
    assert.equal((await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entity_relations')).count, relationCount);
    assert.equal((await s.notifications.listForRecipient(ids.vetZero))[0].contextId, ids.visit);
    assert.equal((await s.notifications.listForRecipient(ids.budi))[0].readAt, read.readAt);
    assert.equal((await s.preferences.load(ids.budi)).notifications.commerce, true);
    await seedFixturesIfEmpty(s.db);
    assert.equal((await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entities')).count, entityCount);
    assert.equal((await s.db.getFirstAsync('SELECT COUNT(*) AS count FROM entity_relations')).count, relationCount);
    assert.equal((await s.preferences.load(ids.budi)).version, saved.version);
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) { return this.database.prepare(sql).run(...bindings); }
  async withExclusiveTransactionAsync(action) {
    this.database.exec('BEGIN IMMEDIATE');
    try { await action(this); this.database.exec('COMMIT'); }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}
