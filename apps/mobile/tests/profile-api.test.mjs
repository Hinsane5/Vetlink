import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiProfileRepository } from '../.test-build/src/data/remote/HttpApiProfileRepository.js';

const id = {
  user: '11111111-1111-4111-8111-111111111111',
  document: '22222222-2222-4222-8222-222222222222',
  submission: '33333333-3333-4333-8333-333333333333',
};
const at = '2026-11-18T01:00:00.000Z';
const farmer = { id: id.user, user_id: id.user, fullName: 'Budi Fiktif',
  created_at: at, updated_at: at, version: 1 };
const vet = { ...farmer, fullName: 'Dokter Fiktif', professional_name: 'Dokter Fiktif',
  registration_reference: null, verification_status: 'pending' };
const submission = { id: id.submission, documentIds: [id.document], status: 'pending',
  reviewerReason: null, submittedAt: at, reviewedAt: null, version: 1 };

test('farmer and vet profile reads normalize raw BE-02 fields; writes allowlist editable fields', async () => {
  const calls = [];
  const repository = new HttpApiProfileRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return response(200, url.endsWith('/farmer') ? farmer : vet);
  }));
  assert.equal((await repository.getFarmer()).userId, id.user);
  assert.equal((await repository.patchFarmer({ fullName: 'Budi Fiktif', verified: true })).role, 'farmer');
  assert.equal((await repository.getVet()).verificationStatus, 'pending');
  assert.equal((await repository.patchVet({ fullName: 'Dokter Fiktif', verificationStatus: 'verified' })).verificationStatus, 'pending');
  assert.deepEqual(JSON.parse(calls[1].init.body), { fullName: 'Budi Fiktif' });
  assert.deepEqual(JSON.parse(calls[3].init.body), { fullName: 'Dokter Fiktif' });
});

test('verification read and submit parse distinct response shapes without granting verified state', async () => {
  const calls = [];
  const repository = new HttpApiProfileRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    return init.method === 'POST'
      ? response(201, { id: id.submission, document_ids: [id.document], status: 'pending',
        reviewer_reason: null, submitted_at: at, reviewed_at: null, version: 1 })
      : response(200, [submission]);
  }));
  assert.equal((await repository.listVerification())[0].status, 'pending');
  const created = await repository.submitVerification([id.document]);
  assert.equal(created.status, 'pending');
  assert.deepEqual(JSON.parse(calls[1].init.body), { documentIds: [id.document] });
});

test('profile adapter rejects identity mismatch, invalid payload and forged verification response', async () => {
  let calls = 0;
  const repository = new HttpApiProfileRepository(apiClient(async () => { calls += 1; return response(200, farmer); }));
  await assert.rejects(repository.patchFarmer({ fullName: '  ' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.patchVet({}), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.submitVerification([id.document, id.document]), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const wrongOwner = new HttpApiProfileRepository(apiClient(async () => response(200, { ...farmer, user_id: id.document })));
  await assert.rejects(wrongOwner.getFarmer(), { code: 'API_RESPONSE_INVALID' });
  const forged = new HttpApiProfileRepository(apiClient(async () => response(201, {
    id: id.submission, document_ids: [id.document], status: 'verified', reviewer_reason: null,
    submitted_at: at, reviewed_at: at, version: 2,
  })));
  await assert.rejects(forged.submitVerification([id.document]), { code: 'API_RESPONSE_INVALID' });
});

test('professional document upload uses one private multipart request and validates saved metadata', async () => {
  const previous = globalThis.FormData;
  globalThis.FormData = class { fields = []; append(...args) { this.fields.push(args); } };
  try {
    const calls = [];
    const repository = new HttpApiProfileRepository(apiClient(async (url, init) => {
      calls.push({ url, init });
      return response(201, { id: id.document, filename: 'fiktif.pdf', mimeType: 'application/pdf', byteSize: 4 });
    }));
    const file = { uri: 'file:///fictional/fiktif.pdf', filename: 'fiktif.pdf', mimeType: 'application/pdf', byteSize: 4 };
    assert.equal((await repository.uploadProfessionalDocument(file, 'document-key-001')).id, id.document);
    assert.equal(calls[0].url.endsWith('/me/vet/professional-documents'), true);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer access-token-1');
    assert.equal(calls[0].init.headers['Content-Type'], undefined);
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'document-key-001');
    assert.deepEqual(calls[0].init.body.fields.map(([name]) => name), ['file']);
    await assert.rejects(repository.uploadProfessionalDocument({ ...file, byteSize: 11 * 1024 * 1024 }, 'document-key-001'), { code: 'VALIDATION_FAILED' });
    assert.equal(calls.length, 1);
    const uncertain = new HttpApiProfileRepository(apiClient(async () => { throw new Error('lost response'); }));
    await assert.rejects(uncertain.uploadProfessionalDocument(file, 'document-key-001'), { code: 'SERVICE_UNAVAILABLE' });
  } finally { globalThis.FormData = previous; }
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
