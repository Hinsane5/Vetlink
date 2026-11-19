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
