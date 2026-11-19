import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerNotificationsService } from '../.test-build/src/application/ServerNotificationsService.js';

const notificationId = '10000000-0000-4000-8000-000000000001';
const contextId = '10000000-0000-4000-8000-000000000002';
const base = {
  id: notificationId, actorId: '10000000-0000-4000-8000-000000000003',
  recipientId: '10000000-0000-4000-8000-000000000004', type: 'follow_up_created',
  category: 'reminders', contextType: 'follow_up', contextId, eventId: 'follow-up:one',
  title: 'Tindak lanjut tersedia', body: 'Jadwal tindak lanjut dapat dibuka.', readAt: null,
  deliveryStatus: 'sent', createdAt: '2026-11-19T00:00:00.000Z',
};
const preferences = {
  userId: base.recipientId, enabled: true,
  notifications: { consultations: true, reminders: true, commerce: false },
  version: 2, updatedAt: '2026-11-19T00:00:00.000Z',
};

test('server inbox keeps the unread count consistent and rejects duplicate IDs', async () => {
  const service = new ServerNotificationsService({
    list: async () => ({ items: [base], unreadCount: 1 }),
  });
  assert.deepEqual(await service.list('farmer'), { items: [base], unreadCount: 1 });
  const duplicate = new ServerNotificationsService({
    list: async () => ({ items: [base, base], unreadCount: 2 }),
  });
  await assert.rejects(duplicate.list('farmer'), { code: 'API_RESPONSE_INVALID' });
  const mismatchedCount = new ServerNotificationsService({
    list: async () => ({ items: [base], unreadCount: 0 }),
  });
  await assert.rejects(mismatchedCount.list('farmer'), { code: 'API_RESPONSE_INVALID' });
});

test('server mark-read preserves the server-checked context ID', async () => {
  const saved = { ...base, readAt: '2026-11-19T00:01:00.000Z' };
  const service = new ServerNotificationsService({
    markRead: async (id) => ({ notification: { ...saved, id }, contextId, contextType: 'follow_up' }),
  });
  assert.deepEqual(await service.markRead('farmer', notificationId), { notification: saved, contextId, contextType: 'follow_up' });
  const mismatch = new ServerNotificationsService({
    markRead: async () => ({ notification: saved, contextId: '10000000-0000-4000-8000-000000000005', contextType: 'follow_up' }),
  });
  await assert.rejects(mismatch.markRead('farmer', notificationId), { code: 'API_RESPONSE_INVALID' });
});

test('server preference changes are delegated as allowlisted category patches', async () => {
  let received;
  const service = new ServerNotificationsService({
    getPreferences: async () => preferences,
    patchPreferences: async (patch) => { received = patch; return preferences; },
  });
  assert.deepEqual(await service.getPreferences('vet'), preferences);
  assert.deepEqual(await service.updatePreferences('vet', { notifications: { commerce: true } }), preferences);
  assert.deepEqual(received, { notifications: { commerce: true } });
});

test('server notification operations reject unsupported roles before repository access', async () => {
  let reads = 0;
  const service = new ServerNotificationsService({ list: async () => { reads += 1; return { items: [], unreadCount: 0 }; } });
  await assert.rejects(service.list('admin'), { code: 'FORBIDDEN' });
  assert.equal(reads, 0);
});
