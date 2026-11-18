import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiNotificationsRepository } from '../.test-build/src/data/remote/HttpApiNotificationsRepository.js';

const id = {
  notification: '11111111-1111-4111-8111-111111111111', actor: '22222222-2222-4222-8222-222222222222',
  recipient: '33333333-3333-4333-8333-333333333333', context: '44444444-4444-4444-8444-444444444444',
};
const at = '2026-11-18T01:00:00.000Z';
const notification = { id: id.notification, actorId: id.actor, recipientId: id.recipient,
  type: 'follow_up_scheduled', category: 'reminders', contextType: 'follow_up', contextId: id.context,
  eventId: 'follow-up-created:fictional', title: 'Tindak lanjut', body: 'Jadwal fiktif tersedia',
  readAt: null, deliveryStatus: 'pending', createdAt: at };
const preferences = { userId: id.recipient, enabled: true,
  notifications: { consultations: true, reminders: true, commerce: false }, version: 2, updatedAt: at };

test('inbox preserves scoped context and marks an authorized notification read once', async () => {
  const calls = [];
  const repository = new HttpApiNotificationsRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return response(200, {
      notification: { ...notification, readAt: at }, contextId: id.context, contextType: 'follow_up',
    });
    return response(200, { items: [notification], unreadCount: 1 });
  }));
  const inbox = await repository.list();
  assert.equal(inbox.unreadCount, 1);
  assert.equal((await repository.markRead(id.notification)).contextId, id.context);
  assert.equal(calls[1].init.body, undefined);
  assert.ok(calls[1].url.endsWith(`/v1/me/notifications/${id.notification}/read`));
});

test('preferences patch sends only selected booleans and preserves the server result', async () => {
  const calls = [];
  const repository = new HttpApiNotificationsRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return response(200, preferences);
  }));
  assert.equal((await repository.getPreferences()).notifications.commerce, false);
  assert.equal((await repository.patchPreferences({ notifications: { reminders: false, ownerId: id.actor } })).version, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { notifications: { reminders: false } });
});

test('inbox adapter rejects invalid IDs, empty patch, bad unread count and unauthorized context result', async () => {
  let calls = 0;
  const repository = new HttpApiNotificationsRepository(apiClient(async () => { calls += 1; return response(200, {}); }));
  await assert.rejects(repository.markRead('bad-id'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.patchPreferences({ notifications: {} }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const badInbox = new HttpApiNotificationsRepository(apiClient(async () => response(200, {
    items: [notification], unreadCount: 0,
  })));
  await assert.rejects(badInbox.list(), { code: 'API_RESPONSE_INVALID' });
  const staleLink = new HttpApiNotificationsRepository(apiClient(async () => response(200, {
    notification: { ...notification, readAt: at, contextId: null }, contextId: id.context, contextType: 'follow_up',
  })));
  await assert.rejects(staleLink.markRead(id.notification), { code: 'API_RESPONSE_INVALID' });
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
