import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardService } from '../.test-build/src/application/DashboardService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { selectFarmerDashboard, selectVetDashboard } from '../.test-build/src/domain/dashboard.js';

test('farmer dashboard counts only owned livestock, active services, and the next unfinished reminder', () => {
  const userId = 'farmer-1';
  const input = {
    userId,
    displayName: 'Peternak Satu',
    farmName: 'Kandang Utama',
    farmLocation: 'Bogor',
    animals: [
      entity('cow-1', 'livestock', userId, { name: 'Mawar' }),
      entity('goat-other', 'livestock', 'farmer-2', { name: 'Luna' }),
    ],
    consultations: [
      dashboardConsultation('request-1', userId, 'vet-1', 'cow-1', 'requested', '2026-10-06T02:00:00.000Z'),
      dashboardConsultation('unpaid-1', userId, 'vet-1', 'cow-1', 'awaiting_payment', '2026-10-05T02:00:00.000Z'),
      dashboardConsultation('foreign-1', 'farmer-2', 'vet-1', 'goat-other', 'scheduled', '2026-10-06T03:00:00.000Z'),
      dashboardConsultation('done-1', userId, 'vet-1', 'cow-1', 'completed', '2026-10-04T03:00:00.000Z'),
    ],
    reminders: [
      { id: 'reminder-later', ownerId: userId, animalId: 'cow-1', animalName: 'Mawar', kind: 'care', dueAt: '2026-10-10T02:00:00.000Z', instructions: 'Perawatan rutin', careStatus: 'scheduled', deliveryStatus: 'sent' },
      { id: 'reminder-next', ownerId: userId, animalId: 'cow-1', animalName: 'Mawar', kind: 'follow_up', dueAt: '2026-10-07T02:00:00.000Z', instructions: 'Tindak lanjut', careStatus: 'scheduled', deliveryStatus: 'pending' },
      { id: 'reminder-done', ownerId: userId, animalId: 'cow-1', animalName: 'Mawar', kind: 'care', dueAt: '2026-10-06T02:00:00.000Z', instructions: 'Sudah selesai', careStatus: 'done', deliveryStatus: 'sent' },
      { id: 'reminder-foreign', ownerId: 'farmer-2', animalId: 'goat-other', animalName: 'Luna', kind: 'care', dueAt: '2026-10-06T02:00:00.000Z', instructions: 'Data akun lain', careStatus: 'scheduled', deliveryStatus: 'pending' },
    ],
    now: new Date('2026-10-05T04:00:00.000Z'),
  };

  const result = selectFarmerDashboard(input);
  assert.equal(result.totalLivestock, 1);
  assert.equal(result.activeConsultationCount, 1);
  assert.deepEqual(result.activeConsultations.map((item) => item.id), ['request-1']);
  assert.equal(result.nextReminder.id, 'reminder-next');
  assert.equal(result.nextReminderDays, 2);
});

test('vet dashboard shows owned balance and keeps accepted appointments when new requests are off', () => {
  const result = selectVetDashboard({
    userId: 'vet-1',
    displayName: 'drh. Satu',
    verificationStatus: 'verified',
    acceptingNewRequests: false,
    consultations: [
      dashboardConsultation('request-1', 'farmer-1', 'vet-1', 'cow-1', 'requested', '2026-10-06T02:00:00.000Z'),
      dashboardConsultation('today-appointment', 'farmer-1', 'vet-1', 'cow-1', 'scheduled', '2026-10-05T02:00:00.000Z'),
      dashboardConsultation('scheduled-1', 'farmer-1', 'vet-1', 'cow-1', 'scheduled', '2026-10-08T02:00:00.000Z'),
      dashboardConsultation('other-vet', 'farmer-1', 'vet-2', 'cow-1', 'scheduled', '2026-10-08T03:00:00.000Z'),
    ],
    availableBalance: 88000,
    pendingBalance: 81000,
    now: new Date('2026-10-05T04:00:00.000Z'),
  });

  assert.equal(result.acceptingNewRequests, false);
  assert.deepEqual(result.newRequests.map((item) => item.id), ['request-1']);
  assert.deepEqual(result.todayAppointments.map((item) => item.id), ['today-appointment']);
  assert.deepEqual(result.upcomingAppointments.map((item) => item.id), ['today-appointment', 'scheduled-1']);
  assert.equal(result.availableBalance, 88000);
  assert.equal(result.pendingBalance, 81000);
});

test('availability cannot be turned on before trusted verification', async () => {
  const repository = new MemoryDomainRepository();
  const service = new DashboardService(repository, profileService('pending'), { create: () => 'new-availability' });

  await assert.rejects(
    service.setAvailability('vet-1', true),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(repository.created.length, 0);
  assert.equal(repository.updated.length, 0);
});

test('turning off availability changes only the availability record and leaves accepted services intact', async () => {
  const consultationRecord = consultation('scheduled-1', 'farmer-1', 'vet-1', 'cow-1', 'scheduled', '2026-10-08T02:00:00.000Z');
  const repository = new MemoryDomainRepository({ availability: entity('availability-1', 'availability', 'vet-1', { vetId: 'vet-1', acceptingNewRequests: true, timezone: 'Asia/Jakarta' }), consultation: consultationRecord });
  const service = new DashboardService(repository, profileService('verified'), { create: () => 'new-availability' }, () => new Date('2026-10-05T00:00:00.000Z'));

  await service.setAvailability('vet-1', false);

  assert.equal(repository.availability.payload.acceptingNewRequests, false);
  assert.equal(repository.consultation.payload.status, 'scheduled');
  assert.equal(repository.updated.length, 1);
  assert.equal(repository.updated[0].kind, 'availability');
});

test('vet context opens the assigned consultation ID and rejects another veterinarian access', async () => {
  const consultationRecord = consultation('consultation-assigned', 'farmer-1', 'vet-1', 'cow-1', 'requested', '2026-10-06T02:00:00.000Z');
  const animal = entity('cow-1', 'livestock', 'farmer-1', { name: 'Mawar' });
  const farmer = entity('farmer-1', 'user', null, { name: 'Peternak Satu' });
  const repository = new MemoryDomainRepository({ consultation: consultationRecord, relations: [
    { sourceId: consultationRecord.id, relationship: 'veterinarian', targetId: 'vet-1', target: entity('vet-1', 'user', null, { name: 'drh. Satu' }) },
    { sourceId: consultationRecord.id, relationship: 'animal', targetId: animal.id, target: animal },
    { sourceId: consultationRecord.id, relationship: 'farmer', targetId: farmer.id, target: farmer },
  ] });
  const service = new DashboardService(repository, profileService('verified'), { create: () => 'id' });

  await assert.rejects(
    service.loadContext('vet-2', 'vet', 'consultation', consultationRecord.id),
    (error) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  const detail = await service.loadContext('vet-1', 'vet', 'consultation', consultationRecord.id);
  assert.equal(detail.id, 'consultation-assigned');
  assert.equal(detail.animalName, 'Mawar');
  assert.equal(detail.otherPartyName, 'Peternak Satu');
});

function consultation(id, farmerId, vetId, animalId, status, startsAt) {
  return {
    ...entity(id, 'consultation', farmerId, { displayCode: id, farmerId, vetId, animalId, type: 'chat', status, startsAt, endsAt: '2026-10-06T02:30:00.000Z', complaint: `Keluhan ${id}` }),
  };
}

function dashboardConsultation(id, farmerId, vetId, animalId, status, startsAt) {
  return { id, displayCode: id, farmerId, vetId, animalId, animalName: 'Mawar', otherPartyName: 'Pihak terkait', type: 'chat', status, startsAt, endsAt: null, complaint: `Keluhan ${id}`, visitAddress: null };
}

function entity(id, kind, ownerId, payload) {
  return { id, kind, ownerId, contextId: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', version: 1, payload };
}

function profileService(status) {
  return {
    load: async (userId, role) => ({ role, displayName: 'Nama Akun', farmer: null, vet: { professionalName: 'drh. Satu', services: [], experienceYears: 0, registrationNumber: '', species: [], practiceLocation: '', visitRegions: [] }, photo: null, verificationStatus: status, reviewerReason: null, verificationDocuments: [], draft: null }),
  };
}

class MemoryDomainRepository {
  created = [];
  updated = [];
  availability = null;
  consultation = null;
  relations = [];

  constructor({ availability = null, consultation = null, relations = [] } = {}) {
    this.availability = availability;
    this.consultation = consultation;
    this.relations = relations;
  }

  async create(entity, relations = []) {
    this.created.push({ entity, relations });
    if (entity.kind === 'availability') this.availability = entity;
  }

  async findById(kind, id) {
    if (kind === 'consultation' && this.consultation?.id === id) return this.consultation;
    if (kind === 'availability' && this.availability?.id === id) return this.availability;
    return null;
  }

  async listByOwner(kind, ownerId) {
    if (kind === 'vetProfile') return [entity('profile-1', 'vetProfile', ownerId, { verificationStatus: 'verified' })];
    if (kind === 'availability' && this.availability?.ownerId === ownerId) return [this.availability];
    if (kind === 'consultation' && this.consultation?.ownerId === ownerId) return [this.consultation];
    return [];
  }

  async listRelated(kind, id, relationship) {
    return this.relations
      .filter((item) => item.sourceId === id && item.relationship === relationship)
      .map((item) => item.target);
  }

  async listByRelated(kind, relatedId, relationship) {
    return this.relations
      .filter((item) => item.relationship === relationship && item.targetId === relatedId)
      .map((item) => this.consultation?.id === item.sourceId ? this.consultation : null)
      .filter(Boolean);
  }

  async update(entity, expectedVersion) {
    this.updated.push(entity);
    if (entity.kind === 'availability' && this.availability?.version === expectedVersion) this.availability = entity;
  }
}
