import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiCareCoordinationRepository } from '../.test-build/src/data/remote/HttpApiCareCoordinationRepository.js';

const id = {
  consultation: '11111111-1111-4111-8111-111111111111',
  followUp: '22222222-2222-4222-8222-222222222222',
  farmer: '33333333-3333-4333-8333-333333333333',
  vet: '44444444-4444-4444-8444-444444444444',
  animal: '55555555-5555-4555-8555-555555555555',
  report: '66666666-6666-4666-8666-666666666666',
  operation: '77777777-7777-4777-8777-777777777777',
  reminder: '88888888-8888-4888-8888-888888888888',
  healthEvent: '99999999-9999-4999-8999-999999999999',
};
const key = 'care-operation-1';
const at = '2026-11-17T10:00:00.000Z';
const followUp = {
  id: id.followUp, consultationId: id.consultation, farmerId: id.farmer, vetId: id.vet,
  animalId: id.animal, startsAt: '2026-11-18T09:00:00.000Z', endsAt: '2026-11-18T09:30:00.000Z',
  timezone: 'Asia/Jakarta', kind: 'recheck', status: 'scheduled', reason: 'Kontrol fiktif',
  followUpConsultationId: null, version: 1, createdAt: at, updatedAt: at,
};
const report = {
  id: id.report, consultationId: id.consultation, followUpId: id.followUp, farmerId: id.farmer,
  vetId: id.vet, animalId: id.animal, text: 'Kondisi fiktif stabil', attachmentIds: [],
  submittedAt: at, viewedAt: null,
};
const operated = (value, replayed = false) => ({ ...value, operationId: id.operation, replayed });
const reminder = {
  id: id.reminder, animalId: id.animal, consultationId: id.consultation, followUpId: id.followUp,
  ownerId: id.farmer, createdBy: id.vet, kind: 'care', dueAt: '2026-11-19T09:00:00.000Z',
  instructions: 'Perawatan fiktif', careStatus: 'scheduled', deliveryStatus: 'failed', completedAt: null,
  deliveryAttempt: 1, version: 2, createdAt: at, updatedAt: at,
};

test('follow-up read, create, and cancellation use BE-09 routes and allowlisted payloads', async () => {
  const calls = [];
  const repository = new HttpApiCareCoordinationRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') return response(200, { items: [followUp] });
    if (init.method === 'POST') return response(201, operated(followUp));
    return response(200, operated({ ...followUp, status: 'cancelled', version: 2 }));
  }));
  assert.equal((await repository.listFollowUps(id.consultation))[0].id, id.followUp);
  const created = await repository.createFollowUp(id.consultation, { idempotencyKey: key,
    payload: { startsAt: followUp.startsAt, endsAt: followUp.endsAt, reason: followUp.reason, farmerId: id.farmer } });
  assert.equal(created.operationId, id.operation);
  const cancelled = await repository.cancelFollowUp(id.followUp, { idempotencyKey: key,
    payload: { expectedVersion: 1, status: 'completed' } });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(JSON.parse(calls[1].init.body), { startsAt: followUp.startsAt, endsAt: followUp.endsAt, reason: followUp.reason });
  assert.deepEqual(JSON.parse(calls[2].init.body), { action: 'cancel', expectedVersion: 1 });
  assert.equal(calls[1].init.headers['Idempotency-Key'], key);
  assert.ok(calls[2].url.endsWith(`/v1/follow-ups/${id.followUp}`));
});

test('notification context resources are fetched by UUID through their read-only BE-09 routes', async () => {
  const calls = [];
  const repository = new HttpApiCareCoordinationRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(`/v1/follow-ups/${id.followUp}`)) return response(200, followUp);
    if (url.endsWith(`/v1/progress-reports/${id.report}`)) return response(200, report);
    if (url.endsWith(`/v1/reminders/${id.reminder}`)) return response(200, reminder);
    return response(404, {});
  }));
  assert.equal((await repository.getFollowUp(id.followUp)).id, id.followUp);
  assert.equal((await repository.getProgressReport(id.report)).followUpId, id.followUp);
  assert.equal((await repository.getReminder(id.reminder)).id, id.reminder);
  assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'GET', 'GET']);
  assert.ok(calls[0].url.endsWith(`/v1/follow-ups/${id.followUp}`));
  assert.ok(calls[1].url.endsWith(`/v1/progress-reports/${id.report}`));
  assert.ok(calls[2].url.endsWith(`/v1/reminders/${id.reminder}`));
});

test('progress reports remain separate from follow-up status and retry with the same key', async () => {
  const calls = [];
  const repository = new HttpApiCareCoordinationRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') return response(200, { items: [report] });
    if (calls.length === 2) throw new Error('response lost');
    return response(200, operated(report, true));
  }));
  assert.equal((await repository.listProgressReports(id.followUp))[0].viewedAt, null);
  const operation = { idempotencyKey: key, payload: { text: report.text, attachmentIds: [] } };
  await assert.rejects(repository.createProgressReport(id.followUp, operation), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls.length, 2, 'no automatic POST retry');
  const replay = await repository.createProgressReport(id.followUp, operation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.followUpId, id.followUp);
  assert.deepEqual(JSON.parse(calls[1].init.body), { text: report.text, attachmentIds: [] });
  assert.equal(calls[1].init.body, calls[2].init.body);
  assert.equal(calls[1].init.headers['Idempotency-Key'], calls[2].init.headers['Idempotency-Key']);
});

test('care adapter rejects invalid input and mismatched server responses before success', async () => {
  let calls = 0;
  const repository = new HttpApiCareCoordinationRepository(apiClient(async () => { calls += 1; return response(200, operated(followUp)); }));
  await assert.rejects(repository.listFollowUps('VL-001'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createFollowUp(id.consultation, { idempotencyKey: 'short', payload: {
    startsAt: followUp.startsAt, endsAt: followUp.endsAt, reason: followUp.reason,
  } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.cancelFollowUp(id.followUp, { idempotencyKey: key,
    payload: { expectedVersion: 0 } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createProgressReport(id.followUp, { idempotencyKey: key,
    payload: { text: 'x', attachmentIds: [id.animal, id.animal] } }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.cancelFollowUp(id.followUp, { idempotencyKey: key,
    payload: { expectedVersion: 1 } }), { code: 'API_RESPONSE_INVALID' });
  const wrongReport = new HttpApiCareCoordinationRepository(apiClient(async () => response(200, operated({ ...report, followUpId: id.consultation }))));
  await assert.rejects(wrongReport.createProgressReport(id.followUp, { idempotencyKey: key,
    payload: { text: report.text } }), { code: 'API_RESPONSE_INVALID' });
  const invalidZone = new HttpApiCareCoordinationRepository(apiClient(async () => response(200, { ...followUp, timezone: 'Invalid/Timezone' })));
  await assert.rejects(invalidZone.getFollowUp(id.followUp), { code: 'API_RESPONSE_INVALID' });
});

test('reminder read, create, and delivery retry preserve separate care and delivery states', async () => {
  const calls = [];
  const repository = new HttpApiCareCoordinationRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'GET') return response(200, { items: [reminder] });
    if (init.method === 'POST') return response(201, operated(reminder));
    return response(200, operated({ ...reminder, deliveryStatus: 'sent', deliveryAttempt: 2, version: 3 }));
  }));
  assert.equal((await repository.listReminders())[0].careStatus, 'scheduled');
  const result = await repository.createReminder({ idempotencyKey: key, payload: {
    animalId: id.animal, consultationId: id.consultation, followUpId: id.followUp,
    kind: 'care', dueAt: reminder.dueAt, instructions: reminder.instructions, ownerId: id.farmer,
  } });
  assert.equal(result.deliveryStatus, 'failed');
  const retried = await repository.retryReminderDelivery(id.reminder, key);
  assert.equal(retried.deliveryStatus, 'sent');
  assert.equal(retried.careStatus, 'scheduled');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    animalId: id.animal, consultationId: id.consultation, followUpId: id.followUp,
    kind: 'care', dueAt: reminder.dueAt, instructions: reminder.instructions,
  });
  assert.deepEqual(JSON.parse(calls[2].init.body), { action: 'retry_delivery' });
  assert.ok(calls[2].url.endsWith(`/v1/reminders/${id.reminder}`));
});

test('care completion requires explicit confirmation and a persisted done reminder with one event ID', async () => {
  const calls = [];
  const repository = new HttpApiCareCoordinationRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return response(200, operated({
      reminder: { ...reminder, careStatus: 'done', completedAt: at, version: 3 }, healthEventId: id.healthEvent,
    }, true));
  }));
  await assert.rejects(repository.completeCare(id.reminder, { idempotencyKey: key,
    payload: { confirmation: false } }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls.length, 0);
  const result = await repository.completeCare(id.reminder, { idempotencyKey: key,
    payload: { confirmation: true, deliveryStatus: 'sent' } });
  assert.equal(result.healthEventId, id.healthEvent);
  assert.equal(result.replayed, true);
  assert.equal(result.reminder.deliveryStatus, 'failed');
  assert.deepEqual(JSON.parse(calls[0].init.body), { confirmation: true });
});

test('reminder mutations reject bad inputs, malformed delivery, and uncertain transport without success', async () => {
  let calls = 0;
  const repository = new HttpApiCareCoordinationRepository(apiClient(async () => { calls += 1; throw new Error('response lost'); }));
  await assert.rejects(repository.createReminder({ idempotencyKey: key, payload: {
    kind: 'care', dueAt: reminder.dueAt, instructions: reminder.instructions,
  } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.retryReminderDelivery('bad-id', key), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.createReminder({ idempotencyKey: key, payload: {
    animalId: id.animal, kind: 'care', dueAt: reminder.dueAt, instructions: reminder.instructions,
  } }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls, 1);
  const malformed = new HttpApiCareCoordinationRepository(apiClient(async () => response(200,
    operated({ ...reminder, deliveryStatus: 'sent', careStatus: 'done', completedAt: null }))));
  await assert.rejects(malformed.retryReminderDelivery(id.reminder, key), { code: 'API_RESPONSE_INVALID' });
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
