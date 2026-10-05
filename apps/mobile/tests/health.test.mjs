import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthRecordService } from '../.test-build/src/application/HealthRecordService.js';
import { PatientService } from '../.test-build/src/application/PatientService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { selectHealthHistory, selectPatients, validateFarmerHealthReport } from '../.test-build/src/domain/health.js';
import { fixtureEntities, fixtureIds, fixtureRelations } from '../.test-build/src/testing/fixtures.js';

test('health report input rejects a doctor examination and normalizes an owner report', () => {
  const valid = validateFarmerHealthReport({
    kind: 'care',
    occurredAt: '2026-10-05T10:00:00+07:00',
    description: '  Perawatan   harian  ',
    operationKey: 'report-op-0001',
  });
  assert.equal(valid.occurredAt, '2026-10-05T03:00:00.000Z');
  assert.equal(valid.description, 'Perawatan harian');
  assert.throws(
    () => validateFarmerHealthReport({ kind: 'examination', occurredAt: '2026-10-05T03:00:00Z', description: 'Pemeriksaan dokter', operationKey: 'report-op-0002' }),
    { code: 'VALIDATION_FAILED' },
  );
  assert.throws(
    () => validateFarmerHealthReport({ kind: 'vaccine', occurredAt: 'invalid', description: 'Catatan', operationKey: 'report-op-0003' }),
    { code: 'VALIDATION_FAILED' },
  );
});

test('farmer timeline is scoped to the owned animal, includes only final doctor notes, and keeps farmer reports separate', async () => {
  const setup = makeServices();
  const beforeNote = await setup.repository.findById('clinicalNote', fixtureIds.finalNote);
  const input = {
    kind: 'care',
    occurredAt: '2026-10-05T03:00:00.000Z',
    description: 'Kandang dibersihkan.',
    operationKey: 'report-op-0004',
  };
  const added = await setup.health.addFarmerReport(fixtureIds.sari, fixtureIds.goat, input);
  const retried = await setup.health.addFarmerReport(fixtureIds.sari, fixtureIds.goat, input);
  const records = await setup.health.listForFarmer(fixtureIds.sari, fixtureIds.goat);

  assert.equal(added.id, retried.id);
  assert.equal(records.filter((item) => item.source === 'farmer_report' && item.description === input.description).length, 1);
  assert.equal(records.some((item) => item.id === fixtureIds.draftNote), false);
  assert.equal(records.filter((item) => item.id === fixtureIds.finalNote).length, 1);
  assert.equal(records.find((item) => item.id === fixtureIds.finalNote).source, 'clinical_note');
  assert.deepEqual(await setup.repository.findById('clinicalNote', fixtureIds.finalNote), beforeNote);
  assert.equal(setup.events.events.size, 1);
  await assert.rejects(
    setup.health.listForFarmer(fixtureIds.budi, fixtureIds.goat),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('patient list filters assigned consultations, deduplicates animals, and supports combined search/species filters', async () => {
  const setup = makeServices();
  const all = await setup.patients.list(fixtureIds.vetZero);
  assert.deepEqual(new Set(all.map((item) => item.id)), new Set([fixtureIds.cow, fixtureIds.goat]));
  assert.equal(all.find((item) => item.id === fixtureIds.cow).serviceCount, 2);
  assert.equal(all.find((item) => item.id === fixtureIds.goat).ownerName, 'Sari Lestari');
  assert.deepEqual(
    (await setup.patients.list(fixtureIds.vetZero, { query: 'SARI', species: 'goat' })).map((item) => item.id),
    [fixtureIds.goat],
  );
  assert.deepEqual(await setup.patients.list(fixtureIds.rani, { species: 'sheep' }), []);
});

test('patient detail and health history reject doctors without an assigned service', async () => {
  const setup = makeServices();
  const detail = await setup.patients.get(fixtureIds.vetZero, fixtureIds.cow);
  assert.equal(detail.patient.id, fixtureIds.cow);
  assert.equal(detail.patient.ownerId, fixtureIds.budi);
  assert.equal(detail.consultations.length, 2);
  assert.deepEqual(detail.history.map((item) => item.id), [fixtureIds.finalNotePending]);
  await assert.rejects(
    setup.patients.get('unrelated-vet', fixtureIds.cow),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    setup.health.listForVet('unrelated-vet', fixtureIds.cow),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

test('health media exposes only linked safe files and marks missing local paths unavailable', async () => {
  const setup = makeServices();
  const report = entity('report-with-media', 'healthEvent', fixtureIds.sari, fixtureIds.goat, {
    animalId: fixtureIds.goat,
    kind: 'vaccine',
    occurredAt: '2026-10-04T03:00:00.000Z',
    description: 'Catatan vaksin fiktif.',
    actorId: fixtureIds.sari,
    provenance: 'farmer_report',
  });
  const missingPhoto = entity('health-photo-missing', 'attachment', fixtureIds.sari, report.id, {
    kind: 'image', accessContext: 'health_record', mimeType: 'image/jpeg', filename: 'bukti.jpg', localUri: '',
  });
  setup.repository.add(report, { sourceId: report.id, relationship: 'animal', targetId: fixtureIds.goat });
  setup.repository.add(missingPhoto, { sourceId: report.id, relationship: 'attachment', targetId: missingPhoto.id });

  const visible = await setup.health.getAttachmentForVet(fixtureIds.vetZero, fixtureIds.goat, missingPhoto.id);
  assert.equal(visible.available, false);
  assert.equal(visible.uri, null);
  await assert.rejects(
    setup.health.getAttachmentForVet('unrelated-vet', fixtureIds.goat, missingPhoto.id),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    setup.health.getAttachmentForVet(fixtureIds.vetZero, fixtureIds.goat, 'unlinked-file'),
    (error) => error instanceof DomainError && error.code === 'NOT_FOUND',
  );
});

test('health history and patient selectors combine filters without changing source records', () => {
  const records = [record('vaccine', '2026-10-01T00:00:00.000Z'), record('care', '2026-10-03T00:00:00.000Z')];
  assert.deepEqual(selectHealthHistory(records, { kind: 'vaccine' }).map((item) => item.kind), ['vaccine']);
  const patients = [patient('cow-1', 'Mawar', 'cattle', 'Budi', '2026-10-02T00:00:00.000Z'), patient('goat-1', 'Luna', 'goat', 'Sari', '2026-10-03T00:00:00.000Z')];
  assert.deepEqual(selectPatients(patients, { query: 'sari', species: 'goat' }).map((item) => item.id), ['goat-1']);
  assert.deepEqual(records.map((item) => item.id), ['vaccine', 'care']);
});

function makeServices() {
  const repository = new MemoryDomainRepository(fixtureEntities, fixtureRelations);
  const events = new MemoryEventStore(repository);
  const livestock = {
    async get(userId, animalId) {
      const animal = await repository.findById('livestock', animalId);
      if (!animal || animal.ownerId !== userId) throw new DomainError('FORBIDDEN', 'Ternak bukan milik akun ini.');
      return { id: animal.id, farmId: animal.contextId, name: animal.payload.name };
    },
  };
  const profiles = {
    async load(userId, role) {
      const profile = await repository.findById('vetProfile', userId === fixtureIds.rani ? fixtureIds.raniProfile : fixtureIds.yudaProfile);
      if (role !== 'vet' || !profile || (userId !== fixtureIds.rani && userId !== fixtureIds.vetZero)) {
        if (userId !== 'unrelated-vet' || role !== 'vet') throw new DomainError('FORBIDDEN', 'Profil Dokter tidak tersedia.');
        return { role: 'vet', vet: { professionalName: 'Dokter Tak Terkait' } };
      }
      return { role: 'vet', vet: { professionalName: 'Dokter Fixture' } };
    },
  };
  const health = new HealthRecordService(repository, livestock, profiles, events, () => new Date('2026-10-05T04:00:00.000Z'));
  const patients = new PatientService(repository, profiles, health);
  return { repository, events, health, patients };
}

class MemoryDomainRepository {
  constructor(entities, relations) {
    this.entities = new Map(entities.map((item) => [item.id, structuredClone(item)]));
    this.relations = structuredClone(relations);
  }
  async findById(kind, id) { const item = this.entities.get(id); return item?.kind === kind ? structuredClone(item) : null; }
  async listByOwner(kind, ownerId) { return [...this.entities.values()].filter((item) => item.kind === kind && item.ownerId === ownerId).map((item) => structuredClone(item)); }
  async listByRelated(kind, relatedId, relationship) {
    return this.relations.filter((link) => link.relationship === relationship && link.targetId === relatedId)
      .map((link) => this.entities.get(link.sourceId)).filter((item) => item?.kind === kind).map((item) => structuredClone(item));
  }
  async listRelated(kind, id, relationship) {
    if (this.entities.get(id)?.kind !== kind) return [];
    return this.relations.filter((link) => link.sourceId === id && link.relationship === relationship)
      .map((link) => this.entities.get(link.targetId)).filter(Boolean).map((item) => structuredClone(item));
  }
  async create(item, relations = []) { this.add(item, ...relations); }
  async update(item) { this.entities.set(item.id, structuredClone(item)); }
  add(item, ...relations) {
    this.entities.set(item.id, structuredClone(item));
    this.relations.push(...structuredClone(relations));
  }
}

class MemoryEventStore {
  constructor(repository) { this.repository = repository; this.events = new Map(); }
  async transaction(work) {
    const transaction = {
      insertEventIfAbsent: async (event) => {
        if (this.events.has(event.id)) return false;
        this.events.set(event.id, structuredClone(event));
        return true;
      },
      findEvent: async (id) => structuredClone(this.events.get(id) ?? null),
      insertEffect: async (effect) => this.repository.add(effect.entity, ...(effect.relations ?? [])),
    };
    return work(transaction);
  }
}

function entity(id, kind, ownerId, contextId, payload) {
  return { id, kind, ownerId, contextId, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', version: 1, payload };
}

function record(kind, occurredAt) {
  return { id: kind, animalId: 'cow-1', kind, occurredAt, description: kind, actorId: 'farmer', actorName: 'Peternak', source: 'farmer_report', clinicalNote: null, attachments: [] };
}

function patient(id, name, species, ownerName, lastServiceAt) {
  return { id, name, displayCode: id, species, breed: 'Fiktif', sex: 'female', estimatedAgeMonths: 12, weightKg: null, ownerId: 'owner', ownerName, lastServiceAt, serviceCount: 1, photo: null };
}
