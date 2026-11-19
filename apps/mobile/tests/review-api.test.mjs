import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiReviewRepository } from '../.test-build/src/data/remote/HttpApiReviewRepository.js';

const consultationId = '11111111-1111-4111-8111-111111111111';
const vetId = '22222222-2222-4222-8222-222222222222';
const review = { id: '33333333-3333-4333-8333-333333333333', stars: 5,
  text: 'Pelayanan fiktif baik', submittedAt: '2026-11-18T01:00:00.000Z' };

test('immutable review write sends only stars and text; public page keeps cursor', async () => {
  const calls = [];
  const repository = new HttpApiReviewRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return init.method === 'POST'
      ? response(201, { ...review, consultationId })
      : response(200, { items: [review], nextCursor: 'next-page', hasMore: true });
  }));
  const saved = await repository.create(consultationId, { stars: 5, text: review.text, farmerId: vetId });
  assert.equal(saved.consultationId, consultationId);
  assert.deepEqual(JSON.parse(calls[0].init.body), { stars: 5, text: review.text });
  const page = await repository.listForVet(vetId, { cursor: 'opaque', limit: 10 });
  assert.equal(page.nextCursor, 'next-page');
  assert.ok(calls[1].url.includes('cursor=opaque&limit=10'));
});

test('owner review read uses the consultation ID and treats only 404 as no review', async () => {
  const calls = [];
  const repository = new HttpApiReviewRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return response(200, { ...review, consultationId });
  }));
  assert.deepEqual(await repository.getForConsultation(consultationId), { ...review, consultationId });
  assert.equal(new URL(calls[0].url).pathname, `/v1/consultations/${consultationId}/review`);
  assert.equal(calls[0].init.method, 'GET');

  const missing = new HttpApiReviewRepository(apiClient(async () => response(404, { code: 'NOT_FOUND', message: 'Ulasan tidak ditemukan.' })));
  assert.equal(await missing.getForConsultation(consultationId), null);
  const mismatched = new HttpApiReviewRepository(apiClient(async () => response(200, {
    ...review, consultationId: vetId,
  })));
  await assert.rejects(mismatched.getForConsultation(consultationId), { code: 'API_RESPONSE_INVALID' });
});

test('review adapter rejects invalid input, wrong consultation and malformed public page', async () => {
  let calls = 0;
  const repository = new HttpApiReviewRepository(apiClient(async () => { calls += 1; return response(201, review); }));
  await assert.rejects(repository.create('bad-id', { stars: 5 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create(consultationId, { stars: 0 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.listForVet(vetId, { limit: 101 }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.create(consultationId, { stars: 5 }), { code: 'API_RESPONSE_INVALID' });
  const malformed = new HttpApiReviewRepository(apiClient(async () => response(200, {
    items: [{ ...review, stars: 6 }], nextCursor: null, hasMore: false,
  })));
  await assert.rejects(malformed.listForVet(vetId), { code: 'API_RESPONSE_INVALID' });
});

test('uncertain review POST has one attempt; explicit retry with same content relies on BE-13 dedupe', async () => {
  let calls = 0;
  const repository = new HttpApiReviewRepository(apiClient(async () => {
    calls += 1;
    if (calls === 1) throw new Error('response lost');
    return response(200, { ...review, consultationId });
  }));
  const input = { stars: 5, text: review.text };
  await assert.rejects(repository.create(consultationId, input), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls, 1);
  assert.equal((await repository.create(consultationId, input)).id, review.id);
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
