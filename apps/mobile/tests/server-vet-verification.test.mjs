import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerVetVerificationService } from '../.test-build/src/application/ServerVetVerificationService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';

const userId = '10000000-0000-4000-8000-000000000001';
const key = '10000000-0000-4000-8000-000000000002';
const documentId = '10000000-0000-4000-8000-000000000003';
const file = { uri: 'file:///picked/document.pdf', filename: 'surat.pdf', mimeType: 'application/pdf', byteSize: 120 };
const document = { id: documentId, filename: file.filename, mimeType: file.mimeType, byteSize: file.byteSize };
const vetProfile = (verificationStatus = 'not_submitted') => ({
  role: 'vet', userId, fullName: 'Dokter', professionalName: null, registrationReference: null,
  verificationStatus, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z', version: 1,
});

function makeStore({ uploaded = [], pending = null } = {}) {
  const state = { uploaded: [...uploaded], pending, copied: [], removed: [], clearedUploaded: 0 };
  return {
    state,
    store: {
      copyToPrivateStorage: async (_user, selected) => { state.copied.push(selected); return { ...selected, uri: 'file:///private/document.pdf', byteSize: selected.byteSize ?? file.byteSize }; },
      removePrivateFile: async (uri) => { state.removed.push(uri); },
      readPendingUpload: async () => state.pending,
      writePendingUpload: async (_user, value) => { state.pending = value; },
      clearPendingUpload: async () => { state.pending = null; },
      listUploaded: async () => [...state.uploaded],
      appendUploaded: async (_user, value) => { if (!state.uploaded.some((row) => row.id === value.id)) state.uploaded.push(value); },
      clearUploaded: async () => { state.uploaded = []; state.clearedUploaded += 1; },
    },
  };
}

test('vet document upload persists private file and stable operation before network retry', async () => {
  const state = makeStore();
  const calls = [];
  let fail = true;
  const service = new ServerVetVerificationService({
    getVet: async () => vetProfile(),
    uploadProfessionalDocument: async (payload, idempotencyKey) => {
      calls.push({ payload, idempotencyKey });
      if (fail) { fail = false; throw new Error('network timeout'); }
      return document;
    },
  }, state.store, () => key);
  await assert.rejects(service.upload('vet', userId, file), /network timeout/);
  assert.equal(state.state.pending.idempotencyKey, key);
  assert.equal(state.state.pending.file.uri, 'file:///private/document.pdf');
  const uploaded = await service.upload('vet', userId);
  assert.deepEqual(uploaded, document);
  assert.deepEqual(calls.map((call) => call.idempotencyKey), [key, key]);
  assert.equal(state.state.pending, null);
  assert.deepEqual(state.state.uploaded, [document]);
  assert.deepEqual(state.state.removed, ['file:///private/document.pdf']);
});

test('vet document upload rejects unsupported roles, formats, size and fifth-plus files before network', async () => {
  const state = makeStore({ uploaded: Array.from({ length: 5 }, (_, index) => ({ ...document, id: `${documentId.slice(0, -1)}${index + 1}` })) });
  let uploads = 0;
  const service = new ServerVetVerificationService({
    getVet: async () => vetProfile(),
    uploadProfessionalDocument: async () => { uploads += 1; return document; },
  }, state.store, () => key);
  await assert.rejects(service.upload('farmer', userId, file), { code: 'FORBIDDEN' });
  await assert.rejects(service.upload('vet', userId, { ...file, mimeType: 'application/octet-stream' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.upload('vet', userId, { ...file, byteSize: 10 * 1024 * 1024 + 1 }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(service.upload('vet', userId, file), { code: 'VALIDATION_FAILED' });
  assert.equal(uploads, 0);
  assert.equal(state.state.copied.length, 0);
});

test('vet verification submits uploaded IDs and clears staged selection only after pending response', async () => {
  const state = makeStore({ uploaded: [document] });
  let submissionCalls = 0;
  const service = new ServerVetVerificationService({
    getVet: async () => vetProfile(),
    submitVerification: async (ids) => { submissionCalls += 1; return { id: key, documentIds: ids, status: 'pending', reviewerReason: null, submittedAt: '2026-11-19T00:00:00.000Z', reviewedAt: null, version: 1 }; },
  }, state.store, () => key);
  const submission = await service.submit('vet', userId);
  assert.equal(submission.status, 'pending');
  assert.deepEqual(state.state.uploaded, []);
  assert.equal(state.state.clearedUploaded, 1);
  assert.equal(submissionCalls, 1);
});

test('vet verification blocks duplicate submission while review is pending and retains local documents', async () => {
  const state = makeStore({ uploaded: [document] });
  let submissionCalls = 0;
  const service = new ServerVetVerificationService({
    getVet: async () => vetProfile('pending'),
    submitVerification: async () => { submissionCalls += 1; throw new Error('must not run'); },
  }, state.store, () => key);
  await assert.rejects(service.submit('vet', userId), { code: 'INVALID_STATE' });
  assert.equal(submissionCalls, 0);
  assert.deepEqual(state.state.uploaded, [document]);
});

test('vet document retry reconciles the same ID after local staging reached five documents', async () => {
  const priorDocuments = Array.from({ length: 4 }, (_, index) => ({ ...document, id: `${documentId.slice(0, -1)}${index + 4}` }));
  const state = makeStore({ uploaded: priorDocuments });
  let failAfterWrite = true;
  const store = {
    ...state.store,
    appendUploaded: async (_user, value) => {
      if (!state.state.uploaded.some((row) => row.id === value.id)) state.state.uploaded.push(value);
      if (failAfterWrite) { failAfterWrite = false; throw new Error('secure storage acknowledgement lost'); }
    },
  };
  const calls = [];
  const service = new ServerVetVerificationService({
    getVet: async () => vetProfile(),
    uploadProfessionalDocument: async (payload, idempotencyKey) => { calls.push({ payload, idempotencyKey }); return document; },
  }, store, () => key);
  await assert.rejects(service.upload('vet', userId, file), /secure storage acknowledgement lost/);
  assert.equal(state.state.uploaded.length, 5);
  assert.equal(state.state.pending.idempotencyKey, key);
  assert.deepEqual(await service.upload('vet', userId), document);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.idempotencyKey), [key, key]);
  assert.equal(state.state.uploaded.length, 5);
  assert.equal(state.state.pending, null);
});

test('vet document definitive server rejection clears its private retry operation', async () => {
  const state = makeStore();
  const rejected = new ServerVetVerificationService({
    getVet: async () => vetProfile(),
    uploadProfessionalDocument: async () => { throw new DomainError('VALIDATION_FAILED', 'format rejected'); },
  }, state.store, () => key);
  await assert.rejects(rejected.upload('vet', userId, file), /format rejected/);
  assert.equal(state.state.pending, null);
  assert.deepEqual(state.state.removed, ['file:///private/document.pdf']);
  assert.equal(await state.store.readPendingUpload(userId), null);
});
