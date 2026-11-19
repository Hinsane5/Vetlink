import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerBookingService } from '../.test-build/src/application/ServerBookingService.js';

const id = {
  farmer: '11111111-1111-4111-8111-111111111111',
  farm: '22222222-2222-4222-8222-222222222222',
  animal: '33333333-3333-4333-8333-333333333333',
  vet: '44444444-4444-4444-8444-444444444444',
  address: '55555555-5555-4555-8555-555555555555',
  quote: '66666666-6666-4666-8666-666666666666',
};
const input = { vetId: id.vet, animalId: id.animal, serviceType: 'visit', startsAt: '2026-11-20T10:00:00.000Z', complaint: '  Keluhan fiktif  ' };
const quote = (overrides = {}) => ({ id: id.quote, quoteId: id.quote, farmerId: id.farmer, vetId: id.vet, animalId: id.animal, serviceType: 'visit', complaint: 'Keluhan fiktif', startsAt: input.startsAt, endsAt: '2026-11-20T11:00:00.000Z', feeIdr: 125000, commissionIdr: 12500, amountIdr: 125000, currency: 'IDR', visitAddressSnapshot: { id: id.address }, consumed: false, ...overrides });
const consultation = (overrides = {}) => ({ id: '77777777-7777-4777-8777-777777777777', farmerId: id.farmer, status: 'awaiting_payment', paymentStatus: 'pending', ...overrides });

function makeService({ store = new Map(), quoteResponse = quote(), create = async () => ({ operationId: '88888888-8888-4888-8888-888888888888', replayed: false, consultation: consultation() }), farms = {}, livestock = {}, vets = {} } = {}) {
  const pending = {
    read: async (userId) => store.get(userId) ?? null,
    write: async (userId, value) => { store.set(userId, value); },
    clear: async (userId) => { store.delete(userId); },
  };
  const calls = [];
  const service = new ServerBookingService(
    { getFarmById: async () => ({ id: id.farm, visitAddressId: id.address, species: [] }), getAddressById: async () => ({ id: id.address }), ...farms },
    { getById: async () => ({ id: id.animal, farmerId: id.farmer, farmId: id.farm, species: 'cattle' }), ...livestock },
    { getById: async () => ({ id: id.vet, timezone: 'UTC', acceptingNewRequests: true, services: ['visit'], species: ['cattle'] }), getSlots: async () => [{ startsAt: input.startsAt }], ...vets },
    { createQuote: async (operation) => { calls.push(['quote', operation]); return quoteResponse; }, create: async (operation) => { calls.push(['create', operation]); return create(operation); } },
    pending,
  );
  return { service, store, calls };
}

test('server booking quote checks role, Farm, animal, verified-vet service, available slot, and visit address', async () => {
  const { service, calls } = makeService();
  await assert.rejects(service.createQuote('vet', id.farmer, id.farm, input, 'quote-key-123'), { code: 'FORBIDDEN' });
  assert.equal(calls.length, 0);
  const saved = await service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123');
  assert.equal(saved.amountIdr, 125000);
  assert.deepEqual(calls[0], ['quote', { idempotencyKey: 'quote-key-123', payload: { ...input, complaint: 'Keluhan fiktif', addressId: id.address } }]);
});

test('server booking quote rejects foreign animal, unavailable slot/service and missing visit address before quote', async () => {
  const wrongOwner = makeService({ livestock: { getById: async () => ({ id: id.animal, farmerId: '99999999-9999-4999-8999-999999999999', farmId: id.farm, species: 'cattle' }) } });
  await assert.rejects(wrongOwner.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'FORBIDDEN' });
  const noSlot = makeService({ vets: { getSlots: async () => [] } });
  await assert.rejects(noSlot.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'INVALID_STATE' });
  const noAddress = makeService({ farms: { getFarmById: async () => ({ id: id.farm, visitAddressId: null, species: [] }) } });
  await assert.rejects(noAddress.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'VALIDATION_FAILED' });
  const wrongFarmSpecies = makeService({ farms: { getFarmById: async () => ({ id: id.farm, visitAddressId: id.address, species: ['goat'] }) } });
  await assert.rejects(wrongFarmSpecies.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'INVALID_STATE' });
  assert.equal(wrongOwner.calls.length + noSlot.calls.length + noAddress.calls.length + wrongFarmSpecies.calls.length, 0);
});

test('server booking quote rejects mismatched Farm/address and invalid server quote snapshots', async () => {
  const mismatchedFarm = makeService({ farms: { getFarmById: async () => ({ id: '99999999-9999-4999-8999-999999999999', visitAddressId: id.address, species: [] }) } });
  await assert.rejects(mismatchedFarm.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'FORBIDDEN' });
  const mismatchedAddress = makeService({ farms: { getAddressById: async () => ({ id: '99999999-9999-4999-8999-999999999999' }) } });
  await assert.rejects(mismatchedAddress.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'API_RESPONSE_INVALID' });
  const wrongQuoteAddress = makeService({ quoteResponse: quote({ visitAddressSnapshot: { id: '99999999-9999-4999-8999-999999999999' } }) });
  await assert.rejects(wrongQuoteAddress.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'API_RESPONSE_INVALID' });
  const unsafeAmount = makeService({ quoteResponse: quote({ amountIdr: Number.MAX_SAFE_INTEGER + 1 }) });
  await assert.rejects(unsafeAmount.service.createQuote('farmer', id.farmer, id.farm, input, 'quote-key-123'), { code: 'API_RESPONSE_INVALID' });
  assert.equal(mismatchedFarm.calls.length + mismatchedAddress.calls.length, 0);
});

test('server booking persists quote ID and same key before create, then retries a lost response', async () => {
  const store = new Map();
  let attempts = 0;
  const make = () => makeService({ store, create: async () => {
    attempts++;
    if (attempts === 1) throw new Error('response lost');
    return { operationId: '88888888-8888-4888-8888-888888888888', replayed: true, consultation: consultation() };
  } });
  const service1 = make().service;
  await assert.rejects(service1.createBooking('farmer', id.farmer, quote()), /response lost/);
  assert.deepEqual(await service1.getPendingBooking('farmer', id.farmer), { quoteId: id.quote, idempotencyKey: `consultation:${id.quote}` });
  const { service: service2, calls } = make();
  const result = await service2.retryPendingBooking('farmer', id.farmer);
  assert.equal(result.consultation.status, 'awaiting_payment');
  assert.equal(store.size, 0);
  assert.deepEqual(calls[0], ['create', { idempotencyKey: `consultation:${id.quote}`, payload: { quoteId: id.quote } }]);
  assert.equal(attempts, 2);
});

test('server booking rejects consumed/foreign quotes and refuses successful status outside pending payment', async () => {
  const { service } = makeService();
  await assert.rejects(service.createBooking('farmer', id.farmer, quote({ consumed: true })), { code: 'FORBIDDEN' });
  await assert.rejects(service.createBooking('farmer', '99999999-9999-4999-8999-999999999999', quote()), { code: 'FORBIDDEN' });
  const paid = makeService({ create: async () => ({ operationId: '88888888-8888-4888-8888-888888888888', replayed: false, consultation: consultation({ status: 'requested', paymentStatus: 'succeeded' }) }) });
  await assert.rejects(paid.service.createBooking('farmer', id.farmer, quote()), { code: 'API_RESPONSE_INVALID' });
});
