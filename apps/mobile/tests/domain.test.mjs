import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFixtureGraph } from '../.test-build/src/domain/fixtureValidation.js';
import { calculateWalletBalances } from '../.test-build/src/domain/ledger.js';
import { DomainError } from '../.test-build/src/domain/errors.js';
import {
  assertCanAcceptConsultation,
  assertClinicalNoteEditable,
  assertClinicalNoteFinalizable,
  assertConsultationParticipant,
  assertVisitTransition,
} from '../.test-build/src/domain/policies.js';
import { fixtureEntities, fixtureIds, fixtureRelations } from '../.test-build/src/testing/fixtures.js';
import { publishLocalEvent } from '../.test-build/src/application/publishLocalEvent.js';

test('fixture domain graph keeps all referenced owners and relationships valid', () => {
  assert.doesNotThrow(() => validateFixtureGraph(fixtureEntities, fixtureRelations));
});

test('unverified or unrelated veterinarian cannot accept a consultation', () => {
  assert.throws(
    () => assertCanAcceptConsultation({
      actorUserId: fixtureIds.damar,
      assignedVetUserId: fixtureIds.damar,
      verificationStatus: 'pending',
      consultationStatus: 'requested',
    }),
    { code: 'FORBIDDEN' },
  );
  assert.throws(
    () => assertCanAcceptConsultation({
      actorUserId: fixtureIds.rani,
      assignedVetUserId: fixtureIds.damar,
      verificationStatus: 'verified',
      consultationStatus: 'requested',
    }),
    { code: 'FORBIDDEN' },
  );
  assert.throws(
    () => assertConsultationParticipant({
      actorUserId: fixtureIds.damar,
      farmerUserId: fixtureIds.budi,
      assignedVetUserId: fixtureIds.rani,
    }),
    { code: 'FORBIDDEN' },
  );
});

test('visit stage cannot skip ahead and completion needs final note plus confirmation', () => {
  assert.throws(
    () => assertVisitTransition({ current: 'scheduled', next: 'arrived', clinicalNoteFinal: false, userConfirmedCompletion: false }),
    { code: 'INVALID_STATE' },
  );
  assert.throws(
    () => assertVisitTransition({ current: 'examining', next: 'completed', clinicalNoteFinal: false, userConfirmedCompletion: true }),
    { code: 'INVALID_STATE' },
  );
  assert.throws(
    () => assertVisitTransition({ current: 'examining', next: 'completed', clinicalNoteFinal: true, userConfirmedCompletion: false }),
    { code: 'INVALID_STATE' },
  );
  assert.doesNotThrow(
    () => assertVisitTransition({ current: 'examining', next: 'completed', clinicalNoteFinal: true, userConfirmedCompletion: true }),
  );
});

test('final clinical note requires complete fields and cannot be edited', () => {
  assert.throws(
    () => assertClinicalNoteFinalizable({ complaint: 'Keluhan', findings: ' ', assessment: '', actions: '', careInstructions: '' }),
    { code: 'VALIDATION_FAILED' },
  );
  assert.doesNotThrow(
    () => assertClinicalNoteFinalizable({ complaint: 'Keluhan', findings: 'Temuan', assessment: 'Penilaian', actions: 'Tindakan', careInstructions: 'Instruksi' }),
  );
  assert.throws(() => assertClinicalNoteEditable('final'), { code: 'IMMUTABLE_RECORD' });
});

test('wallet projections are derived from integer ledger entries', () => {
  const yudaEntries = fixtureEntities
    .filter((entry) => entry.kind === 'ledgerEntry' && entry.payload.vetId === fixtureIds.vetZero)
    .map((entry) => ({ kind: entry.payload.kind, amount: entry.payload.amount }));
  assert.deepEqual(calculateWalletBalances(yudaEntries), {
    pending: 81000,
    available: 88000,
    reserved: 20000,
    paidOut: 0,
  });
  assert.deepEqual(calculateWalletBalances([]), { pending: 0, available: 0, reserved: 0, paidOut: 0 });
  assert.throws(() => calculateWalletBalances([{ kind: 'credit_available', amount: 10.5 }]), { code: 'VALIDATION_FAILED' });
});

test('domain event retries create notification and health projections once', async () => {
  const event = {
    id: 'consultation-completed-001',
    type: 'consultation.completed',
    aggregateId: fixtureIds.completed,
    occurredAt: '2026-10-05T00:00:00.000Z',
    payload: { details: { b: 2, a: 1 }, consultationId: fixtureIds.completed },
  };
  const effect = {
    key: 'farmer-notification',
    entity: {
      id: '00000000-0000-4000-8000-000000000099',
      kind: 'notification',
      ownerId: fixtureIds.sari,
      contextId: fixtureIds.completed,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      version: 1,
      payload: { recipientId: fixtureIds.sari, eventId: event.id, type: event.type },
    },
    relations: [],
  };
  const store = new MemoryEventStore();
  assert.equal(await publishLocalEvent(store, event, [effect]), 'published');
  assert.equal(await publishLocalEvent(
    store,
    { ...event, payload: { details: { a: 1, b: 2 }, consultationId: fixtureIds.completed } },
    [effect],
  ), 'duplicate');
  assert.equal(store.events.size, 1);
  assert.equal(store.effects.size, 1);
  await assert.rejects(
    publishLocalEvent(store, { ...event, payload: { details: { a: 2 }, consultationId: 'different' } }, [effect]),
    (error) => error instanceof DomainError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(store.events.size, 1);
  assert.equal(store.effects.size, 1);
});

class MemoryEventStore {
  events = new Map();
  effects = new Map();

  async transaction(work) {
    const events = new Map(this.events);
    const effects = new Map(this.effects);
    const transaction = {
      insertEventIfAbsent: async (event) => {
        if (events.has(event.id)) return false;
        events.set(event.id, structuredClone(event));
        return true;
      },
      findEvent: async (id) => events.get(id) ?? null,
      insertEffect: async (effect, eventId) => {
        const key = `${eventId}:${effect.key}`;
        if (effects.has(key)) throw new Error('Effect idempotency key collision');
        effects.set(key, structuredClone(effect));
      },
    };
    const result = await work(transaction);
    this.events = events;
    this.effects = effects;
    return result;
  }
}
