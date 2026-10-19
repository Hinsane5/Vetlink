import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ConsultationService } from '../.test-build/src/application/ConsultationService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { selectVetDashboard } from '../.test-build/src/domain/dashboard.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';
const now = () => new Date('2026-10-05T00:00:00Z');
async function setup() {
  const db = new SQLiteAdapter(); await migrateDatabase(db); await seedFixturesIfEmpty(db);
  let sequence = 0;
  const media = { async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store() { throw Error('unused'); }, async remove() {} };
  const factory = { create: () => `consultation-test-${++sequence}` };
  const storage = new SqliteBookingRepository(db);
  const fresh = () => new ConsultationService(new SqliteBookingRepository(db), media, factory, now);
  return { db, repo: storage.read.repository, service: fresh(), fresh };
}
function cmd(record, action, extra = {}) { return { id: record.id, version: record.version, operationKey: `${record.id}:${record.version}:${action}`, action, ...extra }; }
async function change(s, kind, id, patch) { const r = await s.repo.findById(kind, id); await s.repo.update({ ...r, version: r.version + 1, payload: { ...r.payload, ...patch } }, r.version); }

// Real SQLite transactions, including failures between status and audit writes.
test('FE10 lists all scoped statuses and rejects foreign accounts, roles and unpaid doctor access', async () => {
  const s = await setup(); try {
    const farmer = await s.service.list(ids.budi, 'farmer');
    assert.ok(farmer.some(x => x.record.id === ids.completedPending));
    assert.ok(farmer.some(x => x.record.id === ids.visitRequest));
    const vet = await s.service.list(ids.vetZero, 'vet');
    assert.ok(vet.every(x => x.record.payload.vetId === ids.vetZero));
    await assert.rejects(s.service.detail(ids.vetZero, 'vet', ids.request), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.detail(ids.sari, 'farmer', ids.visit), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.detail(ids.rani, 'vet', ids.awaitingPayment), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.list(ids.vetZero, 'farmer'), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});
test('FE10 accepts once across instances, creates scheduled visit and rejects stale or reused commands', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    const c = cmd(r, 'accept');
    await Promise.all([s.service.act(ids.vetZero, 'vet', c), s.fresh().act(ids.vetZero, 'vet', c)]);
    const detail = await s.fresh().detail(ids.budi, 'farmer', r.id);
    assert.equal(detail.record.payload.status, 'scheduled'); assert.equal(detail.visit.payload.stage, 'scheduled'); assert.equal(detail.history.length, 1);
    await assert.rejects(s.service.act(ids.vetZero, 'vet', { ...c, action: 'reject', reason: 'Tidak tersedia' }), { code: 'IDEMPOTENCY_CONFLICT' });
    await assert.rejects(s.service.act(ids.vetZero, 'vet', { ...c, operationKey: 'stale' }), { code: 'VERSION_CONFLICT' });
  } finally { s.db.close(); }
});
test('FE10 final write rechecks verification, payment, time and blocked slots', async () => {
  for (const scenario of ['verification', 'payment', 'past', 'conflict']) {
    const s = await setup(); try {
      const r = await s.repo.findById('consultation', ids.visitRequest);
      if (scenario === 'verification') await change(s, 'vetProfile', ids.yudaProfile, { verificationStatus: 'pending' });
      if (scenario === 'payment') await change(s, 'payment', ids.visitRequestPayment, { status: 'pending' });
      if (scenario === 'past') await change(s, 'consultation', r.id, { startsAt: '2026-10-04T04:00:00.000Z', endsAt: '2026-10-04T05:00:00.000Z' });
      if (scenario === 'conflict') await s.repo.create({ ...r, id: 'blocked-slot', kind: 'blockedTime', ownerId: ids.vetZero, payload: { startsAt: r.payload.startsAt, endsAt: r.payload.endsAt } });
      const current = await s.repo.findById('consultation', r.id);
      await assert.rejects(s.service.act(ids.vetZero, 'vet', cmd(current, 'accept')), { code: scenario === 'verification' ? 'FORBIDDEN' : 'INVALID_STATE' });
      assert.equal((await s.repo.findById('consultation', r.id)).payload.status, 'requested');
    } finally { s.db.close(); }
  }
});
test('FE10 rejection requires reason; cancellation keeps funds separate and cannot reopen terminal requests', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    await assert.rejects(s.service.act(ids.vetZero, 'vet', cmd(r, 'reject', { reason: ' ' })), { code: 'VALIDATION_FAILED' });
    const before = await s.repo.listByKind('ledgerEntry');
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'reject', { reason: 'Jadwal praktik berubah' }));
    const rejected = await s.repo.findById('consultation', r.id);
    assert.equal(rejected.payload.rejectionReason, 'Jadwal praktik berubah'); assert.equal(rejected.payload.refundStatus, 'refund_needed');
    assert.equal((await s.repo.findById('payment', ids.visitRequestPayment)).payload.status, 'succeeded');
    assert.deepEqual(await s.repo.listByKind('ledgerEntry'), before);
    await assert.rejects(s.service.act(ids.vetZero, 'vet', cmd(rejected, 'accept')), { code: 'INVALID_STATE' });
    const pending = await s.repo.findById('consultation', ids.awaitingPayment);
    await s.service.act(ids.sari, 'farmer', cmd(pending, 'cancel', { reason: 'Tidak jadi booking' }));
    assert.equal((await s.repo.findById('consultation', pending.id)).payload.refundStatus, undefined);
  } finally { s.db.close(); }
});
test('FE10 proposal preserves original reservation and decline restores requested status', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    const slot = (await s.service.slots(ids.vetZero, r.id)).slots[0];
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'propose', { ...slot, reason: 'Penyesuaian waktu praktik', id: r.id }));
    const d = await s.service.detail(ids.budi, 'farmer', r.id);
    assert.equal(d.record.payload.status, 'reschedule_pending'); assert.equal(d.record.payload.startsAt, r.payload.startsAt);
    const otherSlots = await s.service.slots(ids.vetZero, ids.visit);
    assert.equal(otherSlots.slots.some(x => x.startsAt === r.payload.startsAt), false);
    await s.service.act(ids.budi, 'farmer', cmd(d.record, 'decline', { proposalId: d.proposal.id }));
    const next = await s.service.detail(ids.budi, 'farmer', r.id);
    assert.equal(next.record.payload.status, 'requested'); assert.equal(next.proposal, null); assert.equal(next.record.payload.startsAt, r.payload.startsAt);
  } finally { s.db.close(); }
});
test('FE10 farmer approval checks new conflicts, then atomically updates time and creates visit', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    const slot = (await s.service.slots(ids.vetZero, r.id)).slots[0];
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'propose', { startsAt: slot.startsAt, endsAt: slot.endsAt, reason: 'Waktu pemeriksaan baru' }));
    const d = await s.service.detail(ids.budi, 'farmer', r.id);
    const c = cmd(d.record, 'approve', { proposalId: d.proposal.id });
    const blocked = { ...r, id: 'conflict', kind: 'blockedTime', ownerId: ids.vetZero, payload: { startsAt: slot.startsAt, endsAt: slot.endsAt } };
    await s.repo.create(blocked);
    await assert.rejects(s.service.act(ids.budi, 'farmer', c), { code: 'INVALID_STATE' });
    assert.equal((await s.service.detail(ids.budi, 'farmer', r.id)).proposal.payload.status, 'pending');
    await s.repo.update({ ...blocked, version: 2, payload: { startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T01:00:00Z' } }, 1);
    await Promise.all([s.service.act(ids.budi, 'farmer', c), s.fresh().act(ids.budi, 'farmer', c)]);
    const next = await s.service.detail(ids.budi, 'farmer', r.id);
    assert.equal(next.record.payload.startsAt, slot.startsAt); assert.equal(next.record.payload.feeSnapshot, r.payload.feeSnapshot); assert.equal(next.visit.payload.stage, 'scheduled');
  } finally { s.db.close(); }
});
test('FE10 handles legacy pending proposal, prevents modifications after departure and supersedes cancelled proposals', async () => {
  const s = await setup(); try {
    const d = await s.service.detail(ids.budi, 'farmer', ids.visit);
    await s.service.act(ids.budi, 'farmer', cmd(d.record, 'decline', { proposalId: d.proposal.id }));
    const r = await s.repo.findById('consultation', ids.visit);
    assert.equal(r.payload.status, 'scheduled');
    await change(s, 'visit', ids.visitStage, { stage: 'en_route' });
    await assert.rejects(s.service.act(ids.budi, 'farmer', cmd(r, 'cancel', { reason: 'Tidak di kandang' })), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.act(ids.vetZero, 'vet', cmd(r, 'propose', { reason: 'Jadwal berubah' })), { code: 'INVALID_STATE' });
    const request = await s.repo.findById('consultation', ids.visitRequest);
    const slot = (await s.service.slots(ids.vetZero, request.id)).slots[0];
    await s.service.act(ids.vetZero, 'vet', cmd(request, 'propose', { startsAt: slot.startsAt, endsAt: slot.endsAt, reason: 'Perubahan waktu' }));
    const p = await s.service.detail(ids.budi, 'farmer', request.id);
    await s.service.act(ids.budi, 'farmer', cmd(p.record, 'cancel', { reason: 'Layanan tidak diperlukan' }));
    assert.equal((await s.repo.findById('scheduleProposal', p.proposal.id)).payload.status, 'superseded');
  } finally { s.db.close(); }
});
test('FE10 audit failure rolls back status, proposal and visit; command can retry', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    const before = s.db.snapshot(); s.db.failKind = 'consultationAction';
    await assert.rejects(s.service.act(ids.vetZero, 'vet', cmd(r, 'accept')), /storage failure/);
    assert.deepEqual(s.db.snapshot(), before); s.db.failKind = null;
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'accept'));
    assert.deepEqual(await s.db.getAllAsync('PRAGMA foreign_key_check'), []);
  } finally { s.db.close(); }
});
test('FE10 proposal draft survives reopen, validates versions and preserves existing fixture decisions on reseed', async () => {
  const s = await setup(); try {
    const input = { reason: 'Draft alasan', startsAt: '', endsAt: '' };
    const draft = await s.service.saveDraft(ids.vetZero, ids.visitRequest, null, input);
    assert.deepEqual((await s.fresh().draft(ids.vetZero, ids.visitRequest)).payload.input, input);
    await assert.rejects(s.service.draft(ids.rani, ids.visitRequest), { code: 'FORBIDDEN' });
    const next = await s.service.saveDraft(ids.vetZero, ids.visitRequest, draft, { ...input, reason: 'Draft baru' });
    await assert.rejects(s.service.saveDraft(ids.vetZero, ids.visitRequest, draft, input), { code: 'VERSION_CONFLICT' });
    await s.service.discardDraft(ids.vetZero, ids.visitRequest, next);
    assert.equal(await s.service.draft(ids.vetZero, ids.visitRequest), null);
    const r = await s.repo.findById('consultation', ids.visitRequest);
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'reject', { reason: 'Tidak tersedia' }));
    const before = s.db.snapshot(); await seedFixturesIfEmpty(s.db); assert.deepEqual(s.db.snapshot(), before);
  } finally { s.db.close(); }
});
class SQLiteAdapter {
  database = new DatabaseSync(':memory:');
  failKind = null;
  queue = Promise.resolve();
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
      catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  snapshot() { return this.database.prepare('SELECT * FROM entities ORDER BY id').all(); }
  close() { this.database.close(); }
}

test('FE10 turning availability off keeps assigned requests actionable and pending appointments projected', async () => {
  const s = await setup(); try {
    await change(s, 'availability', ids.yudaAvailability, { acceptingNewRequests: false });
    const r = await s.repo.findById('consultation', ids.visitRequest);
    await s.service.act(ids.vetZero, 'vet', cmd(r, 'accept'));
    const d = await s.service.detail(ids.budi, 'farmer', r.id);
    const slot = (await s.service.slots(ids.vetZero, r.id)).slots.find(x => x.startsAt !== d.record.payload.startsAt);
    await s.service.act(ids.vetZero, 'vet', cmd(d.record, 'propose', { startsAt: slot.startsAt, endsAt: slot.endsAt, reason: 'Waktu alternatif' }));
    const p = await s.service.detail(ids.budi, 'farmer', r.id);
    const snapshot = selectVetDashboard({ userId: ids.vetZero, displayName: 'Yuda', verificationStatus: 'verified', acceptingNewRequests: false, consultations: [{ id: r.id, vetId: ids.vetZero, farmerId: ids.budi, animalId: ids.cow, status: p.record.payload.status, previousStatus: p.record.payload.previousStatus, startsAt: p.record.payload.startsAt, endsAt: p.record.payload.endsAt }], availableBalance: 0, pendingBalance: 0, now: now() });
    assert.equal(snapshot.upcomingAppointments[0].id, r.id);
    assert.equal(snapshot.acceptingNewRequests, false);
  } finally { s.db.close(); }
});

function visitCommand(detail, action) {
  return {
    consultationId: detail.record.id,
    consultationVersion: detail.record.version,
    visitVersion: detail.visit.version,
    operationKey: `visit:${detail.record.id}:${detail.visit.version}:${action}`,
    action,
  };
}
async function acceptVisitRequest(s) {
  const request = await s.repo.findById('consultation', ids.visitRequest);
  await s.service.act(ids.vetZero, 'vet', cmd(request, 'accept'));
  return s.service.detail(ids.vetZero, 'vet', request.id);
}

test('FE13 visit progresses in order; farmer sees the same timestamps and audit history', async () => {
  const s = await setup(); try {
    let detail = await acceptVisitRequest(s);
    assert.equal(detail.visit.payload.stage, 'scheduled');
    await change(s, 'address', ids.budiAddress, { address: 'Alamat peternak yang diperbarui sesudah booking' });
    detail = await s.service.detail(ids.vetZero, 'vet', ids.visitRequest);
    assert.equal(detail.record.payload.visitAddressSnapshot, 'Kandang Budi, Bogor');
    const first = visitCommand(detail, 'depart');
    await Promise.all([s.service.advanceVisit(ids.vetZero, 'vet', first), s.fresh().advanceVisit(ids.vetZero, 'vet', first)]);
    detail = await s.service.detail(ids.budi, 'farmer', ids.visitRequest);
    assert.equal(detail.record.payload.status, 'in_progress');
    assert.equal(detail.visit.payload.stage, 'en_route');
    assert.equal(detail.visit.payload.departureAt, now().toISOString());
    assert.equal(detail.history.length, 2);
    assert.equal(detail.history[1].payload.action, 'depart');
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', visitCommand(detail, 'start_examination')), { code: 'INVALID_STATE' });

    detail = await s.service.detail(ids.vetZero, 'vet', ids.visitRequest);
    await s.service.advanceVisit(ids.vetZero, 'vet', visitCommand(detail, 'arrive'));
    detail = await s.service.detail(ids.budi, 'farmer', ids.visitRequest);
    assert.equal(detail.visit.payload.stage, 'arrived');
    assert.equal(detail.visit.payload.arrivalAt, now().toISOString());
    detail = await s.service.detail(ids.vetZero, 'vet', ids.visitRequest);
    await s.service.advanceVisit(ids.vetZero, 'vet', visitCommand(detail, 'start_examination'));
    detail = await s.fresh().detail(ids.budi, 'farmer', ids.visitRequest);
    assert.equal(detail.visit.payload.stage, 'examining');
    assert.equal(detail.visit.payload.examinationStartedAt, now().toISOString());
    assert.equal(detail.record.payload.status, 'in_progress');
    assert.equal(detail.history.length, 4);
  } finally { s.db.close(); }
});

test('FE13 visit actions enforce assignment, verification, payment and a saved address snapshot', async () => {
  const s = await setup(); try {
    const detail = await acceptVisitRequest(s);
    const command = visitCommand(detail, 'depart');
    await assert.rejects(s.service.advanceVisit(ids.budi, 'farmer', command), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.advanceVisit(ids.rani, 'vet', command), { code: 'FORBIDDEN' });
    await change(s, 'vetProfile', ids.yudaProfile, { verificationStatus: 'pending' });
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', command), { code: 'FORBIDDEN' });
    assert.equal((await s.repo.findById('visit', detail.visit.id)).payload.stage, 'scheduled');
  } finally { s.db.close(); }
  for (const scenario of ['payment', 'address']) {
    const s = await setup(); try {
      const detail = await acceptVisitRequest(s);
      if (scenario === 'payment') await change(s, 'payment', ids.visitRequestPayment, { status: 'pending' });
      else await change(s, 'consultation', ids.visitRequest, { visitAddressSnapshot: '' });
      await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', visitCommand(detail, 'depart')), { code: 'INVALID_STATE' });
      assert.equal((await s.repo.listByRelated('visit', ids.visitRequest, 'consultation'))[0].payload.stage, 'scheduled');
    } finally { s.db.close(); }
  }
});

test('FE13 cannot depart while the farmer has an unanswered schedule proposal', async () => {
  const s = await setup(); try {
    const detail = await s.service.detail(ids.vetZero, 'vet', ids.visit);
    assert.ok(detail.proposal?.payload.status === 'pending');
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', visitCommand(detail, 'depart')), { code: 'INVALID_STATE' });
    assert.equal((await s.repo.findById('visit', ids.visitStage)).payload.stage, 'scheduled');
    assert.equal((await s.repo.findById('consultation', ids.visit)).payload.status, 'scheduled');
  } finally { s.db.close(); }
});

test('FE13 visit stage write and consultation audit roll back together and can retry', async () => {
  const s = await setup(); try {
    const detail = await acceptVisitRequest(s);
    const command = visitCommand(detail, 'depart');
    const before = s.db.snapshot();
    s.db.failKind = 'consultationAction';
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', command), /storage failure/);
    assert.deepEqual(s.db.snapshot(), before);
    s.db.failKind = null;
    await s.service.advanceVisit(ids.vetZero, 'vet', command);
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', { ...command, action: 'arrive' }), { code: 'IDEMPOTENCY_CONFLICT' });
    const updated = await s.service.detail(ids.budi, 'farmer', ids.visitRequest);
    assert.equal(updated.visit.payload.stage, 'en_route');
    assert.equal(updated.history.filter(item => item.payload.operationKey === command.operationKey).length, 1);
  } finally { s.db.close(); }
});

test('FE13 visit action rejects stale appointment or visit versions', async () => {
  const s = await setup(); try {
    const detail = await acceptVisitRequest(s);
    const stale = visitCommand(detail, 'depart');
    await change(s, 'visit', detail.visit.id, { notes: 'Perubahan serentak' });
    await assert.rejects(s.service.advanceVisit(ids.vetZero, 'vet', stale), { code: 'VERSION_CONFLICT' });
    assert.equal((await s.repo.findById('consultation', ids.visitRequest)).payload.status, 'scheduled');
  } finally { s.db.close(); }
});
test('FE10 media requires submitted booking context and cannot leak foreign or unsafe files', async () => {
  const s = await setup(); try {
    const r = await s.repo.findById('consultation', ids.visitRequest);
    const draft = { ...r, id: 'booking-media', kind: 'bookingDraft', contextId: ids.vetZero, payload: { status: 'submitted', consultationId: r.id } };
    await s.repo.create(draft);
    const media = { ...r, kind: 'attachment', contextId: draft.id, payload: { kind: 'image', filename: 'foto.jpg', mimeType: 'image/jpeg', localUri: 'file:///stored/foto.jpg', uploadStatus: 'local' } };
    await s.repo.create({ ...media, id: 'own-photo' });
    await s.repo.create({ ...media, id: 'foreign-photo', ownerId: ids.sari });
    await s.repo.create({ ...media, id: 'unsafe-photo', payload: { ...media.payload, localUri: 'https://example.test/foto.jpg' } });
    await s.repo.update({ ...r, version: 2, payload: { ...r.payload, attachmentIds: ['own-photo', 'foreign-photo', 'unsafe-photo'] } }, 1, [{ sourceId: r.id, targetId: ids.budi, relationship: 'farmer' }, { sourceId: r.id, targetId: ids.vetZero, relationship: 'veterinarian' }, { sourceId: r.id, targetId: ids.cow, relationship: 'animal' }, { sourceId: r.id, targetId: ids.budiFarm, relationship: 'farm' }, ...['own-photo', 'foreign-photo', 'unsafe-photo'].map(targetId => ({ sourceId: r.id, targetId, relationship: 'attachment' }))]);
    assert.deepEqual((await s.service.detail(ids.vetZero, 'vet', r.id)).attachments.map(x => x.id), ['own-photo']);
    await change(s, 'attachment', 'own-photo', { uploadStatus: 'removed' });
    assert.deepEqual((await s.service.detail(ids.budi, 'farmer', r.id)).attachments, []);
  } finally { s.db.close(); }
});
test('FE10 fixture extension failure rolls back both records and marker before retry', async () => {
  const s = await setup(); try {
    s.db.database.exec("DELETE FROM entity_relations WHERE source_id IN ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000043'); DELETE FROM entities WHERE id IN ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000043'); DELETE FROM app_metadata WHERE key = 'fixture_consultations_version';");
    const before = s.db.snapshot(); s.db.failKind = 'payment';
    await assert.rejects(seedFixturesIfEmpty(s.db), /storage failure/);
    assert.deepEqual(s.db.snapshot(), before);
    assert.equal(await s.db.getFirstAsync("SELECT value FROM app_metadata WHERE key='fixture_consultations_version'"), null);
    s.db.failKind = null; await seedFixturesIfEmpty(s.db);
    assert.equal((await s.repo.findById('consultation', ids.visitRequest)).payload.status, 'requested');
  } finally { s.db.close(); }
});
