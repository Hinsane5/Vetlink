import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerPatientService, filterServerPatients } from '../.test-build/src/application/ServerPatientService.js';

const patient = (id, name = 'Bintang') => ({ id, name, displayCode: 'S-01', species: 'Sapi', ownerName: 'Peternak Fiktif' });
const noHealth = { listHealthEvents: async () => [] };
const noClinicalNotes = { listFinalNotes: async () => [] };

test('server patient use case calls the assigned list only for veterinarian role', async () => {
  let reads = 0;
  const service = new ServerPatientService({ listPatients: async () => { reads++; return [patient('one')]; } }, noHealth, noClinicalNotes);
  await assert.rejects(service.listAssigned('farmer'), { code: 'FORBIDDEN' });
  assert.equal(reads, 0);
  assert.deepEqual(await service.listAssigned('vet'), [patient('one')]);
  assert.equal(reads, 1);
});

test('server patient use case rejects duplicate IDs and filters the same scoped records', async () => {
  const service = new ServerPatientService({ listPatients: async () => [patient('one'), patient('one', 'Awan')] }, noHealth, noClinicalNotes);
  await assert.rejects(service.listAssigned('vet'), { code: 'API_RESPONSE_INVALID' });
  const records = [patient('one'), { ...patient('two', 'Awan'), displayCode: 'K-02', species: 'Kambing' }];
  assert.deepEqual(filterServerPatients(records, '  AWAN  ').map(({ id }) => id), ['two']);
  assert.deepEqual(filterServerPatients(records, 'K-02').map(({ id }) => id), ['two']);
  assert.deepEqual(filterServerPatients(records, 'Peternak fiktif').map(({ id }) => id), ['one', 'two']);
});

test('server patient detail checks assigned membership before loading its health timeline', async () => {
  const assigned = { ...patient('animal-1'), farmerId: 'farmer-1', farmId: 'farm-1' };
  const event = { id: 'event-1', kind: 'examination', occurredAt: '2026-11-19T01:00:00.000Z', description: 'Catatan final', provenance: 'clinical_note', createdAt: '2026-11-19T01:00:00.000Z' };
  const calls = [];
  const finalNote = { id: 'note-1', consultationId: 'consultation-1', complaint: 'Keluhan fiktif', findings: 'Temuan fiktif', assessment: 'Penilaian fiktif', actions: 'Tindakan fiktif', careInstructions: 'Instruksi fiktif', finalizedAt: '2026-11-19T01:00:00.000Z' };
  const noteCalls = [];
  const service = new ServerPatientService(
    { listPatients: async () => [assigned] },
    { listHealthEvents: async (animalId) => { calls.push(animalId); return [event]; } },
    { listFinalNotes: async (animalId) => { noteCalls.push(animalId); return [finalNote]; } },
  );
  await assert.rejects(service.getAssignedDetail('farmer', assigned.id), { code: 'FORBIDDEN' });
  await assert.rejects(service.getAssignedDetail('vet', 'unassigned-animal'), { code: 'NOT_FOUND' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await service.getAssignedDetail('vet', assigned.id), { patient: assigned, events: [event], clinicalNotes: [finalNote] });
  assert.deepEqual(calls, [assigned.id]);
  assert.deepEqual(noteCalls, [assigned.id]);
});

test('server patient detail rejects duplicate timeline IDs', async () => {
  const assigned = patient('animal-1');
  const event = { id: 'event-1' };
  const service = new ServerPatientService(
    { listPatients: async () => [assigned] },
    { listHealthEvents: async () => [event, event] },
    noClinicalNotes,
  );
  await assert.rejects(service.getAssignedDetail('vet', assigned.id), { code: 'API_RESPONSE_INVALID' });
});

test('server patient detail validates scoped media records and downloads them privately', async () => {
  const assigned = { ...patient('animal-1'), farmerId: 'farmer-1', farmId: 'farm-1' };
  const media = {
    id: 'media-1', consultationId: 'consultation-1', recordId: 'report-1', source: 'progress_report',
    kind: 'image', mimeType: 'image/jpeg', filename: 'foto-fiktif.jpg', byteSize: 1234,
    url: '/v1/attachments/media-1/content', createdAt: '2026-11-19T01:00:00.000Z',
  };
  const stored = [];
  const service = new ServerPatientService(
    { listPatients: async () => [assigned] }, noHealth, noClinicalNotes,
    { listForPatient: async () => [media] },
    { download: async (id) => ({ attachment: { ...media, uploadStatus: 'committed' }, bytes: new ArrayBuffer(4) }) },
    { storeDownloadedFile: async (userId, attachment, bytes) => { stored.push({ userId, attachment, bytes }); return 'file:///private/foto-fiktif.jpg'; } },
  );

  assert.deepEqual((await service.getAssignedDetail('vet', assigned.id)).media, [media]);
  await assert.rejects(service.downloadPatientMedia('farmer', 'farmer-1', media), { code: 'FORBIDDEN' });
  assert.equal(await service.downloadPatientMedia('vet', 'vet-1', media), 'file:///private/foto-fiktif.jpg');
  assert.equal(stored[0].userId, 'vet-1');
  assert.equal(stored[0].attachment.id, media.id);
  assert.equal(stored[0].bytes.byteLength, 4);
});

test('server patient detail rejects duplicate media IDs and mismatched private download metadata', async () => {
  const assigned = { ...patient('animal-1'), farmerId: 'farmer-1', farmId: 'farm-1' };
  const media = {
    id: 'media-1', consultationId: 'consultation-1', recordId: 'message-1', source: 'message',
    kind: 'image', mimeType: 'image/jpeg', filename: 'foto-fiktif.jpg', byteSize: 1234,
    url: '/v1/attachments/media-1/content', createdAt: '2026-11-19T01:00:00.000Z',
  };
  const duplicateService = new ServerPatientService(
    { listPatients: async () => [assigned] }, noHealth, noClinicalNotes,
    { listForPatient: async () => [media, media] },
  );
  await assert.rejects(duplicateService.getAssignedDetail('vet', assigned.id), { code: 'API_RESPONSE_INVALID' });
  const mismatchService = new ServerPatientService(
    { listPatients: async () => [assigned] }, noHealth, noClinicalNotes,
    { listForPatient: async () => [media] },
    { download: async (id) => ({ attachment: { ...media, id: `${id}-other`, uploadStatus: 'committed' }, bytes: new ArrayBuffer(4) }) },
    { storeDownloadedFile: async () => 'file:///private/unused.jpg' },
  );
  await assert.rejects(mismatchService.downloadPatientMedia('vet', 'vet-1', media), { code: 'API_RESPONSE_INVALID' });
});

test('server patient rejects malformed clinical note projections', async () => {
  const assigned = { ...patient('animal-1'), farmerId: 'farmer-1', farmId: 'farm-1' };
  const service = new ServerPatientService(
    { listPatients: async () => [assigned] },
    noHealth,
    { listFinalNotes: async () => [{ id: 'note-1', consultationId: '', finalizedAt: 'not-a-date' }] },
  );
  await assert.rejects(service.getAssignedDetail('vet', assigned.id), { code: 'API_RESPONSE_INVALID' });
});
