import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { FarmService } from '../.test-build/src/application/FarmService.js';
import { LivestockService } from '../.test-build/src/application/LivestockService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');
const secondFarmInput = {
  name: 'Peternakan Budi Dua', species: ['cattle'], location: 'Cibinong, Bogor',
  addressLabel: 'Kandang Utara', recipient: 'Budi Santoso', phone: '081234567890',
  address: 'Jalan Padang Fiktif Nomor 8', city: 'Bogor', province: 'Jawa Barat', postalCode: '16911',
};
const animalInput = {
  displayCode: 'BUD-01', name: 'Kenanga', species: 'cattle', breed: 'Sapi fiktif',
  sex: 'female', estimatedAgeMonths: 30, weightKg: 280,
};

test('farms persist CRUD and selection; animals stay scoped to their farm across list/detail/edit', async () => {
  const s = await setup();
  try {
    const second = await s.farms.create(ids.budi, secondFarmInput);
    assert.equal(second.selected, true);
    assert.equal(second.visitAddress, 'Jalan Padang Fiktif Nomor 8, Bogor, Jawa Barat, 16911');
    assert.deepEqual((await s.farms.list(ids.budi)).map((farm) => farm.id).sort(), [ids.budiFarm, second.id].sort());
    assert.equal((await s.farms.get(ids.budi, ids.budiFarm)).selected, false);
    await assert.rejects(s.farms.get(ids.budi, ids.sariFarm), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');

    const secondAnimal = await s.livestock.create(ids.budi, second.id, animalInput);
    assert.equal(secondAnimal.displayCode, 'BUD-01');
    assert.equal(secondAnimal.farmId, second.id);
    assert.equal(secondAnimal.farmVisitAddress, second.visitAddress);
    const all = await s.livestock.list(ids.budi);
    assert.deepEqual(new Set(all.map((item) => item.id)), new Set([ids.cow, secondAnimal.id]));
    assert.equal((await s.livestock.get(ids.budi, ids.cow)).farmId, ids.budiFarm);
    const updated = await s.livestock.update(ids.budi, secondAnimal.id, { ...animalInput, name: 'Kenanga Baru', weightKg: 291 });
    assert.equal(updated.farmId, second.id);
    assert.equal(updated.name, 'Kenanga Baru');
    assert.equal((await s.livestock.get(ids.budi, ids.cow)).name, 'Mawar');

    const editedFarm = await s.farms.update(ids.budi, second.id, { ...secondFarmInput, name: 'Peternakan Budi Timur' });
    assert.equal(editedFarm.name, 'Peternakan Budi Timur');
    assert.equal(editedFarm.selected, true);
    assert.equal((await s.farms.list(ids.budi)).length, 2);
    await assert.rejects(s.livestock.create(ids.budi, ids.sariFarm, animalInput), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
    await assert.rejects(s.livestock.update(ids.budi, ids.goat, animalInput), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
  } finally { s.db.close(); }
});

test('farm migration backfills legacy context without deleting or replacing records', async () => {
  const db = new SQLiteAdapter();
  try {
    await migrateDatabase(db);
    await seedFixturesIfEmpty(db);
    const entityCount = (await db.getFirstAsync('SELECT COUNT(*) AS count FROM entities')).count;
    const originalAnimal = await db.getFirstAsync('SELECT payload_json, created_at FROM entities WHERE id = ?', ids.cow);
    const originalAddress = await db.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', ids.budiAddress);

    await db.runAsync("UPDATE entities SET payload_json = json_remove(payload_json, '$.farmId') WHERE kind = 'farmerProfile'");
    await db.runAsync("UPDATE entities SET payload_json = json_remove(payload_json, '$.visitAddressId') WHERE kind = 'farm'");
    await db.runAsync("UPDATE entities SET context_id = ? WHERE id = ?", ids.budiProfile, ids.budiAddress);
    await db.runAsync("UPDATE entities SET context_id = ? WHERE id = ?", ids.sariProfile, ids.sariAddress);
    await db.runAsync("UPDATE entities SET payload_json = json_remove(payload_json, '$.farmId'), context_id = ? WHERE id = ?", ids.budiProfile, ids.cow);
    await db.runAsync("UPDATE entities SET payload_json = json_remove(payload_json, '$.farmId'), context_id = ? WHERE id = ?", ids.sariProfile, ids.goat);
    await db.runAsync("UPDATE entities SET payload_json = json_remove(payload_json, '$.farmId') WHERE kind = 'consultation'");
    await db.runAsync("DELETE FROM entity_relations WHERE relationship IN ('owner', 'visitAddress', 'farm') AND (source_id IN (SELECT id FROM entities WHERE kind IN ('farm', 'livestock', 'consultation')))");
    await db.runAsync("INSERT INTO entities (id, kind, owner_id, context_id, payload_json, created_at, updated_at, version) VALUES (?, 'bookingDraft', ?, ?, ?, ?, ?, 1)",
      'legacy-draft', ids.budi, ids.vetZero, JSON.stringify({ vetId: ids.vetZero, status: 'draft', input: { animalId: ids.cow } }), now().toISOString(), now().toISOString());
    await db.execAsync('DROP INDEX preferences_user_unique');
    await db.runAsync('DELETE FROM schema_migrations WHERE version IN (3, 4)');
    await db.execAsync('PRAGMA user_version = 2');

    assert.equal(await migrateDatabase(db), 4);
    assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM entities')).count, entityCount + 1);
    const migratedProfile = JSON.parse((await db.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', ids.budiProfile)).payload_json);
    const migratedFarm = JSON.parse((await db.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', ids.budiFarm)).payload_json);
    const migratedAnimalRow = await db.getFirstAsync('SELECT payload_json, context_id, created_at FROM entities WHERE id = ?', ids.cow);
    const migratedAnimal = JSON.parse(migratedAnimalRow.payload_json);
    const migratedConsultationRow = await db.getFirstAsync('SELECT payload_json, context_id FROM entities WHERE id = ?', ids.visit);
    const migratedConsultation = JSON.parse(migratedConsultationRow.payload_json);
    const migratedDraft = JSON.parse((await db.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', 'legacy-draft')).payload_json);
    assert.equal(migratedProfile.farmId, ids.budiFarm);
    assert.equal(migratedFarm.visitAddressId, ids.budiAddress);
    assert.equal(migratedAnimal.farmId, ids.budiFarm);
    assert.equal(migratedAnimalRow.context_id, ids.budiFarm);
    assert.equal(migratedAnimalRow.created_at, originalAnimal.created_at);
    assert.equal(migratedConsultation.farmId, ids.budiFarm);
    assert.equal(migratedConsultationRow.context_id, ids.budiFarm);
    assert.equal(migratedDraft.input.farmId, ids.budiFarm);
    assert.equal(JSON.parse((await db.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', ids.budiAddress)).payload_json).address,
      JSON.parse(originalAddress.payload_json).address);
    assert.deepEqual(await db.getAllAsync('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  const repository = new SqliteDomainRepository(db);
  const profiles = new SqliteProfileRepository(db);
  let sequence = 0;
  const factory = { create: () => `farm-test-${++sequence}` };
  const media = { async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store() { throw new Error('unused'); }, async remove() {} };
  return {
    db,
    farms: new FarmService(repository, profiles, factory, now),
    livestock: new LivestockService(repository, profiles, media, factory, now),
  };
}

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
