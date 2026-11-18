import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerLivestockService, filterServerLivestock } from '../.test-build/src/application/ServerLivestockService.js';

const farm = { id: 'farm-a', species: ['cattle'] };
const animal = (id, farmId, farmerId = 'farmer-a') => ({ id, farmId, farmerId });

test('server livestock use case reads every page and selects only the chosen Farm', async () => {
  const calls = [];
  const service = new ServerLivestockService(
    { getFarmById: async (id) => { calls.push(['farm', id]); return farm; } },
    { listPage: async (query) => {
      calls.push(['page', query]);
      return query.cursor
        ? { items: [animal('animal-3', 'farm-a')], hasMore: false, nextCursor: null }
        : { items: [animal('animal-1', 'farm-b'), animal('animal-2', 'farm-a')], hasMore: true, nextCursor: 'next' };
    } },
    { create: async () => { throw new Error('unexpected write'); } },
  );
  assert.deepEqual((await service.listForFarm('farmer', 'farmer-a', 'farm-a')).map(({ id }) => id), ['animal-2', 'animal-3']);
  assert.deepEqual(calls, [['farm', 'farm-a'], ['page', { limit: 100 }], ['page', { limit: 100, cursor: 'next' }]]);
});

test('server livestock use case rejects role, foreign Farm, and incompatible species before write', async () => {
  let reads = 0;
  let writes = 0;
  const service = new ServerLivestockService(
    { getFarmById: async (id) => { reads++; if (id !== 'farm-a') throw new Error('not owned'); return farm; } },
    { listPage: async () => { throw new Error('unexpected list'); } },
    { create: async () => { writes++; return {}; } },
  );
  const input = { displayCode: 'A-1', name: 'Sapi A', species: 'cattle', sex: 'female' };
  await assert.rejects(service.listForFarm('vet', 'vet-a', 'farm-a'), { code: 'FORBIDDEN' });
  await assert.rejects(service.create('vet', 'farm-a', input), { code: 'FORBIDDEN' });
  await assert.rejects(service.create('farmer', 'farm-b', input), /not owned/);
  await assert.rejects(service.create('farmer', 'farm-a', { ...input, species: 'goat' }), { code: 'VALIDATION_FAILED' });
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});

test('server livestock create normalizes code and name for an owned Farm', async () => {
  let written;
  const service = new ServerLivestockService(
    { getFarmById: async () => farm },
    { listPage: async () => { throw new Error('unexpected list'); } },
    { create: async (value) => { written = value; return { id: 'animal-a', ...value }; } },
  );
  const created = await service.create('farmer', 'farm-a', { displayCode: ' a-1 ', name: '  Sapi   A ', species: 'cattle', sex: 'female' });
  assert.equal(created.id, 'animal-a');
  assert.deepEqual(written, { farmId: 'farm-a', displayCode: 'A-1', name: 'Sapi A', species: 'cattle', sex: 'female' });
});

test('server livestock pagination fails closed on duplicate IDs or foreign owner', async () => {
  for (const badItem of [animal('animal-a', 'farm-a', 'other'), animal('animal-a', 'farm-a')]) {
    let page = 0;
    const service = new ServerLivestockService(
      { getFarmById: async () => farm },
      { listPage: async () => page++ === 0
        ? { items: [animal('animal-a', 'farm-a')], hasMore: true, nextCursor: 'next' }
        : { items: [badItem], hasMore: false, nextCursor: null } },
      { create: async () => { throw new Error('unexpected write'); } },
    );
    await assert.rejects(service.listForFarm('farmer', 'farmer-a', 'farm-a'), { code: 'API_RESPONSE_INVALID' });
  }
});

test('server livestock search and species filter combine over the same server page results', () => {
  const items = [
    { ...animal('one', 'farm-a'), displayCode: 'S-01', name: 'Bintang', breed: 'Brahman', species: 'cattle' },
    { ...animal('two', 'farm-a'), displayCode: 'K-02', name: 'Bintang', breed: 'Etawa', species: 'goat' },
    { ...animal('three', 'farm-a'), displayCode: 'S-03', name: 'Awan', breed: null, species: 'cattle' },
  ];
  assert.deepEqual(filterServerLivestock(items, { query: '  bintang  ', species: 'cattle' }).map(({ id }) => id), ['one']);
  assert.deepEqual(filterServerLivestock(items, { query: 'K-02', species: 'cattle' }), []);
  assert.deepEqual(filterServerLivestock(items, { query: 'sapi' }).map(({ id }) => id), ['one', 'three']);
});
