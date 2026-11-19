import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerVetDirectoryService, filterServerVets } from '../.test-build/src/application/ServerVetDirectoryService.js';

const vet = (id, name = 'Dokter Fiktif') => ({ id, professionalName: name, practiceLocation: 'Bandung', serviceAreas: ['Cimahi'], specialties: ['Sapi'], species: ['cattle'] });

test('server vet directory reads every opaque page only for farmers', async () => {
  const calls = [];
  const service = new ServerVetDirectoryService({
    search: async (query) => {
      calls.push(query);
      return query.cursor
        ? { items: [vet('vet-2')], hasMore: false, nextCursor: null }
        : { items: [vet('vet-1')], hasMore: true, nextCursor: 'opaque-next' };
    },
    getById: async () => ({}), getSlots: async () => [],
  });
  await assert.rejects(service.listVerified('vet'), { code: 'FORBIDDEN' });
  assert.deepEqual((await service.listVerified('farmer')).map(({ id }) => id), ['vet-1', 'vet-2']);
  assert.deepEqual(calls, [{ limit: 100 }, { limit: 100, cursor: 'opaque-next' }]);
});

test('server vet directory fails closed on repeated IDs/cursors and role guards detail and slots', async () => {
  const repeated = new ServerVetDirectoryService({
    search: async () => ({ items: [vet('same'), vet('same')], hasMore: false, nextCursor: null }),
    getById: async () => ({}), getSlots: async () => [],
  });
  await assert.rejects(repeated.listVerified('farmer'), { code: 'API_RESPONSE_INVALID' });
  const looping = new ServerVetDirectoryService({
    search: async () => ({ items: [], hasMore: true, nextCursor: 'same-cursor' }),
    getById: async () => ({}), getSlots: async () => [],
  });
  await assert.rejects(looping.listVerified('farmer'), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(repeated.getDetail('vet', 'vet-id'), { code: 'FORBIDDEN' });
  await assert.rejects(repeated.getSlots('vet', 'vet-id', 'chat', '2026-11-19', '2026-11-20'), { code: 'FORBIDDEN' });
});

test('server vet directory search filters name, service area, specialties and species', () => {
  const records = [vet('one', 'Dr. Sapi'), { ...vet('two', 'Dr. Kambing'), serviceAreas: ['Jakarta'], specialties: ['Kambing'], species: ['goat'] }];
  assert.deepEqual(filterServerVets(records, '  CIMAHI ').map(({ id }) => id), ['one']);
  assert.deepEqual(filterServerVets(records, 'kambing').map(({ id }) => id), ['two']);
  assert.deepEqual(filterServerVets(records, '').map(({ id }) => id), ['one', 'two']);
});
