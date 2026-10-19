import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BookingService } from '../.test-build/src/application/BookingService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { VetDirectoryService } from '../.test-build/src/application/VetDirectoryService.js';
import { ProfileService } from '../.test-build/src/application/ProfileService.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { FarmService } from '../.test-build/src/application/FarmService.js';
import { LivestockService } from '../.test-build/src/application/LivestockService.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';
import { listVetPatientAssignments } from '../.test-build/src/application/vetPatientAccess.js';
const now = () => new Date('2026-10-05T00:00:00Z');

test('booking draft persists incomplete input, survives a new service and remains private', async () => {
  const s = await setup();
  try {
    const { draft } = await s.service.open(ids.budi, ids.rani);
    const saved = await s.service.save(ids.budi, draft, { ...draft.input, complaint: 'Draft belum lengkap', selectedDay: '2026-10-06' });
    const reopened = await s.newService().open(ids.budi, ids.rani);
    assert.equal(reopened.draft.id, saved.id);
    assert.equal(reopened.draft.input.complaint, 'Draft belum lengkap');
    assert.equal(reopened.draft.input.selectedDay, '2026-10-06');
    await assert.rejects(s.service.save(ids.sari, saved, saved.input), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.review(ids.budi, saved), { code: 'VALIDATION_FAILED' });
    await assert.rejects(s.service.save(ids.budi, draft, draft.input), { code: 'VERSION_CONFLICT' });
  } finally { s.db.close(); }
});

test('booking validates ownership, required visit address, service and real future slots', async () => {
  const s = await setup();
  try {
    const draft = await validDraft(s, ids.budi, ids.vetZero);
    const noAddress = await s.service.save(ids.budi, draft, { ...draft.input, visitAddress: '' });
    await assert.rejects(s.service.review(ids.budi, noAddress), { code: 'VALIDATION_FAILED' });
    const foreign = await s.service.save(ids.budi, noAddress, { ...draft.input, animalId: ids.goat });
    await assert.rejects(s.service.review(ids.budi, foreign), { code: 'FORBIDDEN' });
    const invalidSlot = await s.service.save(ids.budi, foreign, { ...draft.input, startsAt: '2026-10-05T01:00:00.000Z', endsAt: '2026-10-05T02:00:00.000Z' });
    await assert.rejects(s.service.review(ids.budi, invalidSlot), { code: 'INVALID_STATE' });
    const unavailable = await s.service.open(ids.budi, ids.damar);
    const unverified = await s.service.save(ids.budi, unavailable.draft, { ...draft.input });
    await assert.rejects(s.service.review(ids.budi, unverified), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('visit booking follows the selected animal farm and rejects mismatched farm or address', async () => {
  const s = await setup();
  try {
    let farmSequence = 0;
    const profiles = new SqliteProfileRepository(s.db);
    const repository = new SqliteDomainRepository(s.db);
    const farm = await new FarmService(repository, profiles, { create: () => `booking-farm-${++farmSequence}` }, now).create(ids.budi, {
      name: 'Peternakan Budi Selatan', species: ['cattle'], location: 'Ciawi, Bogor',
      addressLabel: 'Kandang Selatan', recipient: 'Budi Santoso', phone: '081234567890',
      address: 'Jalan Lembah Fiktif Nomor 4', city: 'Bogor', province: 'Jawa Barat', postalCode: '16720',
    });
    const animal = await new LivestockService(repository, profiles, s.media, { create: () => 'booking-farm-animal' }, now)
      .create(ids.budi, farm.id, { displayCode: 'BUD-01', name: 'Teratai', species: 'cattle', breed: 'Sapi fiktif', sex: 'female', estimatedAgeMonths: 20, weightKg: 240 });

    const { draft, animals } = await s.service.open(ids.budi, ids.vetZero);
    assert.ok(animals.some((item) => item.id === animal.id));
    const originalAnimal = animals.find((item) => item.id === ids.cow);
    assert.ok(originalAnimal);
    const slot = (await s.directory.slots(ids.vetZero, 'visit')).slots[0];
    const mismatched = await s.service.save(ids.budi, draft, {
      ...draft.input, service: 'visit', animalId: animal.id, farmId: ids.budiFarm,
      startsAt: slot.startsAt, endsAt: slot.endsAt, complaint: 'Pemeriksaan di peternakan terpilih.',
      visitAddress: originalAnimal.farmVisitAddress,
    });
    await assert.rejects(s.service.review(ids.budi, mismatched), { code: 'FORBIDDEN' });

    const selected = await s.service.save(ids.budi, mismatched, { ...mismatched.input, farmId: farm.id, visitAddress: animal.farmVisitAddress });
    const review = await s.service.review(ids.budi, selected);
    assert.equal(review.farmName, farm.name);
    assert.equal(review.input.farmId, farm.id);
    assert.equal(review.input.visitAddress, farm.visitAddress);
    const consultationId = await s.service.submit(ids.budi, review);
    const consultation = await s.storage.read.repository.findById('consultation', consultationId);
    assert.equal(consultation.payload.farmId, farm.id);
    assert.equal(consultation.payload.visitAddressSnapshot, farm.visitAddress);
    assert.equal((await s.storage.read.repository.listRelated('consultation', consultationId, 'farm'))[0].id, farm.id);
  } finally { s.db.close(); }
});

test('submit atomically saves quote and pending consultation; retries across instances return one booking', async () => {
  const s = await setup();
  try {
    const draft = await validDraft(s);
    const review = await s.service.review(ids.budi, draft);
    const [first, second] = await Promise.all([s.service.submit(ids.budi, review), s.newService().submit(ids.budi, review)]);
    assert.equal(first, second);
    const consultation = await s.storage.read.repository.findById('consultation', first);
    assert.equal(consultation.payload.status, 'awaiting_payment');
    assert.equal(consultation.payload.paymentId, null);
    assert.equal((await listVetPatientAssignments(s.storage.read.repository, ids.rani)).some((item) => item.consultation.id === first), false);
    assert.equal((await s.storage.read.repository.listByKind('message')).filter((item) => item.contextId === first).length, 0);
    assert.equal((await s.storage.read.repository.listByKind('payment')).filter((item) => item.payload.payableId === first).length, 0);
    assert.equal(consultation.payload.feeSnapshot, 75000);
    assert.equal(consultation.payload.commissionSnapshot, 7500);
    const quote = await s.storage.read.repository.findById('quote', consultation.payload.quoteId);
    assert.equal(quote.payload.totalAmount, 75000);
    assert.equal((await s.storage.read.repository.listByKind('consultation')).filter((item) => item.payload.operationKey === `booking:${draft.id}`).length, 1);
    assert.equal((await s.directory.slots(ids.rani, 'chat')).slots.some((slot) => slot.startsAt === draft.input.startsAt), false);
    await assert.rejects(s.service.save(ids.budi, draft, draft.input), { code: 'INVALID_STATE' });
    assert.deepEqual(await s.db.getAllAsync('PRAGMA foreign_key_check'), []);
  } finally { s.db.close(); }
});

test('two farmers competing for a slot create only one reservation', async () => {
  const s = await setup();
  try {
    const a = await validDraft(s, ids.budi);
    const b = await validDraft(s, ids.sari);
    assert.equal(a.input.startsAt, b.input.startsAt);
    const ra = await s.service.review(ids.budi, a);
    const rb = await s.service.review(ids.sari, b);
    const result = await Promise.allSettled([s.service.submit(ids.budi, ra), s.newService().submit(ids.sari, rb)]);
    assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(result.find((item) => item.status === 'rejected').reason.code, 'INVALID_STATE');
  } finally { s.db.close(); }
});

test('submit revalidates changed tariff, availability, ownership and stale draft', async () => {
  const s = await setup();
  try {
    const draft = await validDraft(s);
    const review = await s.service.review(ids.budi, draft);
    const repo = s.storage.read.repository;
    const rate = (await repo.listByOwner('serviceRate', ids.rani))[0];
    await repo.update({ ...rate, version: rate.version + 1, payload: { ...rate.payload, amount: 80000 } }, rate.version);
    await assert.rejects(s.service.submit(ids.budi, review), { code: 'VERSION_CONFLICT' });
    const refreshed = await s.service.review(ids.budi, draft);
    assert.equal(refreshed.total, 80000);
    const availability = (await repo.listByOwner('availability', ids.rani))[0];
    await repo.update({ ...availability, version: availability.version + 1, payload: { ...availability.payload, acceptingNewRequests: false } }, availability.version);
    await assert.rejects(s.service.submit(ids.budi, refreshed), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.submit(ids.sari, refreshed), { code: 'FORBIDDEN' });
    const updated = await s.service.save(ids.budi, draft, { ...draft.input, complaint: 'Keluhan berubah sesudah review' });
    assert.equal(updated.version, draft.version + 1);
    await assert.rejects(s.service.submit(ids.budi, refreshed), { code: 'VERSION_CONFLICT' });
  } finally { s.db.close(); }
});

test('failure rolls back consultation, quote and draft; the same review can retry', async () => {
  const s = await setup();
  try {
    const draft = await validDraft(s);
    const review = await s.service.review(ids.budi, draft);
    const before = s.db.snapshot();
    s.db.failKind = 'quote';
    await assert.rejects(s.service.submit(ids.budi, review), /storage failure/);
    assert.deepEqual(s.db.snapshot(), before);
    s.db.failKind = null;
    await s.service.submit(ids.budi, review);
    assert.equal((await s.db.getFirstAsync('PRAGMA integrity_check')).integrity_check, 'ok');
  } finally { s.db.close(); }
});

test('selected media are copied persistently, scoped to draft and cleaned after rollback/discard', async () => {
  const s = await setup();
  try {
    const { draft } = await s.service.open(ids.budi, ids.rani);
    s.media.selected = [{ uri: 'file:///picked.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 100, kind: 'image' }, { uri: 'file:///picked.mp4', filename: 'video.mp4', mimeType: 'video/mp4', byteSize: 200, kind: 'video' }];
    const saved = await s.service.pickMedia(ids.budi, draft, draft.input);
    const loaded = await s.newService().open(ids.budi, ids.rani);
    assert.equal(loaded.attachments.length, 2);
    assert.equal(loaded.attachments[1].kind, 'video');
    assert.ok(loaded.attachments.every((item) => item.localUri.startsWith('file:///stored/')));
    const other = await s.service.open(ids.sari, ids.rani);
    await assert.rejects(s.service.save(ids.sari, other.draft, { ...other.draft.input, attachmentIds: saved.input.attachmentIds }), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.pickMedia(ids.budi, draft, draft.input), { code: 'VERSION_CONFLICT' });
    assert.equal(s.media.removed.length, 2);
    await s.service.discard(ids.budi, saved);
    assert.equal(s.media.removed.length, 4);
    await assert.rejects(s.service.attachments(ids.budi, saved.id), { code: 'FORBIDDEN' });
    assert.notEqual((await s.service.open(ids.budi, ids.rani)).draft.id, saved.id);
  } finally { s.db.close(); }
});

test('final write rejects a doctor losing verification or an animal changing owner after review', async () => {
  const s = await setup();
  try {
    const draft = await validDraft(s);
    const review = await s.service.review(ids.budi, draft);
    const repo = s.storage.read.repository;
    const profile = (await repo.listByOwner('vetProfile', ids.rani))[0];
    await repo.update({ ...profile, version: profile.version + 1, payload: { ...profile.payload, verificationStatus: 'pending' } }, profile.version);
    await assert.rejects(s.service.submit(ids.budi, review), { code: 'FORBIDDEN' });
    await repo.update({ ...profile, version: profile.version + 2 }, profile.version + 1);
    const animal = await repo.findById('livestock', draft.input.animalId);
    await repo.update({ ...animal, version: animal.version + 1, ownerId: ids.sari }, animal.version);
    await assert.rejects(s.service.submit(ids.budi, review), { code: 'FORBIDDEN' });
    assert.equal((await repo.listByKind('consultation')).some((item) => item.payload.operationKey === `booking:${draft.id}`), false);
  } finally { s.db.close(); }
});

test('invalid media rollback removes copied files, and a saved removal revokes metadata', async () => {
  const s = await setup();
  try {
    const { draft } = await s.service.open(ids.budi, ids.rani);
    const photo = { uri: 'file:///photo.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 100, kind: 'image' };
    s.media.selected = [photo, { ...photo, mimeType: 'application/pdf' }];
    const before = s.db.snapshot();
    await assert.rejects(s.service.pickMedia(ids.budi, draft, draft.input), { code: 'VALIDATION_FAILED' });
    assert.deepEqual(s.db.snapshot(), before);
    assert.equal(s.media.removed.length, 1);
    s.media.selected = [photo];
    const withPhoto = await s.service.pickMedia(ids.budi, draft, draft.input);
    const replaced = await s.service.pickMedia(ids.budi, withPhoto, { ...withPhoto.input, attachmentIds: [] });
    assert.equal((await s.storage.read.repository.findById('attachment', withPhoto.input.attachmentIds[0])).payload.uploadStatus, 'removed');
    const removed = await s.service.save(ids.budi, replaced, { ...replaced.input, attachmentIds: [] });
    assert.deepEqual(await s.service.attachments(ids.budi, removed.id), []);
    await assert.rejects(s.service.save(ids.budi, removed, withPhoto.input), { code: 'FORBIDDEN' });
    assert.equal((await s.storage.read.repository.findById('attachment', withPhoto.input.attachmentIds[0])).payload.uploadStatus, 'removed');
    assert.equal(s.media.removed.length, 3);
  } finally { s.db.close(); }
});

async function validDraft(s, userId = ids.budi, vetId = ids.rani) {
  const { draft, animals } = await s.service.open(userId, vetId);
  const service = vetId === ids.vetZero ? 'visit' : 'chat';
  const slot = (await s.directory.slots(vetId, service)).slots[0];
  assert.ok(slot);
  const animal = animals[0];
  return s.service.save(userId, draft, { ...draft.input, service, animalId: animal.id, farmId: animal.farmId, startsAt: slot.startsAt, endsAt: slot.endsAt, complaint: 'Nafsu makan ternak berkurang sejak kemarin.', visitAddress: service === 'visit' ? animal.farmVisitAddress : '' });
}
async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db); await seedFixturesIfEmpty(db);
  const storage = new SqliteBookingRepository(db);
  let sequence = 0;
  const idFactory = { create: () => `booking-test-${++sequence}` };
  const media = { selected: [], removed: [], async pickBookingMedia() { return this.selected; }, async pickPhoto() { return null; }, async pickDocuments() { return []; }, async store(asset, id) { return { localUri: `file:///stored/${id}`, filename: asset.filename, mimeType: asset.mimeType, byteSize: asset.byteSize }; }, async remove(uri) { this.removed.push(uri); } };
  const newService = () => new BookingService(new SqliteBookingRepository(db), media, idFactory, now);
  const profiles = new ProfileService(storage.read.profiles, media, idFactory, now);
  return { db, storage, media, newService, service: newService(), directory: new VetDirectoryService(storage.read.repository, profiles, now) };
}
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
