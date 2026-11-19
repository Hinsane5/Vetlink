import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerReviewService } from '../.test-build/src/application/ServerReviewService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';

const farmerId = '11111111-1111-4111-8111-111111111111';
const consultationId = '22222222-2222-4222-8222-222222222222';
const consultation = {
  id: consultationId,
  farmerId,
  vetId: '33333333-3333-4333-8333-333333333333',
  displayCode: 'VL-C-900',
  status: 'completed',
};
const savedReview = {
  id: '44444444-4444-4444-8444-444444444444',
  consultationId,
  stars: 5,
  text: 'Pelayanan jelas.',
  submittedAt: '2026-11-20T08:30:00.000Z',
};

test('server review reads only for the Farmer who owns a completed consultation', async () => {
  let reads = 0;
  const service = new ServerReviewService({ getForConsultation: async () => { reads += 1; return savedReview; } });
  assert.deepEqual(await service.load('farmer', farmerId, consultation), savedReview);
  await assert.rejects(service.load('vet', farmerId, consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.load('farmer', '55555555-5555-4555-8555-555555555555', consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.load('farmer', farmerId, { ...consultation, status: 'scheduled' }), { code: 'INVALID_STATE' });
  assert.equal(reads, 1);
});

test('server review submit normalizes text and validates the persisted result', async () => {
  const writes = [];
  const service = new ServerReviewService({
    getForConsultation: async () => null,
    create: async (id, input) => {
      writes.push({ id, input });
      return { ...savedReview, stars: input.stars, text: input.text ?? null };
    },
  });
  const result = await service.submit('farmer', farmerId, consultation, 4, '  Sangat membantu.  ');
  assert.equal(result.stars, 4);
  assert.equal(result.text, 'Sangat membantu.');
  assert.deepEqual(writes, [{ id: consultationId, input: { stars: 4, text: 'Sangat membantu.' } }]);
  await assert.rejects(service.submit('farmer', farmerId, consultation, 0, 'Tidak valid'), { code: 'VALIDATION_FAILED' });
});

test('server review retry reads back the immutable record and refuses changed content', async () => {
  let createCalls = 0;
  const service = new ServerReviewService({
    getForConsultation: async () => savedReview,
    create: async () => { createCalls += 1; return savedReview; },
  });
  assert.deepEqual(await service.submit('farmer', farmerId, consultation, 5, 'Pelayanan jelas.'), savedReview);
  await assert.rejects(service.submit('farmer', farmerId, consultation, 4, 'Berbeda.'),
    (error) => error instanceof DomainError && error.code === 'IMMUTABLE_RECORD');
  assert.equal(createCalls, 0);
});

test('server review fails closed when a response belongs to another consultation', async () => {
  const service = new ServerReviewService({
    getForConsultation: async () => ({ ...savedReview, consultationId: '55555555-5555-4555-8555-555555555555' }),
  });
  await assert.rejects(service.load('farmer', farmerId, consultation), { code: 'API_RESPONSE_INVALID' });
});
