import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ChatService } from '../.test-build/src/application/ChatService.js';
import { SqliteBookingRepository } from '../.test-build/src/data/local/sqlite/SqliteBookingRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';
import { validateChatInput } from '../.test-build/src/domain/chat.js';

const start = Date.parse('2026-10-05T00:00:00Z');
async function setup(deliver = async () => 'sent') {
  const db = new SQLiteAdapter(); await migrateDatabase(db); await seedFixturesIfEmpty(db);
  let sequence = 0;
  let clock = start;
  const copied = new Map(); const removed = [];
  const media = {
    async pickPhoto() { return null; }, async pickDocuments() { return []; }, async pickBookingMedia() { return []; },
    async store(asset, attachmentId) { const file = `file:///private/${attachmentId}.${asset.kind === 'video' ? 'mp4' : 'jpg'}`; copied.set(file, asset); return { localUri: file, filename: asset.filename, mimeType: asset.mimeType, byteSize: asset.byteSize ?? 1234 }; },
    async remove(uri) { removed.push(uri); copied.delete(uri); },
  };
  const factory = { create: () => `chat-test-${String(++sequence).padStart(4, '0')}` };
  const storage = new SqliteBookingRepository(db);
  const fresh = (adapter = deliver) => new ChatService(new SqliteBookingRepository(db), media, factory, { deliver: adapter }, () => new Date(clock));
  return { db, repo: storage.read.repository, service: fresh(), fresh, copied, removed, advance(ms) { clock += ms; }, now() { return clock; } };
}

test('chat is scoped to paid, accepted chat consultations and only assigned participants can read it', async () => {
  const s = await setup(); try {
    const farmer = await s.service.conversation(ids.sari, 'farmer', ids.chat);
    const vet = await s.service.conversation(ids.rani, 'vet', ids.chat);
    assert.equal(farmer.otherPartyName, 'drh. Rani Putri');
    assert.equal(farmer.animalName, 'Luna');
    assert.equal(farmer.messages.length, 1);
    assert.equal(farmer.messages[0].record.payload.senderId, ids.sari);
    assert.equal(vet.messages[0].record.id, farmer.messages[0].record.id);
    const activeFarmer = await s.service.conversation(ids.budi, 'farmer', ids.chatFlow);
    const activeVet = await s.service.conversation(ids.vetZero, 'vet', ids.chatFlow);
    assert.equal(activeFarmer.otherPartyName, 'drh. Yuda Pratama');
    assert.equal(activeFarmer.messages.length, 1);
    assert.equal(activeVet.messages[0].record.id, activeFarmer.messages[0].record.id);
    await assert.rejects(s.service.conversation(ids.budi, 'farmer', ids.chat), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.conversation(ids.vetZero, 'vet', ids.chat), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.conversation(ids.budi, 'farmer', ids.request), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.conversation(ids.sari, 'farmer', ids.awaitingPayment), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.conversation(ids.vetZero, 'vet', ids.visit), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('farmer and assigned vet share local messages; clientMessageId makes concurrent sends idempotent', async () => {
  let deliveryCount = 0;
  const s = await setup(async () => { deliveryCount++; return 'sent'; }); try {
    const input = { clientMessageId: 'same-client-id', text: '  Kondisi tetap sama.  ', assets: [] };
    const [first, duplicate] = await Promise.all([
      s.service.send(ids.sari, 'farmer', ids.chat, input),
      s.fresh(async () => { deliveryCount++; return 'sent'; }).send(ids.sari, 'farmer', ids.chat, input),
    ]);
    const messages = await s.repo.listByRelated('message', ids.chat, 'consultation');
    assert.equal(messages.filter((item) => item.payload.clientMessageId === 'same-client-id').length, 1);
    assert.equal(deliveryCount, 1);
    assert.equal(first.messages.find((item) => item.record.payload.clientMessageId === 'same-client-id').record.payload.text, 'Kondisi tetap sama.');
    assert.equal(duplicate.messages.filter((item) => item.record.payload.clientMessageId === 'same-client-id').length, 1);
    assert.ok((await s.service.conversation(ids.rani, 'vet', ids.chat)).messages.some((item) => item.record.payload.clientMessageId === 'same-client-id'));
    await assert.rejects(s.service.send(ids.sari, 'farmer', ids.chat, { ...input, text: 'Isi berbeda' }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal((await s.repo.listByRelated('message', ids.chat, 'consultation')).length, 2);
  } finally { s.db.close(); }
});

test('image and video attachments are stored privately, scoped to a message, and re-authorized when opened', async () => {
  const s = await setup(); try {
    const assets = [
      { uri: 'file:///picker/foto.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 2000, kind: 'image' },
      { uri: 'content://picker/video', filename: 'video.mp4', mimeType: 'video/mp4', byteSize: 4000, kind: 'video' },
    ];
    const result = await s.service.send(ids.sari, 'farmer', ids.chat, { clientMessageId: 'media-message', text: '', assets });
    const message = result.messages.find((item) => item.record.payload.clientMessageId === 'media-message');
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(message.attachments.map((file) => file.kind), ['image', 'video']);
    assert.ok(message.attachments.every((file) => file.localUri.startsWith('file:///private/')));
    assert.equal((await s.service.attachment(ids.rani, 'vet', ids.chat, message.record.id, message.attachments[0].id)).mimeType, 'image/jpeg');
    await assert.rejects(s.service.attachment(ids.budi, 'farmer', ids.chat, message.record.id, message.attachments[0].id), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.attachment(ids.sari, 'farmer', ids.chat, message.record.id, 'unrelated-file'), { code: 'FORBIDDEN' });
    const attachment = await s.repo.findById('attachment', message.attachments[0].id);
    await s.repo.update({ ...attachment, version: attachment.version + 1, payload: { ...attachment.payload, localUri: 'https://example.test/leak.jpg' } }, attachment.version);
    assert.equal((await s.service.conversation(ids.rani, 'vet', ids.chat)).messages.find((item) => item.record.id === message.record.id).attachments.length, 1);
    await assert.rejects(s.service.attachment(ids.rani, 'vet', ids.chat, message.record.id, attachment.id), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('failed delivery retries the existing message and preserves its client ID without double send', async () => {
  let calls = 0; let outcome = 'failed';
  const adapter = async () => { calls++; return outcome; };
  const s = await setup(adapter); try {
    const input = { clientMessageId: 'retry-client-id', text: 'Saya kirim foto menyusul.', assets: [] };
    const sent = await s.service.send(ids.sari, 'farmer', ids.chat, input);
    const failed = sent.messages.find((item) => item.record.payload.clientMessageId === input.clientMessageId);
    assert.equal(failed.record.payload.deliveryStatus, 'failed');
    outcome = 'sent';
    const [retryA, retryB] = await Promise.all([
      s.service.retry(ids.sari, 'farmer', ids.chat, failed.record.id),
      s.service.retry(ids.sari, 'farmer', ids.chat, failed.record.id),
    ]);
    assert.equal(calls, 2);
    assert.equal(retryA.messages.find((item) => item.record.id === failed.record.id).record.payload.deliveryStatus, 'sent');
    assert.equal(retryB.messages.find((item) => item.record.id === failed.record.id).record.payload.clientMessageId, input.clientMessageId);
    assert.equal((await s.repo.listByRelated('message', ids.chat, 'consultation')).filter((item) => item.payload.clientMessageId === input.clientMessageId).length, 1);
  } finally { s.db.close(); }
});

test('a veterinarian whose verification is pending cannot write chat, while farmer remains a participant', async () => {
  const s = await setup(); try {
    const profile = await s.repo.findById('vetProfile', ids.raniProfile);
    await s.repo.update({ ...profile, version: profile.version + 1, payload: { ...profile.payload, verificationStatus: 'pending' } }, profile.version);
    await assert.rejects(s.service.send(ids.rani, 'vet', ids.chat, { clientMessageId: 'unverified-vet', text: 'Pesan dokter', assets: [] }), { code: 'FORBIDDEN' });
    const sent = await s.service.send(ids.sari, 'farmer', ids.chat, { clientMessageId: 'farmer-still-allowed', text: 'Kondisinya stabil.', assets: [] });
    assert.ok(sent.messages.some((item) => item.record.payload.clientMessageId === 'farmer-still-allowed'));
    assert.equal((await s.service.conversation(ids.rani, 'vet', ids.chat)).readOnly, true);
  } finally { s.db.close(); }
});

test('stale pending messages can retry; recent pending messages cannot claim delivery twice', async () => {
  let calls = 0;
  const s = await setup(async () => { calls++; return calls === 1 ? 'pending' : 'sent'; }); try {
    const sent = await s.service.send(ids.sari, 'farmer', ids.chat, { clientMessageId: 'pending-client-id', text: 'Pesan lokal.', assets: [] });
    const pending = sent.messages.find((item) => item.record.payload.clientMessageId === 'pending-client-id');
    assert.equal(pending.record.payload.deliveryStatus, 'pending');
    await s.service.retry(ids.sari, 'farmer', ids.chat, pending.record.id);
    assert.equal(calls, 1);
    s.advance(31_000);
    const recovered = await s.service.retry(ids.sari, 'farmer', ids.chat, pending.record.id);
    const message = recovered.messages.find((item) => item.record.id === pending.record.id);
    assert.equal(message.record.payload.deliveryStatus, 'sent');
    assert.equal(message.record.payload.deliveryAttempt, 2);
    assert.equal(calls, 2);
  } finally { s.db.close(); }
});

test('send rechecks payment and status inside the transaction and rolls back copied media on failure', async () => {
  const s = await setup(); try {
    const payment = await s.repo.findById('payment', ids.chatPaymentSucceeded);
    await s.repo.update({ ...payment, version: payment.version + 1, payload: { ...payment.payload, status: 'pending' } }, payment.version);
    await assert.rejects(s.service.send(ids.sari, 'farmer', ids.chat, { clientMessageId: 'unpaid', text: 'Tidak boleh terkirim.', assets: [] }), { code: 'INVALID_STATE' });
  } finally { s.db.close(); }

  const retry = await setup(); try {
    const before = retry.db.snapshot(); retry.db.failKind = 'message';
    await assert.rejects(retry.service.send(ids.sari, 'farmer', ids.chat, { clientMessageId: 'rollback', text: '', assets: [{ uri: 'file:///picker/foto.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 20, kind: 'image' }] }), /storage failure/);
    retry.db.failKind = null;
    assert.deepEqual(retry.db.snapshot(), before);
    assert.equal(retry.copied.size, 0);
    assert.equal(retry.removed.length, 1);
  } finally { retry.db.close(); }
});

test('chat validation requires content and bounds text, idempotency key, and local photo/video assets', () => {
  assert.throws(() => validateChatInput({ clientMessageId: 'empty', text: ' ', assets: [] }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateChatInput({ clientMessageId: 'long', text: 'x'.repeat(4001), assets: [] }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateChatInput({ clientMessageId: '', text: 'Pesan', assets: [] }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateChatInput({ clientMessageId: 'remote', text: '', assets: [{ uri: 'https://example.test/foto.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 20, kind: 'image' }] }), { code: 'VALIDATION_FAILED' });
  assert.throws(() => validateChatInput({ clientMessageId: 'too-many', text: 'Pesan', assets: Array(6).fill({ uri: 'file:///foto.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 20, kind: 'image' }) }), { code: 'VALIDATION_FAILED' });
});

test('FE12 local chat fixture extends existing installs once and rolls back cleanly on failure', async () => {
  const s = await setup(); try {
    const fixtureIds = [ids.chatFlow, ids.chatFlowPayment, ids.chatFlowMessage];
    const placeholders = fixtureIds.map(() => '?').join(',');
    s.db.database.prepare(`DELETE FROM entity_relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`).run(...fixtureIds, ...fixtureIds);
    s.db.database.prepare(`DELETE FROM entities WHERE id IN (${placeholders})`).run(...fixtureIds);
    s.db.database.prepare("DELETE FROM app_metadata WHERE key = 'fixture_chat_version'").run();
    const before = s.db.snapshot(); s.db.failKind = 'payment';
    await assert.rejects(seedFixturesIfEmpty(s.db), /storage failure/);
    assert.deepEqual(s.db.snapshot(), before);
    assert.equal(await s.db.getFirstAsync("SELECT value FROM app_metadata WHERE key='fixture_chat_version'"), null);
    s.db.failKind = null;
    await seedFixturesIfEmpty(s.db);
    assert.equal((await s.repo.findById('consultation', ids.chatFlow)).payload.status, 'in_progress');
    const stable = s.db.snapshot(); await seedFixturesIfEmpty(s.db); assert.deepEqual(s.db.snapshot(), stable);
    assert.equal((await s.service.conversation(ids.budi, 'farmer', ids.chatFlow)).messages.length, 1);
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  constructor() { this.database = new DatabaseSync(':memory:'); this.database.exec('PRAGMA foreign_keys=ON'); this.failKind = null; this.queue = Promise.resolve(); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) { if (sql.includes('INSERT INTO entities') && bindings[1] === this.failKind) throw new Error('storage failure'); return this.database.prepare(sql).run(...bindings); }
  async withExclusiveTransactionAsync(action) { const task = this.queue.then(async () => { this.database.exec('BEGIN IMMEDIATE'); try { await action(this); this.database.exec('COMMIT'); } catch (error) { this.database.exec('ROLLBACK'); throw error; } }); this.queue = task.catch(() => {}); return task; }
  snapshot() { return this.database.prepare('SELECT * FROM entities ORDER BY id').all(); }
  close() { this.database.close(); }
}
