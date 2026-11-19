import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerPatientService, filterServerPatients } from '../.test-build/src/application/ServerPatientService.js';

const patient = (id, name = 'Bintang') => ({ id, name, displayCode: 'S-01', species: 'Sapi', ownerName: 'Peternak Fiktif' });

test('server patient use case calls the assigned list only for veterinarian role', async () => {
  let reads = 0;
  const service = new ServerPatientService({ listPatients: async () => { reads++; return [patient('one')]; } });
  await assert.rejects(service.listAssigned('farmer'), { code: 'FORBIDDEN' });
  assert.equal(reads, 0);
  assert.deepEqual(await service.listAssigned('vet'), [patient('one')]);
  assert.equal(reads, 1);
});

test('server patient use case rejects duplicate IDs and filters the same scoped records', async () => {
  const service = new ServerPatientService({ listPatients: async () => [patient('one'), patient('one', 'Awan')] });
  await assert.rejects(service.listAssigned('vet'), { code: 'API_RESPONSE_INVALID' });
  const records = [patient('one'), { ...patient('two', 'Awan'), displayCode: 'K-02', species: 'Kambing' }];
  assert.deepEqual(filterServerPatients(records, '  AWAN  ').map(({ id }) => id), ['two']);
  assert.deepEqual(filterServerPatients(records, 'K-02').map(({ id }) => id), ['two']);
  assert.deepEqual(filterServerPatients(records, 'Peternak fiktif').map(({ id }) => id), ['one', 'two']);
});
