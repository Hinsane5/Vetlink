import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerVetScheduleService } from '../.test-build/src/application/ServerVetScheduleService.js';

const ids = { vet: '10000000-0000-4000-8000-000000000003' };
const availability = {
  vetId: ids.vet, acceptingNewRequests: true, services: ['chat', 'visit'], timezone: 'Asia/Jakarta',
};

test('server proposal slots use the assigned vet timezone and sort server results', async () => {
  const calls = [];
  const slots = [
    { startsAt: '2026-11-22T10:00:00+07:00', endsAt: '2026-11-22T11:00:00+07:00' },
    { startsAt: '2026-11-22T10:30:00+08:00', endsAt: '2026-11-22T11:30:00+08:00' },
  ];
  const service = new ServerVetScheduleService(
    { getAvailability: async () => availability },
    { getOwnProposalSlots: async (...args) => { calls.push(args); return slots; } },
    () => new Date('2026-11-19T17:30:00.000Z'),
  );

  assert.deepEqual(await service.proposalSlots('vet', ids.vet, 'visit'), {
    timezone: 'Asia/Jakarta', slots: [slots[1], slots[0]],
  });
  assert.deepEqual(calls, [['vet', ids.vet, 'visit', '2026-11-20', '2026-12-03']]);
});

test('server proposal slots reject wrong role, foreign availability and unavailable services before directory read', async () => {
  let calls = 0;
  const directory = { getOwnProposalSlots: async () => { calls += 1; return []; } };
  const foreign = new ServerVetScheduleService({ getAvailability: async () => ({ ...availability, vetId: '10000000-0000-4000-8000-000000000004' }) }, directory);
  const unavailable = new ServerVetScheduleService({ getAvailability: async () => ({ ...availability, acceptingNewRequests: false }) }, directory);
  const service = new ServerVetScheduleService({ getAvailability: async () => availability }, directory);

  await assert.rejects(service.proposalSlots('farmer', ids.vet, 'chat'), { code: 'FORBIDDEN' });
  await assert.rejects(foreign.proposalSlots('vet', ids.vet, 'chat'), { code: 'FORBIDDEN' });
  await assert.rejects(unavailable.proposalSlots('vet', ids.vet, 'chat'), { code: 'INVALID_STATE' });
  assert.equal(calls, 0);
});

test('server proposal slots reject duplicate or malformed server times', async () => {
  const duplicate = { startsAt: '2026-11-21T02:00:00.000Z', endsAt: '2026-11-21T03:00:00.000Z' };
  const service = new ServerVetScheduleService(
    { getAvailability: async () => availability },
    { getOwnProposalSlots: async () => [duplicate, duplicate] },
  );
  await assert.rejects(service.proposalSlots('vet', ids.vet, 'chat'), { code: 'API_RESPONSE_INVALID' });

  const duplicateInstant = new ServerVetScheduleService(
    { getAvailability: async () => availability },
    { getOwnProposalSlots: async () => [
      { startsAt: '2026-11-21T10:00:00+07:00', endsAt: '2026-11-21T11:00:00+07:00' },
      { startsAt: '2026-11-21T11:00:00+08:00', endsAt: '2026-11-21T12:00:00+08:00' },
    ] },
  );
  await assert.rejects(duplicateInstant.proposalSlots('vet', ids.vet, 'chat'), { code: 'API_RESPONSE_INVALID' });
});

test('proposal decisions use the assigned vet timezone and reject unrelated accounts', async () => {
  const service = new ServerVetScheduleService(
    { getAvailability: async () => availability },
    { getDetail: async (role, vetId) => ({ role, id: vetId, timezone: 'Asia/Makassar' }) },
  );

  assert.equal(await service.timezoneFor('farmer', 'farmer-id', ids.vet), 'Asia/Makassar');
  assert.equal(await service.timezoneFor('vet', ids.vet, ids.vet), 'Asia/Jakarta');
  await assert.rejects(service.timezoneFor('vet', 'another-vet', ids.vet), { code: 'FORBIDDEN' });
});
