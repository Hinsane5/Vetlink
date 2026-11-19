import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../.test-build/src/domain/errors.js';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiConsultationRepository } from '../.test-build/src/data/remote/HttpApiConsultationRepository.js';

const ids = {
  farmer: '11111111-1111-4111-8111-111111111111',
  vet: '22222222-2222-4222-8222-222222222222',
  animal: '33333333-3333-4333-8333-333333333333',
  address: '44444444-4444-4444-8444-444444444444',
  quote: '55555555-5555-4555-8555-555555555555',
  consultation: '66666666-6666-4666-8666-666666666666',
  action: '77777777-7777-4777-8777-777777777777',
  proposal: '88888888-8888-4888-8888-888888888888',
};

test('consultation quote sends explicit visit context, idempotency key, and allowlisted fields', async () => {
  const requests = [];
  const api = apiClient(async (url, init) => {
    requests.push({ url, init });
    return response(201, quoteFixture());
  });
  const repository = new HttpApiConsultationRepository(api);
  const operation = {
    idempotencyKey: 'quote:visit:operation-1',
    payload: {
      vetId: ids.vet,
      animalId: ids.animal,
      serviceType: 'visit',
      startsAt: '2026-11-18T10:00:00+07:00',
      complaint: 'Pemeriksaan ternak fiktif.',
      addressId: ids.address,
      ownerId: ids.farmer,
      feeIdr: 1,
    },
  };

  const quote = await repository.createQuote(operation);

  assert.equal(quote.id, ids.quote);
  assert.equal(quote.quoteId, ids.quote);
  assert.equal(quote.feeIdr, 125000);
  assert.equal(quote.commissionIdr, 12500);
  assert.equal(quote.amountIdr, 125000);
  assert.equal(quote.visitAddressSnapshot.id, ids.address);
  assert.equal(requests[0].url, 'http://localhost:3000/v1/consultation-quotes');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer access-token-1');
  assert.equal(requests[0].init.headers['Idempotency-Key'], operation.idempotencyKey);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    vetId: ids.vet,
    animalId: ids.animal,
    serviceType: 'visit',
    startsAt: '2026-11-18T10:00:00+07:00',
    complaint: 'Pemeriksaan ternak fiktif.',
    addressId: ids.address,
  });
});

test('consultation chat quote omits visit address and parses server IDR amounts', async () => {
  let sentBody;
  const api = apiClient(async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return response(201, quoteFixture({ serviceType: 'chat', visitAddressSnapshot: null }));
  });
  const repository = new HttpApiConsultationRepository(api);

  const quote = await repository.createQuote({
    idempotencyKey: 'quote:chat:operation-1',
    payload: {
      vetId: ids.vet, animalId: ids.animal, serviceType: 'chat',
      startsAt: '2026-11-18T03:00:00.000Z', complaint: 'Keluhan fiktif.',
    },
  });

  assert.equal(quote.visitAddressSnapshot, null);
  assert.equal(sentBody.addressId, undefined);
  assert.equal(sentBody.feeIdr, undefined, 'the client never supplies or transmits a fee');
  assert.equal(sentBody.ownerId, undefined, 'owner scope comes from the bearer session');
});

test('booking uses quote UUID and same key/payload for a caller-managed retry', async () => {
  const requests = [];
  const operation = Object.freeze({
    idempotencyKey: 'booking:consultation:operation-1',
    payload: Object.freeze({ quoteId: ids.quote, ownerId: ids.farmer }),
  });
  const api = apiClient(async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) throw new Error('server committed; response was lost');
    return response(201, { operationId: ids.action, replayed: true, consultation: consultationFixture() });
  });
  const repository = new HttpApiConsultationRepository(api);

  await assert.rejects(repository.create(operation), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(requests.length, 1, 'uncertain network result is not automatically retried');
  const booking = await repository.create(operation);

  assert.equal(booking.operationId, ids.action);
  assert.equal(booking.replayed, true);
  assert.equal(booking.consultation.id, ids.consultation);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers['Idempotency-Key'], operation.idempotencyKey);
  assert.equal(requests[1].init.headers['Idempotency-Key'], operation.idempotencyKey);
  assert.deepEqual(JSON.parse(requests[0].init.body), { quoteId: ids.quote });
  assert.deepEqual(JSON.parse(requests[1].init.body), JSON.parse(requests[0].init.body));
});

test('cancellation sends a trimmed reason, version, and stable idempotency key', async () => {
  const requests = [];
  const reason = 'Jadwal berubah.';
  const api = apiClient(async (url, init) => {
    requests.push({ url, init });
    return response(200, {
      operationId: ids.action,
      replayed: false,
      consultation: consultationFixture({ status: 'cancelled', cancellationReason: reason, refundStatus: 'refund_needed' }),
    });
  });
  const repository = new HttpApiConsultationRepository(api);
  const result = await repository.cancel(ids.consultation, {
    idempotencyKey: 'consultation:cancel:op-1',
    payload: { expectedVersion: 5, reason: '  Jadwal berubah.  ' },
  });

  assert.equal(result.consultation.status, 'cancelled');
  assert.equal(result.consultation.cancellationReason, reason);
  assert.equal(requests[0].url, `http://localhost:3000/v1/consultations/${ids.consultation}/cancel`);
  assert.equal(requests[0].init.headers['Idempotency-Key'], 'consultation:cancel:op-1');
  assert.deepEqual(JSON.parse(requests[0].init.body), { expectedVersion: 5, reason });
  await assert.rejects(repository.cancel(ids.consultation, {
    idempotencyKey: 'consultation:cancel:op-2', payload: { expectedVersion: 5, reason: '  ' },
  }), { code: 'VALIDATION_FAILED' });
});

test('consultation list, detail, and visit preserve route-specific completion aliases', async () => {
  const requests = [];
  const listItem = listFixture();
  const detail = detailFixture();
  const visit = visitFixture();
  const api = apiClient(async (url, init) => {
    requests.push({ url, init });
    if (url.includes('/v1/consultations?')) return response(200, [listItem]);
    if (url.endsWith(`/v1/consultations/${ids.consultation}`)) return response(200, detail);
    if (url.endsWith(`/v1/consultations/${ids.consultation}/visit`)) return response(200, visit);
    throw new Error(`Unexpected route ${url}`);
  });
  const repository = new HttpApiConsultationRepository(api);

  const items = await repository.list({ status: 'completed' });
  const loadedDetail = await repository.getById(ids.consultation);
  const loadedVisit = await repository.getVisit(ids.consultation);

  assert.equal(items[0].completedAt, listItem.completedAt);
  assert.equal('completionAt' in items[0], false);
  assert.equal(loadedDetail.completionAt, detail.completionAt);
  assert.equal(loadedDetail.visitCompletedAt, detail.visitCompletedAt);
  assert.equal('completedAt' in loadedDetail, false);
  assert.equal(loadedVisit.completedAt, visit.completedAt);
  assert.equal(loadedVisit.updatedAt, visit.updatedAt);
  assert.equal(requests[0].url, 'http://localhost:3000/v1/consultations?status=completed');
  assert.equal(requests[1].url, `http://localhost:3000/v1/consultations/${ids.consultation}`);
  assert.equal(requests[2].url, `http://localhost:3000/v1/consultations/${ids.consultation}/visit`);
  assert.equal(new URL(requests[0].url).searchParams.has('ownerId'), false);
});

test('consultation adapter rejects invalid identifiers, timestamps, bounds, service context, and keys before HTTP', async () => {
  let calls = 0;
  const repository = new HttpApiConsultationRepository(apiClient(async () => {
    calls += 1;
    return response(200, []);
  }));
  const validPayload = {
    vetId: ids.vet, animalId: ids.animal, serviceType: 'chat',
    startsAt: '2026-11-18T10:00:00+07:00', complaint: 'Keluhan fiktif.',
  };

  await assert.rejects(repository.createQuote({ idempotencyKey: 'short', payload: validPayload }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:no-zone', payload: { ...validPayload, startsAt: '2026-11-18T10:00:00' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:bad-date', payload: { ...validPayload, startsAt: '2026-02-30T10:00:00Z' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:bad-vet', payload: { ...validPayload, vetId: 'vet-default' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:blank', payload: { ...validPayload, complaint: '   ' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:long', payload: { ...validPayload, complaint: 'a'.repeat(4001) } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote({ idempotencyKey: 'quote:visit', payload: { ...validPayload, serviceType: 'visit' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.create({ idempotencyKey: 'booking:bad-id', payload: { quoteId: 'VL-001' } }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.list({ status: 'draft' }), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getById('consultation-default'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.getVisit('consultation-default'), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
});

test('consultation adapters reject malformed BE-16 response DTOs and unsafe IDR', async () => {
  const malformedQuotes = [
    quoteFixture({ amountIdr: Number.MAX_SAFE_INTEGER + 1 }),
    quoteFixture({ id: ids.consultation }),
    quoteFixture({ endsAt: '2026-11-18T11:00:00' }),
    quoteFixture({ visitAddressSnapshot: null }),
  ];
  for (const payload of malformedQuotes) {
    const repository = new HttpApiConsultationRepository(apiClient(async () => response(201, payload)));
    await assert.rejects(repository.createQuote({
      idempotencyKey: 'quote:validate:1',
      payload: { vetId: ids.vet, animalId: ids.animal, serviceType: 'visit', startsAt: '2026-11-18T10:00:00Z', complaint: 'Fiktif.', addressId: ids.address },
    }), { code: 'API_RESPONSE_INVALID' });
  }

  const malformedListRows = [
    { ...listFixture(), feeAmountIdr: Number.MAX_SAFE_INTEGER + 1 },
    { ...listFixture(), commissionAmountIdr: 99 },
    { ...listFixture(), completedAt: undefined },
  ];
  for (const payload of malformedListRows) {
    const repository = new HttpApiConsultationRepository(apiClient(async () => response(200, [payload])));
    await assert.rejects(repository.list(), { code: 'API_RESPONSE_INVALID' });
  }

  const malformedDetails = [
    { ...detailFixture(), completionAt: undefined },
    { ...detailFixture(), visitCompletedAt: 'not-a-timestamp' },
    { ...detailFixture(), proposals: [{ id: 'proposal-id' }] },
  ];
  for (const payload of malformedDetails) {
    const repository = new HttpApiConsultationRepository(apiClient(async () => response(200, payload)));
    await assert.rejects(repository.getById(ids.consultation), { code: 'API_RESPONSE_INVALID' });
  }

  const badVisit = { ...visitFixture(), updatedAt: '2026-11-18T12:30:00' };
  const visitRepository = new HttpApiConsultationRepository(apiClient(async () => response(200, badVisit)));
  await assert.rejects(visitRepository.getVisit(ids.consultation), { code: 'API_RESPONSE_INVALID' });
});

test('quote and booking transport uncertainty never returns local success or retries automatically', async () => {
  let calls = 0;
  const repository = new HttpApiConsultationRepository(apiClient(async () => {
    calls += 1;
    throw new Error('network unavailable');
  }));

  await assert.rejects(repository.createQuote({
    idempotencyKey: 'quote:network:1',
    payload: { vetId: ids.vet, animalId: ids.animal, serviceType: 'chat', startsAt: '2026-11-18T03:00:00Z', complaint: 'Fiktif.' },
  }), (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(repository.create({ idempotencyKey: 'booking:network:1', payload: { quoteId: ids.quote } }),
    (error) => error instanceof DomainError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(calls, 2, 'one HTTP attempt per explicit call');
});

test('consultation action adapter sends BE-05 routes, versions, consent, and only allowlisted fields', async () => {
  const calls = [];
  const result = { operationId: ids.action, replayed: false, consultation: consultationFixture() };
  const repository = new HttpApiConsultationRepository(apiClient(async (url, init) => {
    calls.push({ url, key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) });
    if (url.endsWith('/schedule-proposals')) return response(200, { ...result, proposalId: ids.proposal });
    if (url.endsWith('/respond')) return response(200, { ...result, decision: 'accept' });
    if (url.includes('/visit/')) {
      const { updatedAt, ...visit } = visitFixture();
      return response(200, { ...result, visit });
    }
    return response(200, result);
  }));
  const op = (payload) => ({ idempotencyKey: 'consultation:action-1', payload: { ...payload, actorId: ids.vet, status: 'completed' } });

  await repository.accept(ids.consultation, op({ expectedVersion: 1 }));
  await repository.reject(ids.consultation, op({ expectedVersion: 2, reason: 'Alasan fiktif.' }));
  const proposed = await repository.proposeSchedule(ids.consultation, op({ expectedVersion: 3, startsAt: '2026-11-19T10:00:00+07:00' }));
  const decided = await repository.respondScheduleProposal(ids.consultation, ids.proposal, op({ expectedVersion: 4, decision: 'accept', consent: true }));
  await repository.startChat(ids.consultation, op({ expectedVersion: 5 }));
  const advanced = await repository.advanceVisit(ids.consultation, 'depart', op({ expectedVersion: 6, expectedVisitVersion: 1 }));
  await repository.advanceVisit(ids.consultation, 'arrive', op({ expectedVersion: 6, expectedVisitVersion: 2 }));
  await repository.advanceVisit(ids.consultation, 'start-examination', op({ expectedVersion: 6, expectedVisitVersion: 3 }));
  await repository.complete(ids.consultation, op({ expectedVersion: 7, expectedVisitVersion: 4, confirmation: true }));

  assert.equal(proposed.proposalId, ids.proposal);
  assert.equal(decided.decision, 'accept');
  assert.equal(advanced.visit.stage, 'completed');
  assert.deepEqual(calls.map(({ url }) => url.replace(`http://localhost:3000/v1/consultations/${ids.consultation}/`, '')), [
    'accept', 'reject', 'schedule-proposals', `schedule-proposals/${ids.proposal}/respond`,
    'start', 'visit/depart', 'visit/arrive', 'visit/start-examination', 'complete',
  ]);
  assert.deepEqual(calls.map(({ body }) => body), [
    { expectedVersion: 1 }, { expectedVersion: 2, reason: 'Alasan fiktif.' },
    { expectedVersion: 3, startsAt: '2026-11-19T10:00:00+07:00' },
    { expectedVersion: 4, decision: 'accept', consent: true }, { expectedVersion: 5 },
    { expectedVersion: 6, expectedVisitVersion: 1 }, { expectedVersion: 6, expectedVisitVersion: 2 },
    { expectedVersion: 6, expectedVisitVersion: 3 },
    { expectedVersion: 7, confirmation: true, expectedVisitVersion: 4 },
  ]);
  assert.ok(calls.every(({ key }) => key === 'consultation:action-1'));
});

test('consultation action replay accepts omitted route extras and never retries uncertain POST automatically', async () => {
  let calls = 0;
  const repository = new HttpApiConsultationRepository(apiClient(async () => {
    calls += 1;
    if (calls === 1) throw new Error('response lost');
    return response(200, { operationId: ids.action, replayed: true, consultation: consultationFixture() });
  }));
  const operation = Object.freeze({ idempotencyKey: 'consultation:replay-1', payload: Object.freeze({ expectedVersion: 3, startsAt: '2026-11-19T10:00:00Z' }) });
  await assert.rejects(repository.proposeSchedule(ids.consultation, operation), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls, 1);
  const replay = await repository.proposeSchedule(ids.consultation, operation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.proposalId, undefined);
  assert.equal(calls, 2);
});

test('consultation action adapter rejects invalid input and action-specific response before success', async () => {
  let calls = 0;
  const repository = new HttpApiConsultationRepository(apiClient(async () => {
    calls += 1;
    return response(200, { operationId: ids.action, replayed: false, consultation: consultationFixture() });
  }));
  const op = (payload) => ({ idempotencyKey: 'consultation:invalid-1', payload });
  await assert.rejects(repository.accept('VL-001', op({ expectedVersion: 1 })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.accept(ids.consultation, op({ expectedVersion: 0 })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.reject(ids.consultation, op({ expectedVersion: 1, reason: ' ' })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.proposeSchedule(ids.consultation, op({ expectedVersion: 1, startsAt: '2026-11-19T10:00:00' })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.respondScheduleProposal(ids.consultation, ids.proposal, op({ expectedVersion: 1, decision: 'accept', consent: false })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.advanceVisit(ids.consultation, 'depart', op({ expectedVersion: 1, expectedVisitVersion: 0 })), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.complete(ids.consultation, op({ expectedVersion: 1, confirmation: false })), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  await assert.rejects(repository.proposeSchedule(ids.consultation, op({ expectedVersion: 1, startsAt: '2026-11-19T10:00:00Z' })), { code: 'API_RESPONSE_INVALID' });
  await assert.rejects(repository.advanceVisit(ids.consultation, 'depart', op({ expectedVersion: 1, expectedVisitVersion: 1 })), { code: 'API_RESPONSE_INVALID' });
});

function quoteFixture(overrides = {}) {
  return {
    id: ids.quote,
    quoteId: ids.quote,
    farmerId: ids.farmer,
    vetId: ids.vet,
    animalId: ids.animal,
    serviceType: 'visit',
    complaint: 'Pemeriksaan fiktif.',
    startsAt: '2026-11-18T10:00:00.000Z',
    endsAt: '2026-11-18T11:00:00.000Z',
    feeIdr: 125000,
    commissionIdr: 12500,
    amountIdr: 125000,
    currency: 'IDR',
    visitAddressSnapshot: addressFixture(),
    consumed: false,
    ...overrides,
  };
}

function consultationFixture(overrides = {}) {
  return {
    id: ids.consultation,
    displayCode: 'VL-V-105',
    farmerId: ids.farmer,
    vetId: ids.vet,
    animalId: ids.animal,
    animalCode: 'SAPI-105',
    animalName: 'Lembu Fiktif',
    species: 'cattle',
    serviceType: 'visit',
    complaint: 'Pemeriksaan fiktif.',
    status: 'completed',
    startsAt: '2026-11-18T10:00:00.000Z',
    endsAt: '2026-11-18T11:00:00.000Z',
    feeIdr: '125000',
    commissionIdr: '12500',
    feeAmountIdr: 125000,
    commissionAmountIdr: 12500,
    visitAddressSnapshot: addressFixture(),
    completionAt: '2026-11-18T12:30:00.000Z',
    rejectionReason: null,
    cancellationReason: null,
    refundStatus: 'none',
    reschedulePreviousStatus: null,
    version: 4,
    visitStage: 'completed',
    departureAt: '2026-11-18T09:00:00.000Z',
    arrivalAt: '2026-11-18T09:30:00.000Z',
    examinationStartedAt: '2026-11-18T10:00:00.000Z',
    visitCompletedAt: '2026-11-18T12:20:00.000Z',
    visitVersion: 4,
    paymentStatus: 'succeeded',
    ...overrides,
  };
}

function listFixture(overrides = {}) {
  const record = consultationFixture();
  return {
    id: record.id,
    displayCode: record.displayCode,
    farmerId: record.farmerId,
    vetId: record.vetId,
    animalId: record.animalId,
    animalCode: record.animalCode,
    animalName: record.animalName,
    species: record.species,
    serviceType: record.serviceType,
    complaint: record.complaint,
    status: record.status,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    feeIdr: record.feeIdr,
    commissionIdr: record.commissionIdr,
    feeAmountIdr: record.feeAmountIdr,
    commissionAmountIdr: record.commissionAmountIdr,
    refundStatus: record.refundStatus,
    completedAt: '2026-11-18T13:00:00.000Z',
    rejectionReason: record.rejectionReason,
    version: record.version,
    visitStage: record.visitStage,
    paymentStatus: record.paymentStatus,
    ...overrides,
  };
}

function detailFixture(overrides = {}) {
  return { ...consultationFixture(), proposals: [], actions: [], ...overrides };
}

function visitFixture(overrides = {}) {
  return {
    consultationId: ids.consultation,
    stage: 'completed',
    departureAt: '2026-11-18T09:00:00.000Z',
    arrivalAt: '2026-11-18T09:30:00.000Z',
    examinationStartedAt: '2026-11-18T10:00:00.000Z',
    completedAt: '2026-11-18T12:20:00.000Z',
    version: 4,
    updatedAt: '2026-11-18T12:21:00.000Z',
    ...overrides,
  };
}

function addressFixture() {
  return {
    id: ids.address,
    label: 'Kandang utama',
    recipientName: 'Pemilik Fiktif',
    phone: '080000000000',
    addressLine: 'Jalan Contoh 1',
    city: 'Bogor',
    province: 'Jawa Barat',
    postalCode: '16111',
    latitude: '-6.2',
    longitude: '106.8',
  };
}

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {},
    async clear() {},
  }, fetcher);
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
