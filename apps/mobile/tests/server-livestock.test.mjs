import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerLivestockService, filterServerLivestock } from '../.test-build/src/application/ServerLivestockService.js';
import { ServerLivestockHealthService } from '../.test-build/src/application/ServerLivestockHealthService.js';

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

test('server health detail reads latest owned livestock before its timeline', async () => {
  const calls = [];
  const livestock = new ServerLivestockService(
    { getFarmById: async (id) => { calls.push(['farm', id]); return farm; } },
    { getById: async (id) => { calls.push(['animal', id]); return animal(id, 'farm-a'); } },
    {},
  );
  const service = new ServerLivestockHealthService(livestock, {
    listHealthEvents: async (id) => { calls.push(['health', id]); return [{ id: 'event-a' }]; },
  });
  const detail = await service.getDetail('farmer', 'farmer-a', 'farm-a', 'animal-a');
  assert.equal(detail.animal.id, 'animal-a');
  assert.deepEqual(detail.events, [{ id: 'event-a' }]);
  assert.deepEqual(calls, [['farm', 'farm-a'], ['animal', 'animal-a'], ['health', 'animal-a']]);
});

test('server health detail does not request timeline across role, Farm, owner or ID boundary', async () => {
  let healthReads = 0;
  const livestock = new ServerLivestockService(
    { getFarmById: async () => farm },
    { getById: async (id) => animal(id, 'farm-b', 'other') },
    {},
  );
  const service = new ServerLivestockHealthService(livestock, {
    listHealthEvents: async () => { healthReads++; return []; },
  });
  await assert.rejects(service.getDetail('vet', 'vet-a', 'farm-a', 'animal-a'), { code: 'FORBIDDEN' });
  await assert.rejects(service.getDetail('farmer', 'farmer-a', 'farm-a', 'animal-a'), { code: 'FORBIDDEN' });
  assert.equal(healthReads, 0);
});

test('server care report persists exact payload before POST and replays it after an uncertain response', async () => {
  const storage = new Map();
  const journal = {
    read: async (userId, livestockId) => storage.get(`${userId}:${livestockId}`) ?? null,
    write: async (userId, livestockId, input) => { storage.set(`${userId}:${livestockId}`, input); },
    clear: async (userId, livestockId) => { storage.delete(`${userId}:${livestockId}`); },
  };
  const livestock = new ServerLivestockService(
    { getFarmById: async () => farm },
    { getById: async (id) => animal(id, 'farm-a') },
    {},
  );
  const calls = [];
  let first = true;
  const care = { createCareEvent: async (id, input) => {
    calls.push([id, { ...input }, storage.get('farmer-a:animal-a')]);
    if (first) { first = false; throw new Error('network response lost'); }
    return { id: 'event-a', kind: input.kind, occurredAt: input.occurredAt, description: input.description, provenance: 'farmer_report' };
  } };
  const makeService = () => new ServerLivestockHealthService(livestock, { listHealthEvents: async () => [] }, care, journal, () => 'report-key-123', () => '2026-11-18T00:00:00.000Z');
  await assert.rejects(makeService().createReport('farmer', 'farmer-a', 'farm-a', 'animal-a', 'care', '  Teramati sehat  '), /network response lost/);
  const pending = await makeService().getPendingReport('farmer', 'farmer-a', 'farm-a', 'animal-a');
  assert.deepEqual(pending, { kind: 'care', description: 'Teramati sehat', occurredAt: '2026-11-18T00:00:00.000Z', sourceKey: 'report-key-123' });
  await assert.rejects(makeService().createReport('farmer', 'farmer-a', 'farm-a', 'animal-a', 'care', 'Berbeda'), { code: 'INVALID_STATE' });
  const saved = await makeService().retryPendingReport('farmer', 'farmer-a', 'farm-a', 'animal-a');
  assert.equal(saved.id, 'event-a');
  assert.equal(storage.size, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], calls[1][1]);
  assert.deepEqual(calls[0][1], calls[0][2]);
});

test('server care report rejects invalid input and foreign owner before storing or POST', async () => {
  let writes = 0;
  const storage = { read: async () => null, write: async () => { writes++; }, clear: async () => {} };
  const care = { createCareEvent: async () => { throw new Error('unexpected POST'); } };
  const owned = new ServerLivestockService({ getFarmById: async () => farm }, { getById: async (id) => animal(id, 'farm-a') }, {});
  const foreign = new ServerLivestockService({ getFarmById: async () => farm }, { getById: async (id) => animal(id, 'farm-a', 'other') }, {});
  const service = new ServerLivestockHealthService(owned, { listHealthEvents: async () => [] }, care, storage, () => 'report-key-123');
  await assert.rejects(service.createReport('farmer', 'farmer-a', 'farm-a', 'animal-a', 'care', ' '), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.createReport('vet', 'vet-a', 'farm-a', 'animal-a', 'care', 'Report'), { code: 'FORBIDDEN' });
  await assert.rejects(new ServerLivestockHealthService(foreign, { listHealthEvents: async () => [] }, care, storage).createReport('farmer', 'farmer-a', 'farm-a', 'animal-a', 'care', 'Report'), { code: 'FORBIDDEN' });
  assert.equal(writes, 0);
});

test('server livestock edit verifies fresh ownership/version before PATCH and validates saved scope', async () => {
  let writes = 0;
  const livestock = new ServerLivestockService(
    { getFarmById: async () => farm },
    { getById: async (id) => ({ ...animal(id, 'farm-a'), version: 2 }) },
    { update: async (id, input) => { writes++; assert.equal(id, 'animal-a'); assert.deepEqual(input, { expectedVersion: 2, name: 'Sapi Baru', breed: null, sex: 'female' }); return { ...animal(id, 'farm-a'), version: 3 }; } },
  );
  const patch = { expectedVersion: 2, name: '  Sapi   Baru ', breed: null, sex: 'female' };
  await assert.rejects(livestock.update('vet', 'vet-a', 'farm-a', 'animal-a', patch), { code: 'FORBIDDEN' });
  await assert.rejects(livestock.update('farmer', 'farmer-a', 'farm-a', 'animal-a', { ...patch, expectedVersion: 1 }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(livestock.update('farmer', 'farmer-a', 'farm-a', 'animal-a', { ...patch, name: ' ' }), { code: 'VALIDATION_FAILED' });
  assert.equal(writes, 0);
  const saved = await livestock.update('farmer', 'farmer-a', 'farm-a', 'animal-a', patch);
  assert.equal(saved.version, 3);
  assert.equal(writes, 1);
});

test('server livestock edit rejects a changed owner or non-incremented server response', async () => {
  for (const result of [
    { ...animal('animal-a', 'farm-a', 'other'), version: 3 },
    { ...animal('animal-a', 'farm-a'), version: 2 },
  ]) {
    const livestock = new ServerLivestockService(
      { getFarmById: async () => farm },
      { getById: async (id) => ({ ...animal(id, 'farm-a'), version: 2 }) },
      { update: async () => result },
    );
    await assert.rejects(livestock.update('farmer', 'farmer-a', 'farm-a', 'animal-a', { expectedVersion: 2, name: 'Sapi Baru' }), { code: 'API_RESPONSE_INVALID' });
  }
});
