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

test('server schedule editor scopes the vet, checks availability version, and delegates blocked times/calendar', async () => {
  const calls = [];
  const current = { ...availability, version: 4 };
  const block = { id: 'block-1', vetId: ids.vet, startsAt: '2026-11-21T02:00:00.000Z', endsAt: '2026-11-21T03:00:00.000Z', reason: 'Izin', status: 'active', version: 1 };
  const schedule = {
    getAvailability: async () => current,
    updateAvailability: async (input) => { calls.push(['availability', input]); return { operationId: 'operation-1', status: 'succeeded', occurredAt: '2026-11-20T00:00:00.000Z', value: { ...current, version: 5 } }; },
    getBlockedTimes: async () => { calls.push(['list-blocks']); return [block]; },
    createBlockedTime: async (input) => { calls.push(['create-block', input]); return { operationId: 'operation-2', status: 'succeeded', occurredAt: '2026-11-20T00:00:00.000Z', value: block }; },
    updateBlockedTime: async (id, input) => { calls.push(['update-block', id, input]); return { ...block, ...input, version: 2 }; },
    cancelBlockedTime: async (id, expectedVersion) => { calls.push(['cancel-block', id, expectedVersion]); return { ...block, status: 'cancelled', version: 2 }; },
    getSchedule: async (from, to) => { calls.push(['calendar', from, to]); return { appointments: [], followUps: [], blockedTimes: [block] }; },
  };
  const service = new ServerVetScheduleService(schedule, {});
  const input = { expectedVersion: 4, acceptingNewRequests: true };

  assert.equal((await service.ownAvailability('vet', ids.vet)).version, 4);
  await assert.rejects(service.ownAvailability('farmer', ids.vet), { code: 'FORBIDDEN' });
  await assert.rejects(service.ownAvailability('vet', 'another-vet'), { code: 'FORBIDDEN' });
  await assert.rejects(service.saveOwnAvailability('vet', ids.vet, { ...input, expectedVersion: 3 }), { code: 'VERSION_CONFLICT' });
  assert.equal((await service.saveOwnAvailability('vet', ids.vet, input)).value.version, 5);
  assert.deepEqual(await service.ownBlockedTimes('vet', ids.vet), [block]);
  assert.equal((await service.createOwnBlockedTime('vet', ids.vet, { startsAt: block.startsAt, endsAt: block.endsAt, reason: 'Izin' })).value.id, block.id);
  assert.equal((await service.updateOwnBlockedTime('vet', ids.vet, block.id, { startsAt: block.startsAt, endsAt: block.endsAt, reason: 'Izin', expectedVersion: 1 })).version, 2);
  assert.equal((await service.cancelOwnBlockedTime('vet', ids.vet, block.id, 1)).status, 'cancelled');
  assert.deepEqual(await service.ownSchedule('vet', ids.vet, '2026-11-20T00:00:00Z', '2026-11-27T00:00:00Z'), { appointments: [], followUps: [], blockedTimes: [block] });
  assert.equal(calls.filter(([kind]) => kind === 'availability').length, 1);
  assert.deepEqual(calls.find(([kind]) => kind === 'calendar'), ['calendar', '2026-11-20T00:00:00Z', '2026-11-27T00:00:00Z']);
});
