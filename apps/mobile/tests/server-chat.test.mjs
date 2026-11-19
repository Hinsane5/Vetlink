import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerChatService } from '../.test-build/src/application/ServerChatService.js';

const farmerId = '10000000-0000-4000-8000-000000000001';
const vetId = '10000000-0000-4000-8000-000000000002';
const consultation = {
  id: '10000000-0000-4000-8000-000000000003', farmerId, vetId,
  serviceType: 'chat', status: 'in_progress', paymentStatus: 'succeeded',
};
const uuid = '10000000-0000-4000-8000-000000000004';
const attachmentId = '10000000-0000-4000-8000-000000000006';
const uploadKey = '10000000-0000-4000-8000-000000000007';
const message = (overrides = {}) => ({
  id: '10000000-0000-4000-8000-000000000005', clientMessageId: uuid, senderId: farmerId,
  text: 'Perlu jadwalkan kontrol.', attachments: [], deliveryStatus: 'sent', deliveryAttempt: 1,
  createdAt: '2026-11-19T00:00:00.000Z', sentAt: '2026-11-19T00:00:01.000Z', ...overrides,
});
function stateStore() {
  let pending = null;
  let draft = null;
  return {
    store: {
      readPending: async () => pending,
      writePending: async (_user, _consultation, value) => { pending = value; },
      clearPending: async () => { pending = null; },
      readDraft: async () => draft,
      writeDraft: async (_user, _consultation, value) => { draft = value; },
      clearDraft: async () => { draft = null; },
    },
    pending: () => pending,
    draft: () => draft,
  };
}

test('server chat requires the assigned participant and a paid in-progress chat', async () => {
  let reads = 0;
  const service = new ServerChatService({ list: async () => { reads += 1; return { items: [], nextCursor: null, hasMore: false }; } }, stateStore().store, () => uuid);
  await assert.rejects(service.list('farmer', vetId, consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.list('vet', vetId, { ...consultation, paymentStatus: 'pending' }), { code: 'INVALID_STATE' });
  assert.equal(reads, 0);
});

test('server chat persists a stable text operation before POST and retries the exact payload', async () => {
  const state = stateStore();
  const calls = [];
  let fail = true;
  const service = new ServerChatService({
    list: async () => ({ items: [], nextCursor: null, hasMore: false }),
    send: async (_id, input) => { calls.push(input); if (fail) { fail = false; throw new Error('network timeout'); } return message({ clientMessageId: input.clientMessageId, text: input.text }); },
  }, state.store, () => uuid);
  await assert.rejects(service.send('farmer', farmerId, consultation, ' Perlu jadwalkan kontrol. '), /network timeout/);
  assert.deepEqual(state.pending(), { clientMessageId: uuid, text: 'Perlu jadwalkan kontrol.' });
  const saved = await service.send('farmer', farmerId, consultation, 'Perlu jadwalkan kontrol.');
  assert.equal(saved.clientMessageId, uuid);
  assert.deepEqual(calls, [
    { clientMessageId: uuid, text: 'Perlu jadwalkan kontrol.' },
    { clientMessageId: uuid, text: 'Perlu jadwalkan kontrol.' },
  ]);
  assert.equal(state.pending(), null);
});

test('server chat refuses a changed payload while send outcome is uncertain', async () => {
  const state = stateStore();
  const service = new ServerChatService({
    list: async () => ({ items: [], nextCursor: null, hasMore: false }),
    send: async () => { throw new Error('offline'); },
  }, state.store, () => uuid);
  await assert.rejects(service.send('farmer', farmerId, consultation, 'Pesan awal'), /offline/);
  await assert.rejects(service.send('farmer', farmerId, consultation, 'Pesan berbeda'), { code: 'INVALID_STATE' });
});

test('server chat blocks a rapid duplicate submit while the first POST is in flight', async () => {
  const state = stateStore();
  let releaseSend;
  let sendStarted;
  const started = new Promise((resolve) => { sendStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseSend = resolve; });
  let sends = 0;
  const service = new ServerChatService({
    list: async () => ({ items: [], nextCursor: null, hasMore: false }),
    send: async (_id, input) => { sends += 1; sendStarted(); await blocked; return message({ clientMessageId: input.clientMessageId, text: input.text }); },
  }, state.store, () => uuid);
  const first = service.send('farmer', farmerId, consultation, 'Pesan satu kali');
  await started;
  await assert.rejects(service.send('farmer', farmerId, consultation, 'Pesan satu kali'), { code: 'INVALID_STATE' });
  releaseSend();
  await first;
  assert.equal(sends, 1);
});

test('server chat refresh reconciles a committed pending clientMessageId without sending again', async () => {
  const state = stateStore();
  await state.store.writePending(farmerId, consultation.id, { clientMessageId: uuid, text: 'Perlu jadwalkan kontrol.' });
  let cleared = 0;
  const store = { ...state.store, clearPending: async () => { cleared += 1; await state.store.clearPending(); } };
  const service = new ServerChatService({
    list: async () => ({ items: [message()], nextCursor: null, hasMore: false }),
  }, store, () => uuid);
  assert.equal((await service.list('farmer', farmerId, consultation)).items[0].text, 'Perlu jadwalkan kontrol.');
  assert.equal(cleared, 1);
  assert.equal(state.pending(), null);
});

test('server chat retry only accepts a failed message owned by this account', async () => {
  let retries = 0;
  const service = new ServerChatService({
    retry: async (_id, messageId) => { retries += 1; return message({ id: messageId, deliveryStatus: 'sent' }); },
  }, stateStore().store, () => uuid);
  const failed = message({ deliveryStatus: 'failed' });
  assert.equal((await service.retryFailed('farmer', farmerId, consultation, failed)).deliveryStatus, 'sent');
  await assert.rejects(service.retryFailed('farmer', vetId, consultation, failed), { code: 'FORBIDDEN' });
  assert.equal(retries, 1);
});

test('server chat persists and clears unsent text drafts', async () => {
  const state = stateStore();
  const service = new ServerChatService({}, state.store, () => uuid);
  await service.saveDraft('farmer', farmerId, consultation, '  draft pesan  ');
  assert.equal(await service.readDraft('farmer', farmerId, consultation), '  draft pesan  ');
  await service.saveDraft('farmer', farmerId, consultation, '   ');
  assert.equal(state.draft(), null);
});

test('server chat uploads and commits private media once, then retries the exact message payload', async () => {
  const state = stateStore();
  const uploads = [];
  const commits = [];
  const sends = [];
  const removed = [];
  let uploadFails = true;
  let sendFails = true;
  const mediaAttachment = {
    id: attachmentId, kind: 'image', mimeType: 'image/jpeg', filename: 'foto.jpg', byteSize: 4,
    uploadStatus: 'uploaded', url: `/v1/attachments/${attachmentId}/content`, createdAt: '2026-11-19T00:00:00.000Z',
  };
  const media = {
    upload: async (id, file, key) => { uploads.push({ id, file, key }); if (uploadFails) { uploadFails = false; throw new Error('upload response lost'); } return mediaAttachment; },
    get: async (id) => ({ ...mediaAttachment, id, uploadStatus: 'committed' }),
    commit: async (id) => { commits.push(id); return { ...mediaAttachment, uploadStatus: 'committed' }; },
    download: async () => ({ attachment: { ...mediaAttachment, uploadStatus: 'committed' }, bytes: new Uint8Array([1, 2, 3, 4]).buffer }),
  };
  const mediaStore = {
    copyToPrivateStorage: async (_user, file) => ({ ...file, uri: 'file:///private/foto.jpg', byteSize: 4 }),
    storeDownloadedFile: async () => 'file:///private/downloaded.jpg',
    removePrivateFile: async (uri) => { removed.push(uri); },
  };
  const generatedIds = [uuid, uploadKey];
  let generatedIndex = 0;
  const service = new ServerChatService({
    list: async () => ({ items: [], nextCursor: null, hasMore: false }),
    send: async (id, input) => {
      sends.push({ id, input });
      if (sendFails) { sendFails = false; throw new Error('network timeout'); }
      return message({ clientMessageId: input.clientMessageId, text: input.text ?? null, attachments: [{
        id: attachmentId, kind: 'image', mimeType: 'image/jpeg', filename: 'foto.jpg', byteSize: 4,
        url: `/v1/attachments/${attachmentId}/content`,
      }] });
    },
  }, state.store, () => generatedIds[generatedIndex++], media, mediaStore);
  const selected = [{ uri: 'file:///picker/photo.jpg', filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 4, kind: 'image' }];

  await assert.rejects(service.sendWithMedia('farmer', farmerId, consultation, 'Foto ternak', selected), /upload response lost/);
  assert.equal(state.pending().attachments[0].attachmentId, undefined);
  await assert.rejects(service.sendWithMedia('farmer', farmerId, consultation, 'Foto ternak', []), /network timeout/);
  assert.equal(state.pending().attachments[0].attachmentId, attachmentId);
  assert.equal(state.pending().attachments[0].committed, true);
  const sent = await service.sendWithMedia('farmer', farmerId, consultation, 'Foto ternak', []);
  assert.equal(sent.attachments[0].id, attachmentId);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].key, uploads[1].key);
  assert.deepEqual(uploads[0].file, uploads[1].file);
  assert.deepEqual(commits, [attachmentId]);
  assert.deepEqual(sends.map(({ input }) => input), [
    { clientMessageId: uuid, text: 'Foto ternak', attachmentIds: [attachmentId] },
    { clientMessageId: uuid, text: 'Foto ternak', attachmentIds: [attachmentId] },
  ]);
  assert.equal(state.pending(), null);
  assert.deepEqual(removed, ['file:///private/foto.jpg']);
});

test('server chat downloads an attachment only when it belongs to a participant message', async () => {
  const state = stateStore();
  let downloads = 0;
  let storedBytes = 0;
  const attachment = {
    id: attachmentId, kind: 'image', mimeType: 'image/jpeg', filename: 'foto.jpg', byteSize: 4,
    url: `/v1/attachments/${attachmentId}/content`,
  };
  const service = new ServerChatService({}, state.store, () => uuid,
    { download: async () => { downloads += 1; return { attachment: { ...attachment, uploadStatus: 'committed', createdAt: '2026-11-19T00:00:00.000Z' }, bytes: new Uint8Array([1, 2, 3, 4]).buffer }; } },
    { storeDownloadedFile: async (_user, _item, bytes) => { storedBytes = bytes.byteLength; return 'file:///private/download.jpg'; } });
  const source = message({ attachments: [attachment] });
  assert.deepEqual(await service.downloadAttachment('farmer', farmerId, consultation, source, attachment), {
    attachment, localUri: 'file:///private/download.jpg',
  });
  assert.equal(downloads, 1);
  assert.equal(storedBytes, 4);
  await assert.rejects(service.downloadAttachment('farmer', farmerId, consultation, source, { ...attachment, id: uuid }), { code: 'FORBIDDEN' });
  assert.equal(downloads, 1);
});
