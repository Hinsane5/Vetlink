import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerFarmService } from '../.test-build/src/application/ServerFarmService.js';

test('server Farm use case reads owner-scoped records and normalizes a new Farm name', async () => {
  const calls = [];
  const expected = [{ id: 'farm-1', name: 'Sawah Hijau' }];
  const service = new ServerFarmService(
    { listFarms: async () => { calls.push('list'); return expected; } },
    { createFarm: async (input) => { calls.push(input); return expected[0]; } },
  );
  assert.equal(await service.list('farmer'), expected);
  assert.equal(await service.create('farmer', '  Sawah   Hijau  '), expected[0]);
  assert.deepEqual(calls, ['list', { name: 'Sawah Hijau', species: [] }]);
});

test('server Farm use case rejects veterinarian and invalid names before repository writes', async () => {
  let calls = 0;
  const service = new ServerFarmService(
    { listFarms: async () => { calls++; return []; } },
    { createFarm: async () => { calls++; return {}; } },
  );
  assert.throws(() => service.list('vet'), { code: 'FORBIDDEN' });
  assert.throws(() => service.create('vet', 'Farm'), { code: 'FORBIDDEN' });
  assert.throws(() => service.create('farmer', ' '), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
});
