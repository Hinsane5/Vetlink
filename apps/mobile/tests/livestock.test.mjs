import assert from 'node:assert/strict';
import test from 'node:test';
import { LivestockService } from '../.test-build/src/application/LivestockService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { selectLivestock, validateLivestockInput } from '../.test-build/src/domain/livestock.js';

const input = {
  displayCode: ' bud-02 ',
  name: '  Melati  ',
  species: 'cattle',
  breed: 'Sapi lokal fiktif',
  sex: 'female',
  estimatedAgeMonths: 18,
  weightKg: 215.5,
};

test('livestock input is normalized and validates ID, age, sex, species, and weight', () => {
  assert.equal(validateLivestockInput(input).displayCode, 'BUD-02');
  assert.equal(validateLivestockInput(input).name, 'Melati');
  for (const invalid of [
    { ...input, displayCode: '!' },
    { ...input, estimatedAgeMonths: -1 },
    { ...input, estimatedAgeMonths: 2.5 },
    { ...input, sex: 'unknown-ish' },
    { ...input, species: 'dragon' },
    { ...input, weightKg: 0 },
    { ...input, weightKg: Number.NaN },
  ]) {
    assert.throws(() => validateLivestockInput(invalid), (error) => error instanceof DomainError && error.code === 'VALIDATION_FAILED');
  }
});

test('search and species/sex filters combine and return stable name order', () => {
  const items = [
    snapshot('animal-3', 'Zeta', 'BUD-03', 'female', 'Kembang'),
    snapshot('animal-2', 'Mawar', 'BUD-02', 'female', 'Sapi lokal'),
    snapshot('animal-1', 'Mawar', 'BUD-01', 'male', 'Sapi lokal'),
  ];
  const selected = selectLivestock(items, { query: ' sapi ', species: 'cattle', sex: 'female' });
  assert.deepEqual(selected.map((item) => item.id), ['animal-2']);
  assert.deepEqual(selectLivestock(items, { query: 'bud-0' }).map((item) => item.id), ['animal-1', 'animal-2', 'animal-3']);
});

test('farmer list and ID detail stay scoped to the active owner and farm', async () => {
  const setup = makeService();
  const visible = await setup.service.list('farmer-1');
  assert.deepEqual(visible.map((item) => item.id), ['animal-1']);
  assert.equal((await setup.service.get('farmer-1', 'animal-1')).name, 'Mawar');
  await assert.rejects(
    setup.service.get('farmer-1', 'animal-foreign'),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('create persists a unique farm ID, data, and locally stored photo in one commit', async () => {
  const setup = makeService();
  const photo = { type: 'new', asset: { uri: 'picker://new-photo', filename: 'melati.jpg', mimeType: 'image/jpeg', byteSize: 234, kind: 'image' } };
  const created = await setup.service.create('farmer-1', input, photo);

  assert.equal(created.id, 'generated-1');
  assert.equal(created.displayCode, 'BUD-02');
  assert.equal(created.photo.filename, 'melati.jpg');
  assert.equal(setup.repository.lastCommit.creates.filter((item) => item.entity.kind === 'livestock').length, 1);
  const changes = setup.repository.lastCommit;
  const animal = changes.creates.find((item) => item.entity.kind === 'livestock').entity;
  const attachment = changes.creates.find((item) => item.entity.kind === 'attachment').entity;
  assert.deepEqual(animal.payload.photoAttachmentIds, [attachment.id]);
  assert.equal(attachment.payload.accessContext, 'livestock');
  assert.equal(attachment.contextId, animal.id);
  assert.ok(changes.creates.find((item) => item.entity.kind === 'livestock').relations.some((link) => link.relationship === 'farm' && link.targetId === 'farm-1'));
  assert.ok(changes.creates.find((item) => item.entity.kind === 'livestock').relations.some((link) => link.relationship === 'photo' && link.targetId === attachment.id));
  await assert.rejects(
    setup.service.create('farmer-1', { ...input, displayCode: 'BUD-01' }),
    (error) => error instanceof DomainError && error.code === 'VALIDATION_FAILED',
  );
});

test('edit updates the same animal version, preserves ownership links, and can clear its photo', async () => {
  const setup = makeService({ withPhoto: true });
  const updated = await setup.service.update('farmer-1', 'animal-1', { ...input, displayCode: 'BUD-01', weightKg: 228 }, null);
  assert.equal(updated.id, 'animal-1');
  assert.equal(updated.weightKg, 228);
  assert.equal(updated.photo, null);
  const change = setup.repository.lastCommit.updates[0];
  assert.equal(change.expectedVersion, 1);
  assert.equal(change.entity.version, 2);
  assert.deepEqual(change.entity.payload.photoAttachmentIds, []);
  assert.deepEqual(change.relations.map((link) => link.relationship), ['farmer', 'farm']);
});

test('profile species constrain creation and photo selection cannot attach a document', async () => {
  const setup = makeService();
  await assert.rejects(
    setup.service.create('farmer-1', { ...input, species: 'goat' }),
    (error) => error instanceof DomainError && error.code === 'VALIDATION_FAILED',
  );
  await assert.rejects(
    setup.service.create('farmer-1', input, { type: 'new', asset: { uri: 'picker://file', filename: 'doc.pdf', mimeType: 'application/pdf', byteSize: 12, kind: 'document' } }),
    (error) => error instanceof DomainError && error.code === 'VALIDATION_FAILED',
  );
});

function makeService({ withPhoto = false } = {}) {
  const farmer = entity('farmer-1', 'user', null, { name: 'Peternak Satu' });
  const farm = entity('farm-1', 'farm', farmer.id, { species: ['cattle'] });
  const profile = entity('profile-1', 'farmerProfile', farmer.id, { farmId: farm.id });
  const otherFarmer = entity('farmer-2', 'user', null, { name: 'Peternak Dua' });
  const otherFarm = entity('farm-2', 'farm', otherFarmer.id, { species: ['goat'] });
  const cow = entity('animal-1', 'livestock', farmer.id, { ...input, displayCode: 'BUD-01', name: 'Mawar', species: 'cattle', breed: 'Sapi lokal', photoAttachmentIds: withPhoto ? ['photo-1'] : [] }, farm.id);
  const foreignCow = entity('animal-foreign', 'livestock', otherFarmer.id, { ...input, displayCode: 'SAR-01', species: 'goat', name: 'Luna' }, otherFarm.id);
  const photo = entity('photo-1', 'attachment', farmer.id, { kind: 'image', accessContext: 'livestock', localUri: 'private://photo-1', filename: 'mawar.jpg', mimeType: 'image/jpeg', byteSize: 100 }, cow.id);
  const records = [farmer, farm, profile, otherFarmer, otherFarm, cow, foreignCow, ...(withPhoto ? [photo] : [])];
  const relations = [
    link(cow.id, 'farmer', farmer.id), link(cow.id, 'farm', farm.id),
    link(foreignCow.id, 'farmer', otherFarmer.id), link(foreignCow.id, 'farm', otherFarm.id),
    ...(withPhoto ? [link(cow.id, 'photo', photo.id)] : []),
  ];
  const domainRepository = new MemoryDomainRepository(records, relations);
  const repository = new MemoryProfileRepository({
    user: farmer,
    profile,
    farm,
    address: null,
    submissions: [],
    attachments: withPhoto ? [photo] : [],
    drafts: [],
    profileRelations: [link(profile.id, 'user', farmer.id), link(profile.id, 'farm', farm.id)],
    farmRelations: [],
  }, domainRepository);
  let nextId = 0;
  const media = {
    pickPhoto: async () => null,
    pickDocuments: async () => [],
    store: async (asset, id) => ({ localUri: `private://${id}`, filename: asset.filename, mimeType: asset.mimeType, byteSize: asset.byteSize ?? 0 }),
    remove: async () => {},
  };
  const service = new LivestockService(domainRepository, repository, media, { create: () => `generated-${++nextId}` }, () => new Date('2026-10-05T00:00:00.000Z'));
  return { service, domainRepository, repository };
}

class MemoryDomainRepository {
  constructor(entities, relations) {
    this.entities = new Map(entities.map((item) => [item.id, structuredClone(item)]));
    this.relations = structuredClone(relations);
  }
  async findById(kind, id) { const item = this.entities.get(id); return item?.kind === kind ? structuredClone(item) : null; }
  async listByRelated(kind, relatedId, relationship) {
    return this.relations.filter((item) => item.relationship === relationship && item.targetId === relatedId)
      .map((item) => this.entities.get(item.sourceId)).filter((item) => item?.kind === kind).map((item) => structuredClone(item));
  }
  async listRelated(kind, id, relationship) {
    const source = this.entities.get(id);
    if (source?.kind !== kind) return [];
    return this.relations.filter((item) => item.sourceId === id && item.relationship === relationship)
      .map((item) => this.entities.get(item.targetId)).filter(Boolean).map((item) => structuredClone(item));
  }
}

class MemoryProfileRepository {
  constructor(aggregate, domainRepository) { this.aggregate = structuredClone(aggregate); this.domainRepository = domainRepository; this.lastCommit = null; }
  async loadProfile(userId, role) {
    if (userId !== this.aggregate.user.id || role !== 'farmer') throw new DomainError('FORBIDDEN', 'Profil tidak tersedia.');
    return structuredClone(this.aggregate);
  }
  async commit(changes) {
    this.lastCommit = { creates: [...(changes.creates ?? [])], updates: [...(changes.updates ?? [])] };
    for (const { entity: created, relations = [] } of this.lastCommit.creates) {
      this.domainRepository.entities.set(created.id, structuredClone(created));
      this.domainRepository.relations.push(...structuredClone(relations));
    }
    for (const { entity: updated, relations } of this.lastCommit.updates) {
      this.domainRepository.entities.set(updated.id, structuredClone(updated));
      if (relations) {
        this.domainRepository.relations = this.domainRepository.relations.filter((item) => item.sourceId !== updated.id);
        this.domainRepository.relations.push(...structuredClone(relations));
      }
    }
  }
}

function snapshot(id, name, displayCode, sex, breed) {
  return { id, farmId: 'farm-1', name, displayCode, species: 'cattle', breed, sex, estimatedAgeMonths: 12, weightKg: 100, photo: null, createdAt: '', updatedAt: '' };
}

function entity(id, kind, ownerId, payload, contextId = null) {
  return { id, kind, ownerId, contextId, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', version: 1, payload };
}

function link(sourceId, relationship, targetId) { return { sourceId, relationship, targetId }; }
