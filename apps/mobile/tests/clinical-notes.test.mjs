import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ClinicalNoteService } from '../.test-build/src/application/ClinicalNoteService.js';
import { ConsultationService } from '../.test-build/src/application/ConsultationService.js';
import { HealthRecordService } from '../.test-build/src/application/HealthRecordService.js';
import { LivestockService } from '../.test-build/src/application/LivestockService.js';
import { ProfileService } from '../.test-build/src/application/ProfileService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteEventStore } from '../.test-build/src/data/local/sqlite/SqliteEventStore.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

const now = () => new Date('2026-10-05T00:00:00.000Z');
const completeFields = {
  complaint: 'Keluhan dari konsultasi Budi.',
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
  const media = {
    async pickPhoto() { return null; },
    async pickDocuments() { return []; },
    async store() { throw new Error('unused'); },
    async remove() {},
  };
  const factory = { create: () => `clinical-test-${++sequence}` };
  const booking = new SqliteBookingRepository(db);
  const repository = new SqliteDomainRepository(db);
  const profilesRepository = new SqliteProfileRepository(db);
  const fresh = () => new ClinicalNoteService(new SqliteBookingRepository(db), factory, now);
  const consultations = new ConsultationService(booking, media, factory, now);
  const profiles = new ProfileService(profilesRepository, media, factory, now);
  const livestock = new LivestockService(repository, profilesRepository, media, factory, now);
  const healthRecords = new HealthRecordService(repository, livestock, profiles, new SqliteEventStore(db), now);
  return { db, booking, repository, service: fresh(), fresh, consultations, healthRecords };
}

async function change(s, kind, id, patch) {
  const record = await s.repository.findById(kind, id);
  await s.repository.update({ ...record, version: record.version + 1, payload: { ...record.payload, ...patch } }, record.version);
}

async function startVisitExam(s) {
  let record = await s.repository.findById('consultation', ids.visitRequest);
  await s.consultations.act(ids.vetZero, 'vet', {
    id: record.id, version: record.version, action: 'accept', operationKey: 'clinical-test-accept-visit',
  });
  let detail = await s.consultations.detail(ids.vetZero, 'vet', record.id);
  const staleVisitVersion = detail.visit.version;
  for (const action of ['depart', 'arrive', 'start_examination']) {
    await s.consultations.advanceVisit(ids.vetZero, 'vet', {
      consultationId: record.id,
      consultationVersion: detail.record.version,
      visitVersion: detail.visit.version,
      operationKey: `clinical-test-visit:${action}`,
      action,
    });
    detail = await s.consultations.detail(ids.vetZero, 'vet', record.id);
  }
  return { detail, staleVisitVersion };
}

test('FE14 saves scoped clinical drafts with optimistic versions and reloads persisted input', async () => {
  const s = await setup();
  try {
    const draft = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, { ...completeFields, findings: '' });
    assert.equal(draft.status, 'draft');
    assert.equal(draft.record.version, 1);
    const reloaded = await s.fresh().load(ids.vetZero, 'vet', ids.chatFlow);
    assert.equal(reloaded.fields.complaint, completeFields.complaint);
    const updated = await s.service.saveDraft(ids.vetZero, ids.chatFlow, reloaded.record.version, { ...completeFields, findings: 'Temuan diperbarui.' });
    assert.equal(updated.record.version, 2);
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.chatFlow, 1, completeFields), { code: 'VERSION_CONFLICT' });
    assert.equal(await s.service.load(ids.budi, 'farmer', ids.chatFlow), null);
    await assert.rejects(s.service.saveDraft(ids.rani, ids.chatFlow, updated.record.version, completeFields), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE14 finalization validates required fields, stays in progress, and projects one read-only result to farmer history', async () => {
  const s = await setup();
  try {
    const partial = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, { ...completeFields, assessment: ' ' });
    await assert.rejects(s.service.finalize(ids.vetZero, ids.chatFlow, partial.record.version), { code: 'VALIDATION_FAILED' });
    assert.equal((await s.repository.findById('consultation', ids.chatFlow)).payload.status, 'in_progress');
    assert.equal((await s.repository.listByKind('healthEvent')).some((item) => item.payload.clinicalNoteId === partial.record.id), false);

    const ready = await s.service.saveDraft(ids.vetZero, ids.chatFlow, partial.record.version, completeFields);
    const finalized = await s.service.finalize(ids.vetZero, ids.chatFlow, ready.record.version);
    assert.equal(finalized.status, 'final');
    assert.equal((await s.repository.findById('consultation', ids.chatFlow)).payload.status, 'in_progress');
    const farmerView = await s.service.load(ids.budi, 'farmer', ids.chatFlow);
    assert.equal(farmerView.record.id, finalized.record.id);
    const healthRecords = await s.healthRecords.listForFarmer(ids.budi, ids.cow);
    const results = healthRecords.filter((item) => item.source === 'clinical_note' && item.clinicalNote?.consultationId === ids.chatFlow);
    assert.equal(results.length, 1);
    assert.equal(results[0].clinicalNote.findings, completeFields.findings);
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.chatFlow, finalized.record.version, completeFields), { code: 'IMMUTABLE_RECORD' });
    await assert.rejects(s.service.finalize(ids.vetZero, ids.chatFlow, finalized.record.version), { code: 'IMMUTABLE_RECORD' });
  } finally { s.db.close(); }
});

test('FE14 finalization rolls back note, projection and audit together on storage failure', async () => {
  const s = await setup();
  try {
    const draft = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, completeFields);
    const beforeActions = await s.repository.listByRelated('consultationAction', ids.chatFlow, 'consultation');
    s.db.failInsertKind = 'healthEvent';
    await assert.rejects(s.service.finalize(ids.vetZero, ids.chatFlow, draft.record.version), /storage failure/);
    s.db.failInsertKind = null;
    assert.equal((await s.repository.findById('clinicalNote', draft.record.id)).payload.status, 'draft');
    assert.equal((await s.repository.findById('consultation', ids.chatFlow)).payload.status, 'in_progress');
    assert.deepEqual(await s.repository.listByRelated('consultationAction', ids.chatFlow, 'consultation'), beforeActions);
    assert.equal((await s.repository.listByKind('healthEvent')).some((item) => item.payload.clinicalNoteId === draft.record.id), false);
  } finally { s.db.close(); }
});

test('FE14 completion requires final note and confirmation and records one pending earning on chat', async () => {
  const s = await setup();
  try {
    const draft = await s.service.saveDraft(ids.vetZero, ids.chatFlow, null, completeFields);
    const finalized = await s.service.finalize(ids.vetZero, ids.chatFlow, draft.record.version);
    const consultation = await s.repository.findById('consultation', ids.chatFlow);
    const command = {
      consultationId: ids.chatFlow,
      consultationVersion: consultation.version,
      noteVersion: finalized.record.version,
      visitVersion: null,
      operationKey: `clinical-test-complete:${ids.chatFlow}`,
      confirmed: false,
    };
    await assert.rejects(s.service.complete(ids.vetZero, command), { code: 'INVALID_STATE' });
    assert.equal((await s.repository.findById('consultation', ids.chatFlow)).payload.status, 'in_progress');
    assert.equal((await s.repository.listByKind('earningTransaction')).some((item) => item.payload.consultationId === ids.chatFlow), false);

    const confirmed = { ...command, confirmed: true };
    await Promise.all([s.service.complete(ids.vetZero, confirmed), s.fresh().complete(ids.vetZero, confirmed)]);
    await s.fresh().complete(ids.vetZero, confirmed);
    assert.equal((await s.repository.findById('consultation', ids.chatFlow)).payload.status, 'completed');
    const earnings = (await s.repository.listByKind('earningTransaction')).filter((item) => item.payload.consultationId === ids.chatFlow);
    assert.equal(earnings.length, 1);
    assert.deepEqual({ gross: earnings[0].payload.gross, commission: earnings[0].payload.commission, net: earnings[0].payload.net, status: earnings[0].payload.status }, { gross: 75000, commission: 7500, net: 67500, status: 'pending' });
    const ledger = (await s.repository.listByRelated('ledgerEntry', earnings[0].id, 'earning'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].payload.kind, 'earn_pending');
    assert.equal(ledger[0].payload.amount, 67500);
    assert.equal(earnings[0].payload.paymentId, ids.chatFlowPayment);
  } finally { s.db.close(); }
});

test('FE14 completes a visit only after note final and examining stage in one transition', async () => {
  const s = await setup();
  try {
    const { detail, staleVisitVersion } = await startVisitExam(s);
    assert.equal(detail.visit.payload.stage, 'examining');
    const draft = await s.service.saveDraft(ids.vetZero, ids.visitRequest, null, completeFields);
    const finalized = await s.service.finalize(ids.vetZero, ids.visitRequest, draft.record.version);
    const current = await s.repository.findById('consultation', ids.visitRequest);
    const command = {
      consultationId: ids.visitRequest,
      consultationVersion: current.version,
      noteVersion: finalized.record.version,
      visitVersion: staleVisitVersion,
      operationKey: 'clinical-test-complete-visit',
      confirmed: true,
    };
    await assert.rejects(s.service.complete(ids.vetZero, command), { code: 'VERSION_CONFLICT' });
    const latest = await s.consultations.detail(ids.vetZero, 'vet', ids.visitRequest);
    await s.service.complete(ids.vetZero, { ...command, visitVersion: latest.visit.version });
    const completed = await s.consultations.detail(ids.budi, 'farmer', ids.visitRequest);
    assert.equal(completed.record.payload.status, 'completed');
    assert.equal(completed.visit.payload.stage, 'completed');
    assert.ok(completed.visit.payload.completedAt);
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
