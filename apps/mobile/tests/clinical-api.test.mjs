import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiClinicalRepository } from '../.test-build/src/data/remote/HttpApiClinicalRepository.js';

const ids = {
  consultation: '11111111-1111-4111-8111-111111111111',
  note: '22222222-2222-4222-8222-222222222222',
  recommendation: '33333333-3333-4333-8333-333333333333',
  item: '44444444-4444-4444-8444-444444444444',
  product: '55555555-5555-4555-8555-555555555555',
};
const note = {
  id: ids.note, consultation_id: ids.consultation, status: 'draft', complaint: 'Keluhan fiktif', findings: 'Temuan fiktif',
  assessment: 'Penilaian fiktif', actions: 'Tindakan fiktif', care_instructions: 'Instruksi fiktif',
  version: 2, finalized_at: null,
};
const rec = {
  id: ids.recommendation, consultation_id: ids.consultation, status: 'draft', sent_at: null, version: 2,
  items: [{ id: ids.item, productId: ids.product, title: 'Produk Fiktif', instructions: 'Ikuti petunjuk fiktif', note: '' }],
};

test('clinical note API preserves draft/final separation and sends allowlisted fields', async () => {
  const calls = [];
  const repository = new HttpApiClinicalRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/note/finalize')) return response(201, { ...note, status: 'final', version: 3, finalized_at: '2026-11-17T12:00:00.000Z' });
    if (init.method === 'PUT') return response(200, note);
    return response(200, { consultationId: ids.consultation, status: 'draft', complaint: '', findings: '', assessment: '', actions: '', careInstructions: '', version: 1 });
  }));
  assert.equal((await repository.getNote(ids.consultation)).id, null);
  const saved = await repository.saveNote(ids.consultation, { expectedVersion: 1, complaint: 'Keluhan fiktif', findings: 'Temuan fiktif', actorId: ids.note });
  assert.equal(saved.version, 2);
  assert.deepEqual(JSON.parse(calls[1].init.body), { expectedVersion: 1, complaint: 'Keluhan fiktif', findings: 'Temuan fiktif' });
  const final = await repository.finalizeNote(ids.consultation, 2);
  assert.equal(final.status, 'final');
  assert.equal(final.finalizedAt, '2026-11-17T12:00:00.000Z');
  assert.deepEqual(JSON.parse(calls[2].init.body), { expectedVersion: 2 });
});

test('recommendation API keeps read items, save snapshots, and send result without inventing items', async () => {
  const calls = [];
  const repository = new HttpApiClinicalRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/send')) return response(200, { id: ids.recommendation, consultation_id: ids.consultation, status: 'sent', version: 3, sent_at: '2026-11-17T13:00:00.000Z' });
    if (init.method === 'PUT') return response(200, { ...rec, items: [{ productId: ids.product, title: 'Produk Fiktif', instructions: 'Ikuti petunjuk fiktif', note: '' }] });
    return response(200, rec);
  }));
  assert.equal((await repository.getRecommendation(ids.consultation)).items[0].title, 'Produk Fiktif');
  const saved = await repository.saveRecommendation(ids.consultation, { expectedVersion: 1, items: [{ productId: ids.product, instructions: 'Ikuti petunjuk fiktif', ownerId: ids.note }] });
  assert.equal(saved.items[0].productId, ids.product);
  assert.deepEqual(JSON.parse(calls[1].init.body), { expectedVersion: 1, items: [{ productId: ids.product, instructions: 'Ikuti petunjuk fiktif' }] });
  const sent = await repository.sendRecommendation(ids.consultation, 2);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.items, null, 'BE-08 send response does not return item projection; caller reloads GET');
});

test('clinical API rejects invalid versions, item bounds, malformed final note, and uncertain write', async () => {
  let calls = 0;
  const repository = new HttpApiClinicalRepository(apiClient(async () => { calls += 1; throw new Error('response lost'); }));
  await assert.rejects(repository.getNote('VL-001'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.saveNote(ids.consultation, { expectedVersion: 0 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.saveNote(ids.consultation, { expectedVersion: 1, findings: 'x'.repeat(8001) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.finalizeNote(ids.consultation, -1), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.saveRecommendation(ids.consultation, { expectedVersion: 1, items: [{ note: 'No title' }] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.saveRecommendation(ids.consultation, { expectedVersion: 1, items: Array.from({ length: 51 }, () => ({ title: 'Fiktif' })) }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.saveNote(ids.consultation, { expectedVersion: 1, findings: 'Temuan fiktif' }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls, 1);
  const invalid = new HttpApiClinicalRepository(apiClient(async () => response(200, { ...note, status: 'final', finalized_at: null })));
  await assert.rejects(invalid.getNote(ids.consultation), { code: 'API_RESPONSE_INVALID' });
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
