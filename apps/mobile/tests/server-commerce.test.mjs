import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerCommerceService } from '../.test-build/src/application/ServerCommerceService.js';
import { DomainError } from '../.test-build/src/domain/errors.js';

const id = {
  farmer: '11111111-1111-4111-8111-111111111111',
  product: '22222222-2222-4222-8222-222222222222',
  address: '33333333-3333-4333-8333-333333333333',
  quote: '44444444-4444-4444-8444-444444444444',
  order: '55555555-5555-4555-8555-555555555555',
};

const cart = { id: '66666666-6666-4666-8666-666666666666', farmerId: id.farmer, version: 3, currency: 'IDR', items: [], subtotalIdr: 0, itemCount: 0, quantityCount: 0, hasUnavailableItems: false };
const address = { id: id.address, label: 'Farm', recipientName: 'Peternak Fiktif', phone: '08000000000', addressLine: 'Jalan Fiktif 1', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111', version: 1 };
const quote = {
  id: id.quote, cartId: cart.id, cartVersion: cart.version, addressId: address.id,
  addressSnapshot: { id: address.id, label: address.label, recipientName: address.recipientName, phone: address.phone, addressLine: address.addressLine, city: address.city, province: address.province, postalCode: address.postalCode },
  items: [{ productId: id.product, nameSnapshot: 'Pakan fiktif', categorySnapshot: 'care', unitPriceIdr: 10000, quantity: 2, lineTotalIdr: 20000 }],
  subtotalIdr: 20000, shippingAmountIdr: 9000, shippingLabel: 'Estimasi lokal', totalIdr: 29000, currency: 'IDR', expiresAt: '2099-01-01T00:00:00.000Z',
};

const order = {
  id: id.order, displayCode: 'VL-O-TEST', status: 'awaiting_payment', checkoutQuoteId: id.quote,
  addressId: id.address, addressSnapshot: quote.addressSnapshot,
  items: [{ id: '77777777-7777-4777-8777-777777777777', ...quote.items[0] }],
  subtotalIdr: 20000, shippingAmountIdr: 9000, shippingLabel: 'Estimasi lokal', totalIdr: 29000,
  currency: 'IDR', paymentId: null, paymentStatus: null, createdAt: '2026-11-20T00:00:00.000Z', version: 1,
};

function harness({ currentCart = cart, orderResponse = { operationId: id.order, replayed: false, order }, createOrder } = {}) {
  let pending = null;
  const calls = [];
  const repository = {
    async search() { return { items: [], nextCursor: null, hasMore: false }; },
    async getById() { return { id: id.product, name: 'Pakan', category: 'care', species: [], description: '', unitPrice: 10000, currency: 'IDR', active: true }; },
  };
  const commerce = {
    async getCart() { return currentCart; },
    async setCartItem(productId, quantity, expectedVersion) { calls.push(['set', productId, quantity, expectedVersion]); return { ...currentCart, version: expectedVersion + 1 }; },
    async removeCartItem(productId, expectedVersion) { calls.push(['remove', productId, expectedVersion]); return currentCart; },
    async createQuote(addressId) { return { ...quote, addressId, addressSnapshot: { ...quote.addressSnapshot, id: addressId } }; },
    async createOrder(quoteId, idempotencyKey) { calls.push(['order', quoteId, idempotencyKey, pending]); return createOrder ? createOrder(quoteId, idempotencyKey) : orderResponse; },
    async listOrders() { return { items: [], nextCursor: null, hasMore: false }; },
    async getOrder(orderId) { return { ...order, id: orderId }; },
    async getShipment(orderId) { return { orderId, orderStatus: 'awaiting_payment', shipment: null, events: [] }; },
  };
  const farms = {
    async listAddresses() { return [address]; },
    async getAddressById(addressId) { return { ...address, id: addressId }; },
  };
  const store = {
    async read() { return pending; },
    async write(_userId, operation) {
      if (pending && JSON.stringify(pending) !== JSON.stringify(operation)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'pending');
      pending = operation;
    },
    async clear() { pending = null; },
  };
  return { service: new ServerCommerceService(repository, commerce, farms, store), repository, commerce, farms, store, calls, get pending() { return pending; } };
}

test('server commerce enforces Farmer role and cart owner before read or mutation', async () => {
  const blocked = harness();
  await assert.rejects(blocked.service.getCart('vet', id.farmer), { code: 'FORBIDDEN' });
  assert.throws(() => blocked.service.listProducts('vet'), { code: 'FORBIDDEN' });
  const foreign = harness({ currentCart: { ...cart, farmerId: id.order } });
  await assert.rejects(foreign.service.getCart('farmer', id.farmer), { code: 'FORBIDDEN' });
});

test('cart updates use the latest server version and reject invalid quantities before mutation', async () => {
  const value = harness({ currentCart: { ...cart, version: 7 } });
  await assert.rejects(value.service.setQuantity('farmer', id.farmer, id.product, 0), { code: 'VALIDATION_FAILED' });
  assert.equal(value.calls.length, 0);
  await value.service.setQuantity('farmer', id.farmer, id.product, 4);
  assert.deepEqual(value.calls[0], ['set', id.product, 4, 7]);
});

test('checkout quote requires an owned address and matches the latest cart snapshot', async () => {
  const items = [{ productId: id.product, name: 'Pakan', category: 'care', unitPriceIdr: 10000, quantity: 2, lineTotalIdr: 20000, active: true }];
  const value = harness({ currentCart: { ...cart, items, itemCount: 1, quantityCount: 2, subtotalIdr: 20000 } });
  const result = await value.service.createQuote('farmer', id.farmer, id.address);
  assert.equal(result.addressId, id.address);
  const wrongOwner = harness({ currentCart: { ...cart, farmerId: id.order, items, itemCount: 1, quantityCount: 2, subtotalIdr: 20000 } });
  await assert.rejects(wrongOwner.service.createQuote('farmer', id.farmer, id.address), { code: 'FORBIDDEN' });
});

test('order POST journals quote and key first, then uncertain recovery reuses the same operation', async () => {
  let fail = true;
  const value = harness({ createOrder: async () => {
    assert.deepEqual(value.pending, { quoteId: id.quote, idempotencyKey: `order:${id.quote}` });
    if (fail) throw new DomainError('SERVICE_UNAVAILABLE', 'unknown result');
    return { operationId: id.order, replayed: true, order: { ...order, status: 'awaiting_payment' } };
  } });
  await assert.rejects(value.service.createOrder('farmer', id.farmer, quote), { code: 'SERVICE_UNAVAILABLE' });
  assert.ok(value.pending);
  fail = false;
  const restarted = new ServerCommerceService(value.repository, value.commerce, value.farms, value.store);
  const recovered = await restarted.retryPendingOrder('farmer', id.farmer);
  assert.equal(recovered.checkoutQuoteId, id.quote);
  assert.deepEqual(value.calls[0], ['order', id.quote, `order:${id.quote}`, { quoteId: id.quote, idempotencyKey: `order:${id.quote}` }]);
  assert.deepEqual(value.calls[1], value.calls[0]);
  assert.equal(value.pending, null);
});

test('order response mismatch is rejected and unresolved quote cannot be replaced', async () => {
  const value = harness({ orderResponse: { operationId: id.order, replayed: false, order: { ...order, checkoutQuoteId: id.order } } });
  await assert.rejects(value.service.createOrder('farmer', id.farmer, quote), { code: 'API_RESPONSE_INVALID' });
  assert.ok(value.pending);
  await assert.rejects(value.service.createOrder('farmer', id.farmer, { ...quote, id: '88888888-8888-4888-8888-888888888888' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
