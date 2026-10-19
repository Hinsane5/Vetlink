import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ProfileService } from '../.test-build/src/application/ProfileService.js';
import { ReviewService } from '../.test-build/src/application/ReviewService.js';
import { VetDirectoryService } from '../.test-build/src/application/VetDirectoryService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  let sequence = 0;
  const factory = { create: () => `review-test-${++sequence}` };
  const media = { async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store() { throw new Error('unused'); }, async remove() {} };
  const profiles = new ProfileService(new SqliteProfileRepository(db), media, factory, now);
  const storage = new SqliteBookingRepository(db);
  const service = () => new ReviewService(new SqliteBookingRepository(db), profiles, factory, now);
  const directory = new VetDirectoryService(new SqliteDomainRepository(db), profiles, now);
  return { db, profiles, service: service(), fresh: service, directory };
}

test('FE21 saves one owner review for a completed consultation and updates the persisted doctor aggregate', async () => {
  const s = await setup();
  try {
    const existing = await s.service.load(ids.sari, 'farmer', ids.completed);
    assert.equal(existing.review.id, ids.yudaReview);
    assert.equal(existing.veterinarianName, 'drh. Yuda Pratama');
    assert.equal((await s.service.load(ids.budi, 'farmer', ids.completedPending)).review, null);

    const saved = await s.service.submit(ids.budi, 'farmer', ids.completedPending, 3, '  Penjelasan layanan cukup jelas.  ');
    assert.equal(saved.review.payload.stars, 3);
    assert.equal(saved.review.payload.text, 'Penjelasan layanan cukup jelas.');
    assert.equal(saved.review.ownerId, ids.budi);
    assert.equal(saved.review.payload.consultationId, ids.completedPending);
    assert.equal(saved.review.payload.vetId, ids.vetZero);
    assert.deepEqual((await s.db.getAllAsync('SELECT relationship, target_id FROM entity_relations WHERE source_id = ? ORDER BY relationship', saved.review.id)).map(({ relationship, target_id }) => ({ relationship, target_id })), [
      { relationship: 'consultation', target_id: ids.completedPending },
      { relationship: 'farmer', target_id: ids.budi },
      { relationship: 'veterinarian', target_id: ids.vetZero },
    ]);

    const vet = await s.directory.get(ids.vetZero);
    assert.equal(vet.ratingAverage, 4);
    assert.equal(vet.reviewCount, 2);
    assert.equal(vet.reviews.some((review) => review.id === saved.review.id && review.stars === 3), true);

    const duplicate = { ...saved.review, id: 'corrupt-review-duplicate', payload: { ...saved.review.payload, text: 'Duplikat.' } };
    await s.db.runAsync('INSERT INTO entities (id, kind, owner_id, context_id, payload_json, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', duplicate.id, duplicate.kind, duplicate.ownerId, duplicate.contextId, JSON.stringify(duplicate.payload), duplicate.createdAt, duplicate.updatedAt, duplicate.version);
    const deduplicated = await s.directory.get(ids.vetZero);
    assert.equal(deduplicated.reviewCount, 2);
    assert.equal(deduplicated.ratingAverage, 4);
  } finally { s.db.close(); }
});

test('FE21 rejects non-completed, foreign and doctor attempts, plus invalid rating input', async () => {
  const s = await setup();
  try {
    await assert.rejects(s.service.load(ids.budi, 'farmer', ids.completed), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.request, 4, 'Komentar'), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.submit(ids.vetZero, 'vet', ids.completedPending, 4, 'Komentar'), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.submit(ids.sari, 'farmer', ids.completedPending, 4, 'Komentar'), { code: 'FORBIDDEN' });
    for (const stars of [0, 6, 2.5]) {
      await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.completedPending, stars, 'Komentar'), { code: 'VALIDATION_FAILED' });
    }
    await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.completedPending, 5, 'x'.repeat(1001)), { code: 'VALIDATION_FAILED' });
    await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.completedPending, 5, ' '.repeat(1001)), { code: 'VALIDATION_FAILED' });
    assert.equal((await s.db.getFirstAsync("SELECT COUNT(*) AS count FROM entities WHERE kind = 'review'")).count, 1);
  } finally { s.db.close(); }
});

test('FE21 handles duplicate taps idempotently and does not replace the first review', async () => {
  const s = await setup();
  try {
    const [first, retried] = await Promise.all([
      s.service.submit(ids.budi, 'farmer', ids.completedPending, 4, 'Layanan berjalan baik.'),
      s.fresh().submit(ids.budi, 'farmer', ids.completedPending, 4, 'Layanan berjalan baik.'),
    ]);
    assert.equal(first.review.id, retried.review.id);
    assert.equal((await s.db.getAllAsync("SELECT id FROM entities WHERE kind = 'review' AND json_extract(payload_json, '$.consultationId') = ?", ids.completedPending)).length, 1);
    await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.completedPending, 2, 'Ulasan berbeda'), { code: 'IMMUTABLE_RECORD' });
    assert.equal((await s.service.load(ids.budi, 'farmer', ids.completedPending)).review.id, first.review.id);
  } finally { s.db.close(); }
});

test('FE21 storage failure rolls back the review and relations so the farmer can retry', async () => {
  const s = await setup();
  try {
    s.db.failRelationship = 'veterinarian';
    await assert.rejects(s.service.submit(ids.budi, 'farmer', ids.completedPending, 5, 'Komentar'), /storage failure/);
    assert.equal((await s.db.getFirstAsync("SELECT COUNT(*) AS count FROM entities WHERE kind = 'review' AND json_extract(payload_json, '$.consultationId') = ?", ids.completedPending)).count, 0);
    assert.equal((await s.db.getAllAsync("SELECT * FROM entity_relations WHERE source_id IN (SELECT id FROM entities WHERE kind = 'review' AND json_extract(payload_json, '$.consultationId') = ?)", ids.completedPending)).length, 0);
    s.db.failRelationship = null;
    const saved = await s.service.submit(ids.budi, 'farmer', ids.completedPending, 5, 'Komentar');
    assert.ok(saved.review.id);
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  failRelationship = null;
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) {
    if (sql.startsWith('INSERT INTO entity_relations') && bindings[1] === this.failRelationship) throw new Error('storage failure');
    return this.database.prepare(sql).run(...bindings);
  }
  async withExclusiveTransactionAsync(action) {
    this.database.exec('BEGIN IMMEDIATE');
    try { await action(this); this.database.exec('COMMIT'); }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  async execAsyncScript(sql) { this.database.exec(sql); }
  close() { this.database.close(); }
}
