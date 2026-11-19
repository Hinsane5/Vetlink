import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerProfileService } from '../.test-build/src/application/ServerProfileService.js';

const userId = '10000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-19T00:00:00.000Z';
const farmer = { role: 'farmer', userId, fullName: 'Sari', createdAt: timestamp, updatedAt: timestamp, version: 1 };
const vet = { ...farmer, role: 'vet', professionalName: null, registrationReference: null, verificationStatus: 'pending' };

test('server profile reads only the active role profile and doctor submissions', async () => {
  const service = new ServerProfileService({
    getFarmer: async () => farmer,
    getVet: async () => vet,
    listVerification: async () => [],
  });
  assert.deepEqual(await service.get('farmer'), { role: 'farmer', profile: farmer, submissions: [] });
  assert.deepEqual(await service.get('vet'), { role: 'vet', profile: vet, submissions: [] });
});

test('server profile saves normalized allowlisted fields for the active role', async () => {
  const calls = [];
  const service = new ServerProfileService({
    patchFarmer: async (input) => { calls.push(['farmer', input]); return { ...farmer, ...input }; },
    patchVet: async (input) => { calls.push(['vet', input]); return { ...vet, ...input }; },
  });
  await service.save('farmer', { fullName: '  Sari  ', professionalName: '', registrationReference: '' });
  await service.save('vet', { fullName: '  Dr. Bima ', professionalName: ' Klinik Bima ', registrationReference: ' ID-77 ' });
  assert.deepEqual(calls, [
    ['farmer', { fullName: 'Sari' }],
    ['vet', { fullName: 'Dr. Bima', professionalName: 'Klinik Bima', registrationReference: 'ID-77' }],
  ]);
});

test('server profile rejects unsupported roles and invalid bounds before writes', async () => {
  let writes = 0;
  const service = new ServerProfileService({ getFarmer: async () => farmer, patchFarmer: async () => { writes += 1; return farmer; } });
  await assert.rejects(service.get('admin'), { code: 'FORBIDDEN' });
  await assert.rejects(service.save('admin', { fullName: 'A', professionalName: '', registrationReference: '' }), { code: 'FORBIDDEN' });
  await assert.rejects(service.save('farmer', { fullName: ' ', professionalName: '', registrationReference: '' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.save('vet', { fullName: 'Bima', professionalName: 'x'.repeat(121), registrationReference: '' }), { code: 'VALIDATION_FAILED' });
  assert.equal(writes, 0);
});
