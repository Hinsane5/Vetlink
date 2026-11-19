import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerCareCoordinationService } from '../.test-build/src/application/ServerCareCoordinationService.js';

const ids = {
  farmer: '10000000-0000-4000-8000-000000000001',
  vet: '10000000-0000-4000-8000-000000000002',
  animal: '10000000-0000-4000-8000-000000000003',
  consultation: '10000000-0000-4000-8000-000000000004',
  followUp: '10000000-0000-4000-8000-000000000005',
  reminder: '10000000-0000-4000-8000-000000000006',
  report: '10000000-0000-4000-8000-000000000007',
};

const consultation = {
  id: ids.consultation, farmerId: ids.farmer, vetId: ids.vet, animalId: ids.animal,
  status: 'in_progress', paymentStatus: 'succeeded', serviceType: 'chat',
};
const followUp = {
  id: ids.followUp, consultationId: ids.consultation, farmerId: ids.farmer, vetId: ids.vet,
  animalId: ids.animal, startsAt: '2026-11-21T02:00:00.000Z', endsAt: '2026-11-21T02:30:00.000Z',
  timezone: 'Asia/Jakarta', kind: 'recheck', status: 'scheduled', reason: 'Periksa kembali',
  followUpConsultationId: null, version: 1, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
};
const reminder = {
  id: ids.reminder, animalId: ids.animal, consultationId: ids.consultation, followUpId: ids.followUp,
  ownerId: ids.farmer, createdBy: ids.vet, kind: 'care', dueAt: '2026-11-21T02:00:00.000Z',
  instructions: 'Amati kondisi ternak', careStatus: 'scheduled', deliveryStatus: 'pending', completedAt: null,
  deliveryAttempt: 0, version: 1, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z',
};

function createService(overrides = {}, existingJournal = { operation: null }) {
  const calls = [];
  const journal = existingJournal;
  const repository = {
    listFollowUps: async (id) => { calls.push(['listFollowUps', id]); return [followUp]; },
    listProgressReports: async (id) => { calls.push(['listProgressReports', id]); return []; },
    listReminders: async () => [reminder],
    createFollowUp: async (...args) => { calls.push(['createFollowUp', ...args]); return followUp; },
    createReminder: async (...args) => { calls.push(['createReminder', ...args]); return reminder; },
    createProgressReport: async (...args) => { calls.push(['createProgressReport', ...args]); return { id: ids.report, consultationId: ids.consultation, followUpId: ids.followUp, farmerId: ids.farmer, vetId: ids.vet, animalId: ids.animal, text: 'Kondisi membaik', attachmentIds: [], submittedAt: '2026-11-19T00:00:00.000Z', viewedAt: null }; },
    completeCare: async (...args) => { calls.push(['completeCare', ...args]); return { reminder: { ...reminder, careStatus: 'done' }, healthEventId: ids.report, operationId: 'operation-1', replayed: false }; },
    ...overrides,
  };
  const schedule = { timezoneFor: async (role, userId, vetId) => { calls.push(['timezoneFor', role, userId, vetId]); return 'Asia/Jakarta'; } };
  const pending = {
    read: async () => journal.operation,
    write: async (_userId, _consultationId, operation) => {
      if (journal.operation && JSON.stringify(journal.operation) !== JSON.stringify(operation)) throw Object.assign(new Error('pending exists'), { code: 'INVALID_STATE' });
      journal.operation = operation;
    },
    clear: async () => { journal.operation = null; },
  };
  const service = new ServerCareCoordinationService(repository, schedule, () => 'new-operation-1', () => new Date('2026-11-19T00:00:00.000Z'), pending);
  return { service, calls, journal };
}

test('server care coordination reads only the selected consultation, and collects reports/reminders', async () => {
  const { service, calls } = createService();
  const result = await service.load('vet', ids.vet, consultation);
  assert.equal(result.timezone, 'Asia/Jakarta');
  assert.deepEqual(result.followUps.map((item) => item.id), [ids.followUp]);
  assert.equal(result.reminders.length, 1);
  assert.deepEqual(calls.map((call) => call[0]), ['timezoneFor', 'listFollowUps', 'listProgressReports']);
});

test('server care coordination fails closed for another provider before reading', async () => {
  const { service, calls } = createService();
  await assert.rejects(service.load('vet', ids.farmer, consultation), { code: 'FORBIDDEN' });
  await assert.rejects(service.scheduleFollowUp('vet', ids.farmer, consultation, 'Asia/Jakarta', {
    startsAt: '2026-11-21 09:00', endsAt: '2026-11-21 09:30', reason: 'Periksa kembali', operationKey: 'operation-1',
  }), { code: 'FORBIDDEN' });
  assert.deepEqual(calls, []);
});

test('follow-up and reminder writes validate local time and reuse caller idempotency keys', async () => {
  const { service, calls } = createService();
  await service.scheduleFollowUp('vet', ids.vet, consultation, 'Asia/Jakarta', {
    startsAt: '2026-11-21 09:00', endsAt: '2026-11-21 09:30', reason: 'Periksa kembali', operationKey: 'stable-follow-up-key',
  });
  await service.createReminder('farmer', ids.farmer, consultation, 'Asia/Jakarta', {
    followUpId: ids.followUp, kind: 'care', dueAt: '2026-11-21 09:00', instructions: 'Amati kondisi ternak', operationKey: 'stable-reminder-key',
  });
  assert.equal(calls[0][2].idempotencyKey, 'stable-follow-up-key');
  assert.equal(calls[0][2].payload.startsAt, '2026-11-21T02:00:00.000Z');
  assert.equal(calls[1][1].idempotencyKey, 'stable-reminder-key');
  assert.equal(calls[1][1].payload.consultationId, ids.consultation);
  await assert.rejects(service.createReminder('farmer', ids.farmer, consultation, 'Asia/Jakarta', {
    followUpId: null, kind: 'care', dueAt: '2026-11-18 09:00', instructions: 'Amati kondisi ternak', operationKey: 'past-time-key',
  }), { code: 'VALIDATION_FAILED' });
});

test('farmer reports and care completion are scoped and require persisted server results', async () => {
  const { service, calls } = createService();
  const report = await service.submitReport('farmer', ids.farmer, consultation, followUp, { text: 'Kondisi membaik', operationKey: 'stable-report-key' });
  assert.equal(report.followUpId, ids.followUp);
  assert.equal(calls.at(-1)[1], ids.followUp);
  await assert.rejects(service.submitReport('vet', ids.vet, consultation, followUp, { text: 'Laporan dokter', operationKey: 'stable-report-key' }), { code: 'FORBIDDEN' });
  const completed = await service.completeCare('farmer', ids.farmer, consultation, reminder, 'stable-completion-key');
  assert.equal(completed.reminder.careStatus, 'done');
  assert.equal(calls.at(-1)[1], ids.reminder);
  await assert.rejects(service.completeCare('vet', ids.vet, consultation, reminder, 'stable-completion-key'), { code: 'FORBIDDEN' });
});

test('uncertain follow-up writes retain the exact key and payload until a replay succeeds', async () => {
  let attempts = 0;
  const requests = [];
  const journal = { operation: null };
  const createFollowUp = async (...args) => {
    attempts += 1;
    requests.push(args);
    if (attempts === 1) throw Object.assign(new Error('network unknown'), { code: 'SERVICE_UNAVAILABLE' });
    return followUp;
  };
  const { service } = createService({ createFollowUp }, journal);
  const input = { startsAt: '2026-11-21 09:00', endsAt: '2026-11-21 09:30', reason: 'Periksa kembali', operationKey: 'stable-follow-up-key' };
  await assert.rejects(service.scheduleFollowUp('vet', ids.vet, consultation, 'Asia/Jakarta', input), { code: 'SERVICE_UNAVAILABLE' });
  assert.deepEqual(journal.operation, {
    type: 'follow_up', idempotencyKey: 'stable-follow-up-key', startsAt: '2026-11-21T02:00:00.000Z',
    endsAt: '2026-11-21T02:30:00.000Z', reason: 'Periksa kembali',
  });
  const afterRestart = createService({ createFollowUp }, journal).service;
  assert.equal((await afterRestart.load('vet', ids.vet, consultation)).pending.idempotencyKey, 'stable-follow-up-key');
  await afterRestart.retryPending('vet', ids.vet, consultation);
  assert.equal(journal.operation, null);
  assert.equal(attempts, 2);
  assert.deepEqual(requests[1], [ids.consultation, {
    idempotencyKey: 'stable-follow-up-key',
    payload: { startsAt: '2026-11-21T02:00:00.000Z', endsAt: '2026-11-21T02:30:00.000Z', reason: 'Periksa kembali' },
  }]);
});
