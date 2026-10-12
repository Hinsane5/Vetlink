import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ClinicalNoteService } from '../.test-build/src/application/ClinicalNoteService.js';
import { RecommendationService } from '../.test-build/src/application/RecommendationService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');
const clinicalFields = {
  complaint: 'Keluhan fiktif dari konsultasi.',
  findings: 'Temuan pemeriksaan fiktif tercatat.',
  assessment: 'Penilaian umum untuk keperluan fixture.',
  actions: 'Pemeriksaan dasar fiktif dilakukan.',
  careInstructions: 'Pantau kondisi dan hubungi dokter bila berubah.',
};

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  let sequence = 0;
  const factory = { create: () => `recommendation-test-${++sequence}` };
  const booking = new SqliteBookingRepository(db);
  const repository = new SqliteDomainRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const media = { async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store() { throw new Error('unused'); }, async remove() {} };
  const notes = new ClinicalNoteService(booking, factory, now);
  const fresh = () => new RecommendationService(new SqliteBookingRepository(db), factory, now);
  return { db, booking, repository, service: fresh(), fresh, notes };
}

async function finalizeNote(s) {
  const draft = await s.notes.saveDraft(ids.vetZero, ids.chatFlow, null, clinicalFields);
  return s.notes.finalize(ids.vetZero, ids.chatFlow, draft.record.version);
}

async function change(s, kind, id, patch) {
  const record = await s.repository.findById(kind, id);
  await s.repository.update({ ...record, version: record.version + 1, payload: { ...record.payload, ...patch } }, record.version);
}

test('FE15 persists edited recommendation items, optional product links, removal and sent read projection', async () => {
  const s = await setup();
  try {
    await finalizeNote(s);
    const [product] = await s.service.listProducts(ids.vetZero, ids.chatFlow);
    assert.equal(product.id, ids.product);
    const beforeCartItems = (await s.repository.listByKind('cartItem')).length;
    const draft = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, [
      { productId: product.id, titleSnapshot: 'Perawatan pilihan dokter', instructions: 'Instruksi yang diketik dokter.', note: 'Catatan tambahan.' },
      { productId: null, titleSnapshot: 'Saran tanpa produk', instructions: 'Teks instruksi yang diedit.', note: '' },
    ]);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.items.length, 2);
    assert.equal(draft.items[0].titleSnapshot, 'Perawatan pilihan dokter');
    assert.equal(draft.items[0].productId, product.id);
    assert.deepEqual((await s.repository.listRelated('recommendationItem', draft.items[0].id, 'product')).map((item) => item.id), [product.id]);
    assert.equal(draft.items[1].productId, null);
    assert.equal(await s.service.load(ids.budi, 'farmer', ids.chatFlow), null);

    const edited = await s.service.saveDraft(ids.vetZero, ids.chatFlow, draft.record.version, [
      { id: draft.items[0].id, productId: product.id, titleSnapshot: 'Judul hasil edit', instructions: 'Instruksi hasil edit tersimpan.', note: 'Catatan diperbarui.' },
    ]);
    assert.equal(edited.items.length, 1);
    assert.equal(edited.items[0].id, draft.items[0].id);
    assert.equal(edited.items[0].titleSnapshot, 'Judul hasil edit');
    assert.equal(edited.items[0].instructions, 'Instruksi hasil edit tersimpan.');
    assert.equal(await s.repository.findById('recommendationItem', draft.items[1].id), null);
    const reloaded = await s.fresh().load(ids.vetZero, 'vet', ids.chatFlow);
    assert.equal(reloaded.items[0].titleSnapshot, 'Judul hasil edit');
    assert.equal(reloaded.items[0].instructions, 'Instruksi hasil edit tersimpan.');

    const command = { consultationId: ids.chatFlow, expectedVersion: edited.record.version, operationKey: 'fe15-send-chat-flow' };
    const [sent, retried] = await Promise.all([s.service.send(ids.vetZero, command), s.fresh().send(ids.vetZero, command)]);
    assert.equal(sent.status, 'sent');
    assert.equal(sent.items[0].titleSnapshot, 'Judul hasil edit');
    assert.equal(sent.items[0].instructions, 'Instruksi hasil edit tersimpan.');
    assert.equal(sent.items[0].productId, product.id);
    assert.equal(sent.items[0].productName, product.name);
    assert.equal(retried.record.id, sent.record.id);
    assert.equal(retried.record.version, sent.record.version);
    assert.equal((await s.service.load(ids.budi, 'farmer', ids.chatFlow)).items[0].productId, product.id);
    assert.equal((await s.repository.listByKind('consultationAction')).filter((item) => item.payload.action === 'send_recommendation').length, 1);
    assert.equal((await s.repository.listByKind('cartItem')).length, beforeCartItems);
    assert.equal((await s.repository.listByKind('cart')).length, 2);
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.chatFlow, sent.record.version, []), { code: 'IMMUTABLE_RECORD' });
    const sentItem = await s.repository.findById('recommendationItem', sent.items[0].id);
    await assert.rejects(s.repository.delete('recommendationItem', sent.items[0].id, sentItem.version), { code: 'IMMUTABLE_RECORD' });
  } finally { s.db.close(); }
});

test('FE15 rejects empty send, hides drafts from farmers, and enforces assignment and verification', async () => {
  const s = await setup();
  try {
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.chatFlow, null, []), { code: 'INVALID_STATE' });
    await finalizeNote(s);
    const empty = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, []);
    assert.equal(empty.items.length, 0);
    assert.equal(await s.service.load(ids.budi, 'farmer', ids.chatFlow), null);
    await assert.rejects(s.service.send(ids.vetZero, {
      consultationId: ids.chatFlow,
      expectedVersion: empty.record.version,
      operationKey: 'fe15-empty-send',
    }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(s.service.load(ids.rani, 'vet', ids.chatFlow), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.saveDraft(ids.budi, ids.chatFlow, empty.record.version, []), { code: 'FORBIDDEN' });

    await change(s, 'vetProfile', ids.yudaProfile, { verificationStatus: 'pending' });
    await assert.rejects(s.service.send(ids.vetZero, {
      consultationId: ids.chatFlow,
      expectedVersion: empty.record.version,
      operationKey: 'fe15-unverified-send',
    }), { code: 'FORBIDDEN' });
    assert.equal((await s.repository.findById('recommendation', empty.record.id)).payload.status, 'draft');
    assert.equal((await s.repository.listByKind('consultationAction')).some((item) => item.payload.operationKey === 'fe15-unverified-send'), false);
  } finally { s.db.close(); }
});

test('FE15 rolls back an empty aggregate when recommendation item persistence fails', async () => {
  const s = await setup();
  try {
    await finalizeNote(s);
    s.db.failInsertKind = 'recommendationItem';
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.chatFlow, null, [
      { productId: null, titleSnapshot: 'Saran fiktif', instructions: 'Instruksi umum.', note: '' },
    ]), /storage failure/);
    s.db.failInsertKind = null;
    assert.equal((await s.repository.listByKind('recommendation')).length, 0);
    assert.equal((await s.repository.listByKind('recommendationItem')).length, 0);
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  failInsertKind = null;
  queue = Promise.resolve();
  constructor() { this.database.exec('PRAGMA foreign_keys = ON'); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) {
    if (sql.includes('INSERT INTO entities') && bindings[1] === this.failInsertKind) throw new Error('storage failure');
    return this.database.prepare(sql).run(...bindings);
  }
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
