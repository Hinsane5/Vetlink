import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerClinicalService } from '../.test-build/src/application/ServerClinicalService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';

const note = { id: 'note-1', consultationId: 'consultation-1', status: 'draft', complaint: '', findings: '', assessment: '', actions: '', careInstructions: '', version: 2, finalizedAt: null };
const recommendation = { id: null, consultationId: 'consultation-1', status: 'draft', version: 1, sentAt: null, items: [] };

test('server clinical service scopes writes to vets and presents farmer 404s as no published record', async () => {
  const calls = [];
  const service = new ServerClinicalService({
    getNote: async () => { throw new DomainError('NOT_FOUND', 'missing'); },
    getRecommendation: async () => { throw new DomainError('NOT_FOUND', 'missing'); },
    saveNote: async (...args) => { calls.push(['save-note', ...args]); return note; },
    finalizeNote: async (...args) => { calls.push(['finalize', ...args]); return { ...note, status: 'final' }; },
    saveRecommendation: async (...args) => { calls.push(['save-rec', ...args]); return recommendation; },
    sendRecommendation: async (...args) => { calls.push(['send-rec', ...args]); return { ...recommendation, status: 'sent' }; },
  });
  assert.equal(await service.getNote('farmer', 'consultation-1'), null);
  assert.equal(await service.getRecommendation('farmer', 'consultation-1'), null);
  await assert.rejects(service.saveNote('farmer', 'consultation-1', { expectedVersion: 1 }), { code: 'FORBIDDEN' });
  await assert.rejects(service.finalizeNote('farmer', 'consultation-1', 1), { code: 'FORBIDDEN' });
  await assert.rejects(service.saveRecommendation('farmer', 'consultation-1', { expectedVersion: 1, items: [] }), { code: 'FORBIDDEN' });
  await assert.rejects(service.sendRecommendation('farmer', 'consultation-1', 1), { code: 'FORBIDDEN' });
  assert.deepEqual(calls, []);
});

test('server clinical service fails closed if the API exposes an unpublished draft to a farmer', async () => {
  const service = new ServerClinicalService({
    getNote: async () => note,
    getRecommendation: async () => recommendation,
  });
  await assert.rejects(service.getNote('farmer', 'consultation-1'), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(service.getRecommendation('farmer', 'consultation-1'), { code: 'API_RESPONSE_INVALID' });
});

test('server clinical service validates version and note fields before remote writes', async () => {
  let writes = 0;
  const service = new ServerClinicalService({
    saveNote: async () => { writes++; return note; },
    finalizeNote: async () => { writes++; return { ...note, status: 'final' }; },
  });
  await assert.rejects(service.saveNote('vet', 'consultation-1', { expectedVersion: 0 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.saveNote('vet', 'consultation-1', { expectedVersion: 1, careInstructions: 'x'.repeat(8001) }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.finalizeNote('vet', 'consultation-1', Number.MAX_SAFE_INTEGER + 1), { code: 'VALIDATION_FAILED' });
  assert.equal(writes, 0);
  assert.equal((await service.saveNote('vet', 'consultation-1', { expectedVersion: 1, complaint: 'Keluhan' })).id, 'note-1');
  assert.equal(writes, 1);
});

test('server clinical service validates recommendation draft bounds and allows blank draft lists', async () => {
  let received;
  const service = new ServerClinicalService({
    saveRecommendation: async (id, input) => { received = [id, input]; return recommendation; },
    sendRecommendation: async () => ({ ...recommendation, status: 'sent' }),
  });
  await assert.rejects(service.saveRecommendation('vet', 'consultation-1', { expectedVersion: 1, items: [{ title: '  ' }] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.saveRecommendation('vet', 'consultation-1', { expectedVersion: 1, items: Array.from({ length: 51 }, () => ({})) }), { code: 'VALIDATION_FAILED' });
  assert.equal((await service.saveRecommendation('vet', 'consultation-1', { expectedVersion: 1, items: [] })).status, 'draft');
  assert.deepEqual(received, ['consultation-1', { expectedVersion: 1, items: [] }]);
  assert.equal((await service.sendRecommendation('vet', 'consultation-1', 1)).status, 'sent');
});
