import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerConsultationService } from '../.test-build/src/application/ServerConsultationService.js';

const consultation = (id, serviceType = 'chat') => ({ id, serviceType });
const ids = {
  consultation: '10000000-0000-4000-8000-000000000001',
  farmer: '10000000-0000-4000-8000-000000000002',
  vet: '10000000-0000-4000-8000-000000000003',
  key: '10000000-0000-4000-8000-000000000004',
};

test('server consultation use case reads owner/assignment-scoped list for both roles', async () => {
  const calls = [];
  const service = new ServerConsultationService({
    list: async () => { calls.push('list'); return [{ id: 'consultation-a' }]; },
    getById: async () => consultation('consultation-a'),
    getVisit: async () => { throw new Error('unexpected visit'); },
  });
  await assert.rejects(service.list('unknown'), { code: 'FORBIDDEN' });
  assert.deepEqual(await service.list('farmer'), [{ id: 'consultation-a' }]);
  assert.deepEqual(await service.list('vet'), [{ id: 'consultation-a' }]);
  assert.deepEqual(calls, ['list', 'list']);
});

test('server consultation rejects duplicate rows and returns visit projection only for visits', async () => {
  const duplicate = new ServerConsultationService({
    list: async () => [{ id: 'same' }, { id: 'same' }], getById: async () => consultation('c'), getVisit: async () => ({}),
  });
  await assert.rejects(duplicate.list('vet'), { code: 'API_RESPONSE_INVALID' });
  const calls = [];
  const service = new ServerConsultationService({
    list: async () => [],
    getById: async (id) => { calls.push(['detail', id]); return consultation(id, id === 'visit-a' ? 'visit' : 'chat'); },
    getVisit: async (id) => { calls.push(['visit', id]); return { consultationId: id }; },
  });
  assert.deepEqual(await service.getDetail('farmer', 'chat-a'), { consultation: consultation('chat-a'), visit: null });
  assert.deepEqual(await service.getDetail('vet', 'visit-a'), { consultation: consultation('visit-a', 'visit'), visit: { consultationId: 'visit-a' } });
  assert.deepEqual(calls, [['detail', 'chat-a'], ['detail', 'visit-a'], ['visit', 'visit-a']]);
});

test('server consultation rejects a response whose ID differs from requested detail', async () => {
  const service = new ServerConsultationService({
    list: async () => [], getById: async () => consultation('different'), getVisit: async () => null,
  });
  await assert.rejects(service.getDetail('farmer', 'requested'), { code: 'API_RESPONSE_INVALID' });
});

test('assigned vet advances the visit one server stage with both versions and reloads its projection', async () => {
  const currentConsultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'scheduled',
    paymentStatus: 'succeeded', version: 3, visitStage: 'scheduled',
  };
  const currentVisit = { consultationId: ids.consultation, stage: 'scheduled', version: 4, updatedAt: '2026-11-19T00:00:00.000Z' };
  const nextConsultation = { ...currentConsultation, version: 3, visitStage: 'en_route' };
  const nextVisit = { ...currentVisit, stage: 'en_route', version: 5 };
  const calls = [];
  const service = new ServerConsultationService({
    advanceVisit: async (...args) => { calls.push(args); return { operationId: 'operation-1', replayed: false, consultation: nextConsultation, visit: nextVisit }; },
    getById: async () => nextConsultation,
    getVisit: async () => nextVisit,
  }, () => ids.key);
  assert.deepEqual(await service.advanceVisit('vet', ids.vet, currentConsultation, currentVisit, 'depart'), {
    consultation: nextConsultation, visit: nextVisit,
  });
  assert.deepEqual(calls, [[ids.consultation, 'depart', {
    idempotencyKey: ids.key, payload: { expectedVersion: 3, expectedVisitVersion: 4 },
  }]]);
});

test('server visit actions reject wrong role, assignment, status and out-of-order stages before HTTP', async () => {
  let calls = 0;
  const consultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'scheduled',
    paymentStatus: 'succeeded', version: 3, visitStage: 'scheduled',
  };
  const visit = { consultationId: ids.consultation, stage: 'scheduled', version: 4, updatedAt: '2026-11-19T00:00:00.000Z' };
  const service = new ServerConsultationService({ advanceVisit: async () => { calls += 1; } }, () => ids.key);
  await assert.rejects(service.advanceVisit('farmer', ids.farmer, consultation, visit, 'depart'), { code: 'FORBIDDEN' });
  await assert.rejects(service.advanceVisit('vet', ids.farmer, consultation, visit, 'depart'), { code: 'FORBIDDEN' });
  await assert.rejects(service.advanceVisit('vet', ids.vet, { ...consultation, status: 'in_progress' }, visit, 'depart'), { code: 'INVALID_STATE' });
  await assert.rejects(service.advanceVisit('vet', ids.vet, consultation, { ...visit, stage: 'arrived' }, 'depart'), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});

test('assigned vet completes an examined visit only with its final note and explicit confirmation', async () => {
  const currentConsultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'in_progress',
    paymentStatus: 'succeeded', version: 5, visitStage: 'examining',
  };
  const currentVisit = { consultationId: ids.consultation, stage: 'examining', version: 7, updatedAt: '2026-11-19T00:00:00.000Z' };
  const finalNote = { id: '10000000-0000-4000-8000-000000000005', consultationId: ids.consultation, status: 'final', finalizedAt: '2026-11-19T00:01:00.000Z' };
  const nextConsultation = { ...currentConsultation, status: 'completed', version: 6, visitStage: 'completed', completionAt: '2026-11-19T00:02:00.000Z' };
  const nextVisit = { ...currentVisit, stage: 'completed', version: 8 };
  const calls = [];
  const service = new ServerConsultationService({
    complete: async (...args) => { calls.push(args); return { operationId: 'operation-2', replayed: false, consultation: nextConsultation }; },
    getById: async () => nextConsultation,
    getVisit: async () => nextVisit,
  }, () => ids.key);

  assert.deepEqual(await service.completeVisit('vet', ids.vet, currentConsultation, currentVisit, finalNote), {
    consultation: nextConsultation, visit: nextVisit,
  });
  assert.deepEqual(calls, [[ids.consultation, {
    idempotencyKey: ids.key,
    payload: { expectedVersion: 5, expectedVisitVersion: 7, confirmation: true },
  }]]);
});

test('server visit completion rejects wrong role, assignment, state, stage, or non-final note before HTTP', async () => {
  let calls = 0;
  const consultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'in_progress',
    paymentStatus: 'succeeded', version: 5, visitStage: 'examining',
  };
  const visit = { consultationId: ids.consultation, stage: 'examining', version: 7, updatedAt: '2026-11-19T00:00:00.000Z' };
  const note = { id: '10000000-0000-4000-8000-000000000005', consultationId: ids.consultation, status: 'final', finalizedAt: '2026-11-19T00:01:00.000Z' };
  const service = new ServerConsultationService({ complete: async () => { calls += 1; } }, () => ids.key);

  await assert.rejects(service.completeVisit('farmer', ids.farmer, consultation, visit, note), { code: 'FORBIDDEN' });
  await assert.rejects(service.completeVisit('vet', ids.farmer, consultation, visit, note), { code: 'FORBIDDEN' });
  await assert.rejects(service.completeVisit('vet', ids.vet, { ...consultation, paymentStatus: 'pending' }, visit, note), { code: 'INVALID_STATE' });
  await assert.rejects(service.completeVisit('vet', ids.vet, consultation, { ...visit, stage: 'arrived' }, note), { code: 'INVALID_STATE' });
  await assert.rejects(service.completeVisit('vet', ids.vet, consultation, visit, { ...note, status: 'draft' }), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});
