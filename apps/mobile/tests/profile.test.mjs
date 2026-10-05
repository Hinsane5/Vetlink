import assert from 'node:assert/strict';
import test from 'node:test';
import { ProfileService } from '../.test-build/src/application/ProfileService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { assertCanAcceptConsultation } from '../.test-build/src/domain/policies.js';

const farmerInput = {
  displayName: 'Peternak Baru',
  farmName: 'Kandang Sejahtera',
  species: ['cattle', 'goat'],
  farmLocation: 'Bogor Barat',
  addressLabel: 'Kandang Utama',
  recipient: 'Peternak Baru',
  phone: '+628123456789',
  address: 'Jalan Ternak Nomor 5',
  city: 'Bogor',
  province: 'Jawa Barat',
  postalCode: '16111',
};

const vetInput = {
  professionalName: 'drh. Dokter Baru',
  registrationNumber: 'STR-FIKTIF-100',
  experienceYears: 5,
  services: ['chat', 'visit'],
  species: ['cattle', 'goat'],
  practiceLocation: 'Bogor, Jawa Barat',
  visitRegions: ['Bogor', 'Depok'],
};

test('farmer profile commits identity, farm, livestock species, and visit address together', async () => {
  const setup = makeProfileService('farmer');
  await setup.service.saveFarmerProfile('user-1', farmerInput);

  const change = setup.repository.lastCommit;
  assert.equal(change.creates.filter((item) => item.entity.kind === 'farm').length, 1);
  assert.equal(change.creates.filter((item) => item.entity.kind === 'address').length, 1);
  const farm = change.creates.find((item) => item.entity.kind === 'farm').entity;
  const address = change.creates.find((item) => item.entity.kind === 'address').entity;
  const profile = change.updates.find((item) => item.entity.kind === 'farmerProfile').entity;
  const user = change.updates.find((item) => item.entity.kind === 'user').entity;

  assert.deepEqual(farm.payload.species, ['cattle', 'goat']);
  assert.equal(farm.payload.location, 'Bogor Barat');
  assert.equal(farm.payload.visitAddressId, address.id);
  assert.equal(profile.payload.farmId, farm.id);
  assert.equal(user.payload.name, 'Peternak Baru');
  assert.ok(change.updates.find((item) => item.entity.kind === 'farmerProfile').relations.some((relation) => relation.relationship === 'address' && relation.targetId === address.id));
});

test('vet verification submission persists documents as pending and never verifies itself', async () => {
  const setup = makeProfileService('vet');
  const document = { type: 'new', asset: { uri: 'cache://credential.pdf', filename: 'credential.pdf', mimeType: 'application/pdf', byteSize: 124, kind: 'document' } };

  await setup.service.submitVetVerification('user-1', vetInput, [document]);

  const changes = setup.repository.lastCommit;
  const profile = changes.updates.find((item) => item.entity.kind === 'vetProfile').entity;
  const submission = changes.creates.find((item) => item.entity.kind === 'verificationSubmission').entity;
  const attachment = changes.creates.find((item) => item.entity.kind === 'attachment').entity;
  assert.equal(profile.payload.verificationStatus, 'pending');
  assert.equal(submission.payload.status, 'pending');
  assert.deepEqual(submission.payload.documentAttachmentIds, [attachment.id]);
  assert.equal(attachment.payload.ownerId, 'user-1');
  assert.equal(attachment.payload.uploadStatus, 'local');
  assert.ok(changes.creates.find((item) => item.entity.kind === 'verificationSubmission').relations.some((relation) => relation.relationship === 'verificationSubmission' && relation.sourceId === profile.id));
  assert.throws(() => assertCanAcceptConsultation({
    actorUserId: 'user-1',
    assignedVetUserId: 'user-1',
    verificationStatus: profile.payload.verificationStatus,
    consultationStatus: 'requested',
  }), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
  await assert.rejects(
    setup.service.submitVetVerification('user-1', vetInput, [document]),
    (error) => error instanceof DomainError && error.code === 'INVALID_STATE',
  );
});

test('profile reads preserve all verification states and revision reason', async () => {
  for (const status of ['not_submitted', 'pending', 'revision_required', 'verified']) {
    const setup = makeProfileService('vet', status);
    const snapshot = await setup.service.load('user-1', 'vet');
    assert.equal(snapshot.verificationStatus, status);
    if (status === 'revision_required') assert.equal(snapshot.reviewerReason, 'Nomor registrasi perlu diperbarui.');
  }
});

test('revision resubmission creates a new pending record and keeps the reviewed submission', async () => {
  const setup = makeProfileService('vet', 'revision_required');
  const document = { type: 'new', asset: { uri: 'cache://updated-license.pdf', filename: 'updated-license.pdf', mimeType: 'application/pdf', byteSize: 48, kind: 'document' } };
  await setup.service.submitVetVerification('user-1', vetInput, [document]);

  assert.equal(setup.repository.aggregate.submissions.length, 2);
  assert.equal(setup.repository.aggregate.submissions[0].payload.status, 'revision_required');
  assert.equal(setup.repository.aggregate.submissions[0].payload.reviewerReason, 'Nomor registrasi perlu diperbarui.');
  assert.equal(setup.repository.aggregate.submissions[1].payload.status, 'pending');
  const next = await setup.service.load('user-1', 'vet');
  assert.equal(next.verificationStatus, 'pending');
});

test('submission is rejected for a farmer role and cannot be repeated while pending', async () => {
  const setup = makeProfileService('farmer');
  const document = { type: 'new', asset: { uri: 'cache://license.pdf', filename: 'license.pdf', mimeType: 'application/pdf', byteSize: 32, kind: 'document' } };
  await assert.rejects(
    setup.service.submitVetVerification('user-1', vetInput, [document]),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    setup.service.submitVetVerification('user-1', vetInput, []),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
});

function makeProfileService(role, status = 'not_submitted') {
  const profileKind = role === 'farmer' ? 'farmerProfile' : 'vetProfile';
  const profile = entity('profile-1', profileKind, 'user-1', role === 'farmer'
    ? { userId: 'user-1', farmId: null, photoAttachmentId: null }
    : { userId: 'user-1', professionalName: 'Nama Pendaftar', verificationStatus: status, services: [] });
  const repository = new MemoryProfileRepository({
    user: entity('user-1', 'user', null, { name: 'Nama Pendaftar', roles: [role] }),
    profile,
    farm: null,
    address: null,
    submissions: status === 'revision_required' ? [entity('submission-previous', 'verificationSubmission', 'user-1', { vetId: 'user-1', status, reviewerReason: 'Nomor registrasi perlu diperbarui.', submittedAt: '2026-10-01T00:00:00.000Z' })] : [],
    attachments: [],
    drafts: [],
    profileRelations: [{ sourceId: profile.id, relationship: 'user', targetId: 'user-1' }],
    farmRelations: [],
  });
  let id = 0;
  const media = {
    pickPhoto: async () => null,
    pickDocuments: async () => [],
    store: async (asset, attachmentId) => ({ localUri: `private://${attachmentId}`, filename: asset.filename, mimeType: asset.mimeType, byteSize: asset.byteSize ?? 0 }),
    remove: async () => {},
  };
  const service = new ProfileService(repository, media, { create: () => `generated-${++id}` }, () => new Date('2026-10-05T00:00:00.000Z'));
  return { service, repository };
}

class MemoryProfileRepository {
  lastCommit = { creates: [], updates: [] };
  constructor(aggregate) { this.aggregate = structuredClone(aggregate); }

  async loadProfile(userId, role) {
    assert.equal(userId, this.aggregate.user.id);
    if ((role === 'farmer' ? 'farmerProfile' : 'vetProfile') !== this.aggregate.profile.kind) {
      throw new DomainError('FORBIDDEN', 'Peran tidak sesuai.');
    }
    return structuredClone(this.aggregate);
  }

  async commit(changes) {
    const creates = [...(changes.creates ?? [])];
    const updates = [...(changes.updates ?? [])];
    this.lastCommit = { creates, updates };
    for (const { entity: created } of creates) {
      if (created.kind === 'attachment') this.aggregate.attachments.push(structuredClone(created));
      if (created.kind === 'verificationSubmission') this.aggregate.submissions.push(structuredClone(created));
      if (created.kind === 'farm') this.aggregate.farm = structuredClone(created);
      if (created.kind === 'address') this.aggregate.address = structuredClone(created);
      if (created.kind === 'profileDraft') this.aggregate.drafts.push(structuredClone(created));
    }
    for (const { entity: changed, relations } of updates) {
      if (changed.kind === 'user') this.aggregate.user = structuredClone(changed);
      if (changed.kind === this.aggregate.profile.kind) this.aggregate.profile = structuredClone(changed);
      if (changed.kind === 'farm') this.aggregate.farm = structuredClone(changed);
      if (changed.kind === 'address') this.aggregate.address = structuredClone(changed);
      const target = this.aggregate.drafts.find((item) => item.id === changed.id);
      if (target) Object.assign(target, structuredClone(changed));
      if (relations && changed.id === this.aggregate.profile.id) this.aggregate.profileRelations = structuredClone(relations);
    }
  }
}

function entity(id, kind, ownerId, payload) {
  return { id, kind, ownerId, contextId: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', version: 1, payload };
}
