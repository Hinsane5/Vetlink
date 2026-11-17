import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiVetScheduleRepository } from '../.test-build/src/data/remote/HttpApiVetScheduleRepository.js';

const ids = {
  vet: '11111111-1111-4111-8111-111111111111',
  consultation: '22222222-2222-4222-8222-222222222222',
  animal: '33333333-3333-4333-8333-333333333333',
  farmer: '44444444-4444-4444-8444-444444444444',
  block: '55555555-5555-4555-8555-555555555555',
  operation: '66666666-6666-4666-8666-666666666666',
};
const availability = {
  vet_id: ids.vet, accepting_new_requests: true, services: ['chat', 'visit'], timezone: 'Asia/Jakarta',
  weekday_rules: [{ weekday: 1, start: '09:00', end: '17:00' }],
  chat_duration_minutes: 30, visit_duration_minutes: 60, updated_at: '2026-11-17T02:00:00.000Z', version: 2,
  experienceYears: 7, specialties: ['Ternak'], species: ['cattle'], practiceLocation: 'Bogor', serviceAreas: ['Bogor'],
  rates: { chat: 100000, visit: 150000 },
};
const block = { id: ids.block, startsAt: '2026-11-18T02:00:00.000Z', endsAt: '2026-11-18T03:00:00.000Z', reason: 'Libur fiktif', status: 'active', version: 1 };

test('vet schedule adapter reads raw BE-04 availability and owner-scoped calendar', async () => {
  const calls = [];
  const repository = new HttpApiVetScheduleRepository(apiClient(async (url) => {
    calls.push(url);
    if (url.endsWith('/availability')) return response(200, availability);
    if (url.endsWith('/blocked-times')) return response(200, [block]);
    if (url.includes('/schedule?')) return response(200, {
      appointments: [{ id: ids.consultation, displayCode: 'VL-C-1', service: 'chat', status: 'scheduled', startsAt: '2026-11-18T02:00:00.000Z', endsAt: '2026-11-18T02:30:00.000Z', feeIdr: '100000' }],
      followUps: [{ id: ids.operation, consultationId: ids.consultation, animalId: ids.animal, farmerId: ids.farmer, startsAt: '2026-11-19T02:00:00.000Z', endsAt: '2026-11-19T02:30:00.000Z', reason: 'Kontrol fiktif', status: 'scheduled', version: 1 }],
      blockedTimes: [{ id: block.id, startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason, status: block.status }],
    });
    throw new Error(`Unexpected route ${url}`);
  }));
  assert.equal((await repository.getAvailability()).rates.chat, 100000);
  assert.equal((await repository.getBlockedTimes())[0].id, ids.block);
  const calendar = await repository.getSchedule('2026-11-18T00:00:00+07:00', '2026-11-20T00:00:00+07:00');
  assert.equal(calendar.appointments[0].feeIdr, '100000');
  assert.equal(calendar.followUps[0].farmerId, ids.farmer);
  assert.equal(calendar.blockedTimes[0].reason, block.reason);
  assert.ok(calls.every((url) => !url.includes('vetId=')));
});

test('availability PUT sends only validated BE-04 fields and returns persisted version', async () => {
  let request;
  const repository = new HttpApiVetScheduleRepository(apiClient(async (url, init) => {
    request = { url, init };
    return response(200, { operationId: ids.operation, status: 'succeeded', occurredAt: '2026-11-17T02:00:00.000Z', value: availability });
  }));
  const result = await repository.updateAvailability({
    expectedVersion: 1, acceptingNewRequests: true, services: ['chat', 'visit'], timezone: 'Asia/Jakarta',
    weekdayRules: [{ weekday: 1, start: '09:00', end: '17:00' }], chatDurationMinutes: 30,
    visitDurationMinutes: 60, rates: { chat: 100000, visit: 150000 }, experienceYears: 7,
    specialties: ['Ternak'], species: ['cattle'], practiceLocation: 'Bogor', serviceAreas: ['Bogor'],
    vetId: ids.vet, verificationStatus: 'verified',
  });
  assert.equal(result.value.version, 2);
  assert.equal(request.init.method, 'PUT');
  assert.deepEqual(Object.keys(JSON.parse(request.init.body)).sort(), [
    'acceptingNewRequests', 'chatDurationMinutes', 'expectedVersion', 'experienceYears', 'practiceLocation',
    'rates', 'serviceAreas', 'services', 'specialties', 'species', 'timezone', 'visitDurationMinutes', 'weekdayRules',
  ]);
  assert.equal(JSON.parse(request.init.body).vetId, undefined);
});

test('vet schedule adapter rejects invalid version, tariff, timezone, date range, and response', async () => {
  let calls = 0;
  const repository = new HttpApiVetScheduleRepository(apiClient(async () => { calls += 1; return response(200, availability); }));
  const valid = { expectedVersion: 1, acceptingNewRequests: true, services: ['chat'], timezone: 'Asia/Jakarta', weekdayRules: [{ weekday: 1, start: '09:00', end: '17:00' }], chatDurationMinutes: 30, visitDurationMinutes: 60, rates: { chat: 100000 } };
  await assert.rejects(repository.updateAvailability({ ...valid, expectedVersion: 0 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateAvailability({ ...valid, rates: { chat: 1.5 } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateAvailability({ ...valid, timezone: 'Invalid/Zone' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateAvailability({ ...valid, weekdayRules: [{ weekday: 1, start: '17:00', end: '09:00' }] }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getSchedule('2026-11-18T00:00:00', '2026-11-20T00:00:00Z'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getSchedule('2026-11-18T00:00:00Z', '2027-01-01T00:00:00Z'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const invalid = new HttpApiVetScheduleRepository(apiClient(async () => response(200, { ...availability, rates: { chat: Number.MAX_SAFE_INTEGER + 1 } })));
  await assert.rejects(invalid.getAvailability(), { code: 'API_RESPONSE_INVALID' });
});

test('blocked time API sends allowlisted interval and version; cancellation confirms persisted state', async () => {
  const calls = [];
  const repository = new HttpApiVetScheduleRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') return response(201, { operationId: ids.operation, status: 'succeeded', occurredAt: '2026-11-17T02:00:00Z', value: block });
    if (init.method === 'PUT') return response(200, { ...block, version: 2 });
    return response(200, { id: ids.block, status: 'cancelled', version: 3 });
  }));
  const interval = { startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason, vetId: ids.vet };
  assert.equal((await repository.createBlockedTime(interval)).value.id, ids.block);
  assert.equal((await repository.updateBlockedTime(ids.block, { ...interval, expectedVersion: 1 })).version, 2);
  assert.equal((await repository.cancelBlockedTime(ids.block, 2)).status, 'cancelled');
  assert.deepEqual(JSON.parse(calls[0].init.body), { startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason });
  assert.deepEqual(JSON.parse(calls[1].init.body), { startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason, expectedVersion: 1 });
  assert.ok(calls[2].url.endsWith(`/v1/me/vet/blocked-times/${ids.block}?expectedVersion=2`));
  assert.equal(calls[2].init.method, 'DELETE');
});

test('blocked time rejects invalid bounds and uncertain POST is attempted once', async () => {
  let calls = 0;
  const repository = new HttpApiVetScheduleRepository(apiClient(async () => { calls += 1; throw new Error('response lost'); }));
  await assert.rejects(repository.createBlockedTime({ startsAt: block.endsAt, endsAt: block.startsAt, reason: 'Terbalik' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.updateBlockedTime('not-uuid', { startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason, expectedVersion: 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.cancelBlockedTime(ids.block, 0), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.createBlockedTime({ startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls, 1);
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
