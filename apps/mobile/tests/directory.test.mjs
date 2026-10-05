import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { VetDirectoryService } from '../.test-build/src/application/VetDirectoryService.js';
import { emptyVetFilters, filterVets, projectDirectorySlots } from '../.test-build/src/domain/directory.js';
import { directoryFixturePatches, fixtureEntities, fixtureIds, fixtureRelations } from '../.test-build/src/testing/fixtures.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');

test('directory combines name, species, location, service, availability and the matching service fee', async () => {
  const { service } = setup();
  const vets = await service.list();
  assert.equal(vets.length, 3);
  const before = structuredClone(vets);
  assert.deepEqual(filterVets(vets, { ...emptyVetFilters, query: ' RANI ', species: 'goat', location: 'BOGOR', service: 'chat', availableOnly: true, maxFee: 75000 }).map((vet) => vet.id), [fixtureIds.rani]);
  assert.deepEqual(filterVets(vets, { ...emptyVetFilters, location: 'depok', service: 'visit', maxFee: 150000 }).map((vet) => vet.id), [fixtureIds.vetZero]);
  assert.deepEqual(filterVets(vets, { ...emptyVetFilters, service: 'visit', maxFee: 75000 }), []);
  assert.deepEqual(filterVets(vets, { ...emptyVetFilters, species: 'horse' }), []);
  assert.deepEqual(vets, before);
});

test('doctor identity, verification and reviews come from the selected records', async () => {
  const { service, records } = setup();
  const damar = await service.get(fixtureIds.damar);
  assert.equal(damar.name, 'drh. Damar Wijaya');
  assert.equal(damar.verified, false);
  assert.equal(damar.accepting, false);
  const yuda = await service.get(fixtureIds.vetZero);
  assert.equal(yuda.reviews.length, 1);
  assert.equal(yuda.reviews[0].text, records.find((record) => record.id === fixtureIds.yudaReview).payload.text);
  assert.equal(yuda.reviews[0].stars, 5);
  await assert.rejects(service.get('missing-doctor'), { code: 'NOT_FOUND' });
});

test('directory ignores future rates, unsupported rates and reviews unrelated to a completed consultation', async () => {
  const { service, records } = setup();
  records.push(record('future-rate', 'serviceRate', fixtureIds.rani, { serviceType: 'chat', amount: 1, effectiveAt: '2026-12-01T00:00:00Z' }));
  records.push(record('unused-rate', 'serviceRate', fixtureIds.rani, { serviceType: 'visit', amount: 1, effectiveAt: '2026-01-01T00:00:00Z' }));
  records.push(record('new-rate', 'serviceRate', fixtureIds.rani, { serviceType: 'chat', amount: 80000, effectiveAt: '2026-10-04T00:00:00Z' }));
  records.push(record('offset-rate', 'serviceRate', fixtureIds.rani, { serviceType: 'chat', amount: 81000, effectiveAt: '2026-10-04T23:00:00+07:00' }));
  records.push(record('latest-rate', 'serviceRate', fixtureIds.rani, { serviceType: 'chat', amount: 82000, effectiveAt: '2026-10-04T20:00:00Z' }));
  records.push(record('wrong-review', 'review', fixtureIds.budi, { consultationId: fixtureIds.completed, farmerId: fixtureIds.budi, vetId: fixtureIds.vetZero, stars: 5, text: 'Wrong owner' }));
  records.push(record('pending-review', 'review', fixtureIds.budi, { consultationId: fixtureIds.request, farmerId: fixtureIds.budi, vetId: fixtureIds.rani, stars: 5, text: 'Not completed' }));
  const rani = await service.get(fixtureIds.rani);
  assert.deepEqual(rani.rates, [{ service: 'chat', amount: 82000 }]);
  assert.equal(rani.reviews.length, 0);
  assert.equal((await service.get(fixtureIds.vetZero)).reviews.length, 1);
});

test('slots use the doctor timezone and omit accepted appointments, blocked time and scheduled follow-ups', async () => {
  const { service, records } = setup();
  records.push(record('blocked', 'blockedTime', fixtureIds.vetZero, { startsAt: '2026-10-05T03:00:00Z', endsAt: '2026-10-05T04:00:00Z' }));
  records.push(record('followup', 'followUp', fixtureIds.budi, { vetId: fixtureIds.vetZero, status: 'scheduled', startsAt: '2026-10-05T04:00:00Z', endsAt: '2026-10-05T05:00:00Z' }));
  const schedule = await service.slots(fixtureIds.vetZero, 'visit');
  assert.equal(schedule.timezone, 'Asia/Jakarta');
  assert.deepEqual(schedule.slots.filter((slot) => slot.startsAt.startsWith('2026-10-05')).map((slot) => [slot.startsAt, slot.endsAt]), [['2026-10-05T02:00:00.000Z', '2026-10-05T03:00:00.000Z']]);
  assert.equal(schedule.slots.some((slot) => slot.startsAt === '2026-10-08T02:00:00.000Z'), false);
  assert.equal(schedule.slots.some((slot) => slot.startsAt === '2026-10-08T03:00:00.000Z'), true);
  assert.equal(new Set(schedule.slots.map((slot) => slot.id)).size, schedule.slots.length);
});

test('unverified, unavailable or unsupported doctors have no slots and disabling availability keeps accepted appointments', async () => {
  const { service, records } = setup();
  const accepted = structuredClone(records.find((item) => item.id === fixtureIds.visit));
  assert.deepEqual((await service.slots(fixtureIds.damar, 'visit')).slots, []);
  assert.deepEqual((await service.slots(fixtureIds.rani, 'visit')).slots, []);
  records.find((item) => item.id === fixtureIds.yudaAvailability).payload.acceptingNewRequests = false;
  assert.equal((await service.get(fixtureIds.vetZero)).accepting, false);
  assert.deepEqual((await service.slots(fixtureIds.vetZero, 'visit')).slots, []);
  assert.deepEqual(records.find((item) => item.id === fixtureIds.visit), accepted);
});

test('slot projection excludes elapsed time and treats adjacent intervals as non-overlapping', async () => {
  const { service, records } = setup();
  const vet = await service.get(fixtureIds.rani);
  const availability = structuredClone(records.find((item) => item.id === fixtureIds.raniAvailability));
  availability.payload.weekdayRules = [{ weekday: 1, start: '09:00', end: '10:30' }, { weekday: 1, start: '09:00', end: '10:30' }];
  const commitments = [record('scheduled', 'consultation', fixtureIds.budi, { status: 'scheduled', startsAt: '2026-10-05T02:30:00Z', endsAt: '2026-10-05T03:00:00Z' })];
  const schedule = projectDirectorySlots(vet, 'chat', availability, commitments, new Date('2026-10-05T02:00:00Z'));
  assert.deepEqual(schedule.slots.map((slot) => slot.startsAt), ['2026-10-05T03:00:00.000Z']);
  availability.payload.weekdayRules = [{ weekday: 1, start: 'wrong', end: '10:00' }];
  assert.deepEqual(projectDirectorySlots(vet, 'chat', availability, [], now()).slots, []);
  availability.payload.timezone = 'invalid-zone';
  assert.deepEqual(projectDirectorySlots(vet, 'chat', availability, [], now()).slots, []);
});

test('fixture extension persists missing fields once, preserves saved edits and leaves all other records intact', async () => {
  const database = await oldFixtureDatabase();
  try {
    const profile = await database.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', fixtureIds.yudaProfile);
    await database.runAsync('UPDATE entities SET payload_json = ?, version = 4, updated_at = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(profile.payload_json), practiceLocation: 'Bandung', species: [], experienceYears: 0 }), '2100-01-01T00:00:00.000Z', fixtureIds.yudaProfile);
    const availability = await database.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', fixtureIds.yudaAvailability);
    await database.runAsync('UPDATE entities SET payload_json = ?, version = 3 WHERE id = ?', JSON.stringify({ ...JSON.parse(availability.payload_json), acceptingNewRequests: false, weekdayRules: [] }), fixtureIds.yudaAvailability);
    const untouched = database.snapshot().filter((item) => !Object.hasOwn(directoryFixturePatches, item.id));
    const result = await seedFixturesIfEmpty(database);
    assert.equal(result.status, 'already-seeded');
    const savedProfile = JSON.parse((await database.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', fixtureIds.yudaProfile)).payload_json);
    assert.equal(savedProfile.practiceLocation, 'Bandung');
    assert.deepEqual(savedProfile.species, []);
    assert.equal(savedProfile.experienceYears, 0);
    assert.deepEqual(savedProfile.visitRegions, ['Bogor', 'Depok']);
    assert.equal((await database.getFirstAsync('SELECT updated_at FROM entities WHERE id = ?', fixtureIds.yudaProfile)).updated_at, '2100-01-01T00:00:00.000Z');
    const savedAvailability = JSON.parse((await database.getFirstAsync('SELECT payload_json FROM entities WHERE id = ?', fixtureIds.yudaAvailability)).payload_json);
    assert.equal(savedAvailability.acceptingNewRequests, false);
    assert.deepEqual(savedAvailability.weekdayRules, []);
    assert.equal(savedAvailability.visitDurationMinutes, 60);
    assert.deepEqual(database.snapshot().filter((item) => !Object.hasOwn(directoryFixturePatches, item.id) && item.id !== fixtureIds.yudaReview), untouched);
    const first = database.snapshot();
    await seedFixturesIfEmpty(database);
    assert.deepEqual(database.snapshot(), first);
    assert.equal((await database.getFirstAsync("SELECT count(*) AS count FROM entities WHERE kind = 'review'")).count, 1);
    assert.deepEqual(await database.getAllAsync('PRAGMA foreign_key_check'), []);
    assert.equal((await database.getFirstAsync('PRAGMA integrity_check')).integrity_check, 'ok');
  } finally { database.close(); }
});

test('fixture extension rolls back its whole transaction on failure and succeeds on retry', async () => {
  const database = await oldFixtureDatabase();
  try {
    const before = database.snapshot();
    database.failOnId = fixtureIds.damarProfile;
    await assert.rejects(seedFixturesIfEmpty(database), /storage failure/);
    assert.deepEqual(database.snapshot(), before);
    assert.equal(await database.getFirstAsync("SELECT value FROM app_metadata WHERE key = 'fixture_directory_version'"), null);
    database.failOnId = null;
    await seedFixturesIfEmpty(database);
    assert.equal((await database.getFirstAsync("SELECT value FROM app_metadata WHERE key = 'fixture_directory_version'")).value, 'fe08-v1');
  } finally { database.close(); }
});

function setup() {
  const records = structuredClone(fixtureEntities);
  const repository = {
    async listByKind(kind) { return records.filter((item) => item.kind === kind); },
    async listByOwner(kind, ownerId) { return records.filter((item) => item.kind === kind && item.ownerId === ownerId); },
    async listByRelated(kind, relatedId, relationship) {
      const ids = fixtureRelations.filter((relation) => relation.targetId === relatedId && relation.relationship === relationship).map((relation) => relation.sourceId);
      return records.filter((item) => item.kind === kind && ids.includes(item.id));
    },
  };
  const profiles = { async load(id) {
    const profile = records.find((item) => item.kind === 'vetProfile' && item.ownerId === id);
    return { displayName: '', vet: profile.payload, photo: null, verificationStatus: profile.payload.verificationStatus };
  } };
  return { records, service: new VetDirectoryService(repository, profiles, now) };
}
function record(id, kind, ownerId, payload) {
  return { id, kind, ownerId, contextId: null, createdAt: now().toISOString(), updatedAt: now().toISOString(), version: 1, payload };
}

async function oldFixtureDatabase() {
  const database = new SQLiteAdapter();
  await migrateDatabase(database);
  await seedFixturesIfEmpty(database);
  await database.runAsync('DELETE FROM entity_relations WHERE source_id = ?', fixtureIds.yudaReview);
  await database.runAsync('DELETE FROM entities WHERE id = ?', fixtureIds.yudaReview);
  await database.runAsync("DELETE FROM app_metadata WHERE key = 'fixture_directory_version'");
  for (const [id, fields] of Object.entries(directoryFixturePatches)) {
    const payload = structuredClone(fixtureEntities.find((item) => item.id === id).payload);
    for (const field of Object.keys(fields)) delete payload[field];
    await database.runAsync('UPDATE entities SET payload_json = ? WHERE id = ?', JSON.stringify(payload), id);
  }
  return database;
}
class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  failOnId = null;
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) {
    if (sql.startsWith('UPDATE entities') && bindings.at(-1) === this.failOnId) throw new Error('storage failure');
    return this.database.prepare(sql).run(...bindings);
  }
  async withExclusiveTransactionAsync(action) {
    this.database.exec('BEGIN IMMEDIATE');
    try { await action(this); this.database.exec('COMMIT'); }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  snapshot() { return this.database.prepare('SELECT * FROM entities ORDER BY id').all(); }
  close() { this.database.close(); }
}
