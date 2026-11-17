import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiChatRepository } from '../.test-build/src/data/remote/HttpApiChatRepository.js';

const ids = {
  consultation: '11111111-1111-4111-8111-111111111111',
  message: '22222222-2222-4222-8222-222222222222',
  client: '33333333-3333-4333-8333-333333333333',
  sender: '44444444-4444-4444-8444-444444444444',
  attachment: '55555555-5555-4555-8555-555555555555',
};
const message = {
  id: ids.message, clientMessageId: ids.client, senderId: ids.sender, text: 'Pesan fiktif', attachments: [],
  deliveryStatus: 'sent', deliveryAttempt: 1, createdAt: '2026-11-17T10:00:00.000Z', sentAt: '2026-11-17T10:00:01.000Z',
};

test('chat API reads ordered pages and sends stable clientMessageId without actor fields', async () => {
  const calls = [];
  const repository = new HttpApiChatRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return response(201, message);
    return response(200, { items: [message], nextCursor: null, hasMore: false });
  }));
  const page = await repository.list(ids.consultation, { limit: 10, cursor: 'opaque-page' });
  assert.equal(page.items[0].deliveryStatus, 'sent');
  const sent = await repository.send(ids.consultation, { clientMessageId: ids.client, text: 'Pesan fiktif', senderId: ids.sender });
  assert.equal(sent.id, ids.message);
  assert.ok(calls[0].url.includes('limit=10&cursor=opaque-page'));
  assert.deepEqual(JSON.parse(calls[1].init.body), { clientMessageId: ids.client, text: 'Pesan fiktif' });
  assert.equal(calls[1].init.headers['Idempotency-Key'], undefined, 'BE-07 uses clientMessageId in body');
});

test('uncertain send uses one attempt; explicit retry targets the same stored message', async () => {
  const calls = [];
  const repository = new HttpApiChatRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) throw new Error('response lost');
    return response(200, { ...message, deliveryStatus: 'failed', sentAt: null, deliveryAttempt: 2 });
  }));
  const input = Object.freeze({ clientMessageId: ids.client, text: 'Pesan fiktif' });
  await assert.rejects(repository.send(ids.consultation, input), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls.length, 1);
  const retried = await repository.retry(ids.consultation, ids.message);
  assert.equal(retried.id, ids.message);
  assert.equal(retried.deliveryStatus, 'failed');
  assert.ok(calls[1].url.endsWith(`/messages/${ids.message}/retry`));
});

test('chat API validates UUID, text, attachments, private URLs, and server page before success', async () => {
  let calls = 0;
  const repository = new HttpApiChatRepository(apiClient(async () => { calls += 1; return response(200, message); }));
  await assert.rejects(repository.list('VL-001'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.list(ids.consultation, { limit: 101 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.send(ids.consultation, { clientMessageId: ids.client, text: '  ' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.send(ids.consultation, { clientMessageId: ids.client, attachmentIds: [ids.attachment, ids.attachment] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.retry(ids.consultation, 'bad-id'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const badAttachment = { id: ids.attachment, kind: 'image', mimeType: 'image/jpeg', filename: 'fiktif.jpg', byteSize: 10, url: 'https://public.example.invalid/secret' };
  const invalid = new HttpApiChatRepository(apiClient(async () => response(200, { ...message, attachments: [badAttachment] })));
  await assert.rejects(invalid.send(ids.consultation, { clientMessageId: ids.client, text: 'Pesan fiktif' }), { code: 'API_RESPONSE_INVALID' });
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
