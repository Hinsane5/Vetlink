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

test('server Farm address use case normalizes owner input and links a saved address with version guard', async () => {
  const calls = [];
  const farm = { id: 'farm-1', visitAddressId: null, version: 4 };
  const address = { id: 'address-1', label: 'Kandang Utama' };
  const service = new ServerFarmService(
    {
      listFarms: async () => [farm],
      getFarmById: async () => farm,
      listAddresses: async () => [address],
      getAddressById: async () => address,
    },
    {
      createFarm: async () => farm,
      createAddress: async (input) => { calls.push(['createAddress', input]); return address; },
      updateFarm: async (farmId, input) => { calls.push(['updateFarm', farmId, input]); return { ...farm, visitAddressId: input.visitAddressId, version: 5 }; },
      updateAddress: async () => address,
      deleteAddress: async () => undefined,
    },
  );
  assert.deepEqual(await service.listAddresses('farmer'), [address]);
  await service.createAddress('farmer', { label: '  Kandang Utama ', recipientName: ' Budi ', phone: ' 0812345 ', addressLine: ' Jl. Contoh 1 ', city: ' Bogor ', province: ' Jawa Barat ', postalCode: ' 16111 ' });
  assert.deepEqual(calls[0], ['createAddress', { label: 'Kandang Utama', recipientName: 'Budi', phone: '0812345', addressLine: 'Jl. Contoh 1', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111' }]);
  assert.deepEqual(await service.setVisitAddress('farmer', farm.id, address.id), { ...farm, visitAddressId: address.id, version: 5 });
  assert.deepEqual(calls[1], ['updateFarm', farm.id, { visitAddressId: address.id, expectedVersion: 4 }]);
});

test('server Farm address edit reads the owned version before PATCH and requires a newer matching result', async () => {
  const current = { id: 'address-1', label: 'Rumah', recipientName: 'Budi', phone: '0812345', addressLine: 'Jalan Lama', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111', version: 3 };
  let writes = 0;
  const input = { label: 'Rumah', recipientName: 'Budi', phone: '0812345', addressLine: 'Jalan Baru', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111', expectedVersion: 3 };
  const service = new ServerFarmService(
    { listFarms: async () => [], getFarmById: async () => ({}), listAddresses: async () => [], getAddressById: async () => current },
    { createFarm: async () => ({}), createAddress: async () => ({}), updateFarm: async () => ({}), updateAddress: async (id, value) => { writes++; assert.equal(id, current.id); assert.equal(value.expectedVersion, 3); return { ...current, ...value, version: 4 }; }, deleteAddress: async () => undefined },
  );
  assert.equal((await service.updateAddress('farmer', current.id, input)).version, 4);
  await assert.rejects(service.updateAddress('farmer', current.id, { ...input, expectedVersion: 2 }), { code: 'VERSION_CONFLICT' });
  assert.equal(writes, 1);
});

test('server Farm address use case rejects vet, incomplete fields and mismatched saved scope', async () => {
  let writes = 0;
  const service = new ServerFarmService(
    {
      listFarms: async () => [],
      getFarmById: async () => ({ id: 'another-farm', visitAddressId: null, version: 1 }),
      listAddresses: async () => [],
      getAddressById: async () => ({ id: 'address-1' }),
    },
    {
      createFarm: async () => ({}),
      createAddress: async () => { writes++; return {}; },
      updateFarm: async () => { writes++; return {}; },
      updateAddress: async () => ({}),
      deleteAddress: async () => undefined,
    },
  );
  assert.throws(() => service.createAddress('vet', { label: 'x', recipientName: 'Budi', phone: '0812345', addressLine: 'Jalan', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111' }), { code: 'FORBIDDEN' });
  assert.throws(() => service.createAddress('farmer', { label: ' ', recipientName: 'Budi', phone: '0812345', addressLine: 'Jalan', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.setVisitAddress('farmer', 'farm-1', 'address-1'), { code: 'API_RESPONSE_INVALID' });
  assert.equal(writes, 0);
});
