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

test('assigned vet accepts a paid request using its version and verifies the resulting Visit', async () => {
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'requested',
    paymentStatus: 'succeeded', version: 4,
  };
  const updated = { ...current, status: 'scheduled', version: 5 };
  const visit = { consultationId: ids.consultation, stage: 'scheduled', version: 1, updatedAt: '2026-11-19T00:00:00.000Z' };
  const calls = [];
  const service = new ServerConsultationService({
    accept: async (...args) => { calls.push(args); return { operationId: 'accept-1', replayed: false, consultation: updated }; },
    getById: async () => updated,
    getVisit: async () => visit,
  }, () => ids.key);

  assert.deepEqual(await service.respondToRequest('vet', ids.vet, current, 'accept'), { consultation: updated, visit });
  assert.deepEqual(calls, [[ids.consultation, { idempotencyKey: ids.key, payload: { expectedVersion: 4 } }]]);
});

test('assigned vet rejects a paid request with a normalized reason and rejects invalid reasons before HTTP', async () => {
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'requested',
    paymentStatus: 'succeeded', version: 4,
  };
  const updated = { ...current, status: 'rejected', version: 5 };
  const calls = [];
  const service = new ServerConsultationService({
    reject: async (...args) => { calls.push(args); return { operationId: 'reject-1', replayed: false, consultation: updated }; },
    getById: async () => updated,
  }, () => ids.key);

  await assert.rejects(service.respondToRequest('vet', ids.vet, current, 'reject', '  '), { code: 'INVALID_STATE' });
  assert.deepEqual(await service.respondToRequest('vet', ids.vet, current, 'reject', '  Jadwal penuh  '), { consultation: updated, visit: null });
  assert.deepEqual(calls, [[ids.consultation, { idempotencyKey: ids.key, payload: { expectedVersion: 4, reason: 'Jadwal penuh' } }]]);
});

test('farmer cancels a paid consultation with a reason and confirms the refund-needed server state', async () => {
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'reschedule_pending',
    paymentStatus: 'succeeded', reschedulePreviousStatus: 'scheduled', version: 8,
  };
  const updated = { ...current, status: 'cancelled', version: 9, cancellationReason: 'Jadwal berubah', refundStatus: 'refund_needed' };
  const calls = [];
  const service = new ServerConsultationService({
    cancel: async (...args) => { calls.push(args); return { operationId: 'cancel-1', replayed: false, consultation: updated }; },
    getById: async () => updated,
  }, () => ids.key);

  assert.deepEqual(await service.cancel('farmer', ids.farmer, current, '  Jadwal berubah  '), { consultation: updated, visit: null });
  assert.deepEqual(calls, [[ids.consultation, { idempotencyKey: ids.key, payload: { expectedVersion: 8, reason: 'Jadwal berubah' } }]]);
});

test('server cancellation rejects foreign owners, unpaid, started, and invalid requests before HTTP', async () => {
  let calls = 0;
  const repo = { cancel: async () => { calls += 1; } };
  const service = new ServerConsultationService(repo, () => ids.key);
  const base = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'visit', status: 'scheduled',
    paymentStatus: 'succeeded', version: 8, visitStage: 'scheduled', reschedulePreviousStatus: null,
  };

  await assert.rejects(service.cancel('vet', ids.vet, base, 'Alasan valid'), { code: 'FORBIDDEN' });
  await assert.rejects(service.cancel('farmer', ids.vet, base, 'Alasan valid'), { code: 'FORBIDDEN' });
  await assert.rejects(service.cancel('farmer', ids.farmer, { ...base, paymentStatus: 'pending' }, 'Alasan valid'), { code: 'INVALID_STATE' });
  await assert.rejects(service.cancel('farmer', ids.farmer, { ...base, visitStage: 'en_route' }, 'Alasan valid'), { code: 'INVALID_STATE' });
  await assert.rejects(service.cancel('farmer', ids.farmer, base, '  '), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});

test('farmer accepts a pending schedule proposal with consent and reloads the server time', async () => {
  const proposal = {
    id: '10000000-0000-4000-8000-000000000006', previousStatus: 'scheduled',
    startsAt: '2026-11-20T10:00:00.000Z', endsAt: '2026-11-20T11:00:00.000Z',
    status: 'pending', respondedAt: null, version: 1, createdAt: '2026-11-19T00:00:00.000Z',
  };
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'reschedule_pending',
    paymentStatus: 'succeeded', version: 8, startsAt: '2026-11-19T10:00:00.000Z', proposals: [proposal],
  };
  const updatedProposal = { ...proposal, status: 'accepted', respondedAt: '2026-11-19T00:01:00.000Z', version: 2 };
  const updated = { ...current, status: 'scheduled', version: 9, startsAt: proposal.startsAt, endsAt: proposal.endsAt, proposals: [updatedProposal] };
  const calls = [];
  const service = new ServerConsultationService({
    respondScheduleProposal: async (...args) => { calls.push(args); return { operationId: 'proposal-1', replayed: false, decision: 'accept', consultation: updated }; },
    getById: async () => updated,
  }, () => ids.key);

  assert.deepEqual(await service.respondToProposal('farmer', ids.farmer, current, proposal.id, 'accept'), { consultation: updated, visit: null });
  assert.deepEqual(calls, [[ids.consultation, proposal.id, {
    idempotencyKey: ids.key, payload: { expectedVersion: 8, decision: 'accept', consent: true },
  }]]);
});

test('schedule-proposal response rejects foreign farmers and inactive proposals before HTTP', async () => {
  let calls = 0;
  const consultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'reschedule_pending',
    version: 8, proposals: [{ id: ids.key, previousStatus: 'scheduled', status: 'declined', startsAt: '2026-11-20T10:00:00.000Z' }],
  };
  const service = new ServerConsultationService({ respondScheduleProposal: async () => { calls += 1; } }, () => ids.key);
  await assert.rejects(service.respondToProposal('vet', ids.vet, consultation, ids.key, 'accept'), { code: 'FORBIDDEN' });
  await assert.rejects(service.respondToProposal('farmer', ids.farmer, consultation, ids.key, 'accept'), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});

test('assigned vet proposes a server slot with the current version and reloads the pending proposal', async () => {
  const startsAt = '2026-11-22T02:00:00.000Z';
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'scheduled',
    paymentStatus: 'succeeded', version: 9, startsAt: '2026-11-21T02:00:00.000Z', proposals: [],
  };
  const proposal = {
    id: '10000000-0000-4000-8000-000000000006', previousStatus: 'scheduled', startsAt,
    endsAt: '2026-11-22T03:00:00.000Z', status: 'pending', respondedAt: null, version: 1,
    createdAt: '2026-11-19T00:00:00.000Z',
  };
  const updated = { ...current, status: 'reschedule_pending', version: 10, proposals: [proposal] };
  const calls = [];
  const service = new ServerConsultationService({
    proposeSchedule: async (...args) => { calls.push(args); return { operationId: 'proposal-create', replayed: false, proposalId: proposal.id, consultation: updated }; },
    getById: async () => updated,
  }, () => ids.key);

  assert.deepEqual(await service.proposeSchedule('vet', ids.vet, current, startsAt), { consultation: updated, visit: null });
  assert.deepEqual(calls, [[ids.consultation, { idempotencyKey: ids.key, payload: { expectedVersion: 9, startsAt } }]]);
});

test('assigned vet starts a paid scheduled chat with its latest version and reloads the server detail', async () => {
  const current = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'scheduled',
    paymentStatus: 'succeeded', version: 6,
  };
  const updated = { ...current, status: 'in_progress', version: 7 };
  const calls = [];
  const service = new ServerConsultationService({
    startChat: async (...args) => { calls.push(args); return { operationId: 'operation-start', replayed: false, consultation: updated }; },
    getById: async () => updated,
  }, () => ids.key);

  assert.deepEqual(await service.startChat('vet', ids.vet, current), updated);
  assert.deepEqual(calls, [[ids.consultation, { idempotencyKey: ids.key, payload: { expectedVersion: 6 } }]]);
});

test('server start-chat rejects wrong role, assignment, service, payment, and state before HTTP', async () => {
  let calls = 0;
  const consultation = {
    id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, serviceType: 'chat', status: 'scheduled',
    paymentStatus: 'succeeded', version: 6,
  };
  const service = new ServerConsultationService({ startChat: async () => { calls += 1; } }, () => ids.key);
  await assert.rejects(service.startChat('farmer', ids.farmer, consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.startChat('vet', ids.farmer, consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.startChat('vet', ids.vet, { ...consultation, serviceType: 'visit' }), { code: 'INVALID_STATE' });
  await assert.rejects(service.startChat('vet', ids.vet, { ...consultation, paymentStatus: 'pending' }), { code: 'INVALID_STATE' });
  await assert.rejects(service.startChat('vet', ids.vet, { ...consultation, status: 'in_progress' }), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
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
