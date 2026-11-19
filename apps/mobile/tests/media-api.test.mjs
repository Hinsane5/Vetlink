import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiMediaRepository } from '../.test-build/src/data/remote/HttpApiMediaRepository.js';

const consultation = '11111111-1111-4111-8111-111111111111';
const attachment = '22222222-2222-4222-8222-222222222222';
const file = { uri: 'file:///fictional/photo.jpg', filename: 'fiktif.jpg', mimeType: 'image/jpeg', byteSize: 3 };
const metadata = { id: attachment, kind: 'image', mimeType: 'image/jpeg', filename: 'fiktif.jpg', byteSize: 3,
  uploadStatus: 'uploaded', url: `/v1/attachments/${attachment}/content`, createdAt: '2026-11-17T10:00:00.000Z' };

test('media upload uses private multipart, stable idempotency key, and explicit commit', async () => {
  const previous = globalThis.FormData;
  const forms = [];
  globalThis.FormData = class { fields = []; constructor() { forms.push(this); } append(...args) { this.fields.push(args); } };
  try {
    const calls = [];
    const repository = new HttpApiMediaRepository(client(async (url, init) => {
      calls.push({ url, init });
      return response(url.endsWith('/uploads') ? 201 : 200,
        url.endsWith('/uploads') ? metadata : { ...metadata, uploadStatus: 'committed' });
    }));
    assert.equal((await repository.upload(consultation, file, 'media-key-001')).uploadStatus, 'uploaded');
    assert.equal((await repository.commit(attachment)).uploadStatus, 'committed');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'media-key-001');
    assert.equal(calls[0].init.headers['Content-Type'], undefined);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer access-token');
    assert.equal(calls[0].init.body, forms[0]);
    assert.deepEqual(forms[0].fields.map(([name]) => name), ['consultationId', 'file']);
    assert.equal(calls[1].url.endsWith(`/attachments/${attachment}/commit`), true);
  } finally { globalThis.FormData = previous; }
});

test('media download checks committed metadata and exact bytes through authenticated content route', async () => {
  const calls = [];
  const repository = new HttpApiMediaRepository(client(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/content')) return { ...response(200, null), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return response(200, { ...metadata, uploadStatus: 'committed' });
  }));
  const downloaded = await repository.download(attachment);
  assert.deepEqual([...new Uint8Array(downloaded.bytes)], [1, 2, 3]);
  assert.equal(downloaded.attachment.uploadStatus, 'committed');
  assert.equal(calls[1].init.headers.Accept, '*/*');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-token');
  const incomplete = new HttpApiMediaRepository(client(async () => response(200, metadata)));
  await assert.rejects(incomplete.download(attachment), { code: 'VALIDATION_FAILED' });
});

test('media adapter rejects invalid file, public URL, mismatched size, and uncertain upload', async () => {
  let calls = 0;
  const repository = new HttpApiMediaRepository(client(async () => { calls += 1; return response(201, metadata); }));
  await assert.rejects(repository.upload('VL-001', file, 'media-key-001'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.upload(consultation, { ...file, byteSize: 11 * 1024 * 1024 }, 'media-key-001'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const previous = globalThis.FormData;
  globalThis.FormData = class { append() {} };
  try {
    const publicUrl = new HttpApiMediaRepository(client(async () => response(201, { ...metadata, url: 'https://example.invalid/media' })));
    await assert.rejects(publicUrl.upload(consultation, file, 'media-key-001'), { code: 'API_RESPONSE_INVALID' });
    const uncertain = new HttpApiMediaRepository(client(async () => { throw new Error('lost response'); }));
    await assert.rejects(uncertain.upload(consultation, file, 'media-key-001'), { code: 'SERVICE_UNAVAILABLE' });
  } finally { globalThis.FormData = previous; }
});

function client(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token', refreshToken: 'refresh-token', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
