import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../.test-build/src/data/remote/ApiClient.js';
import { HttpApiCommerceRepository } from '../.test-build/src/data/remote/HttpApiCommerceRepository.js';

const id = {
  farmer: '11111111-1111-4111-8111-111111111111', cart: '22222222-2222-4222-8222-222222222222',
  product: '33333333-3333-4333-8333-333333333333', address: '44444444-4444-4444-8444-444444444444',
  quote: '55555555-5555-4555-8555-555555555555', order: '66666666-6666-4666-8666-666666666666',
  item: '77777777-7777-4777-8777-777777777777', operation: '88888888-8888-4888-8888-888888888888',
};
const at = '2026-11-18T01:00:00.000Z';
const item = { productId: id.product, name: 'Produk fiktif', category: 'Perawatan',
  unitPriceIdr: 12000, quantity: 2, lineTotalIdr: 24000, active: true };
const cart = { id: id.cart, farmerId: id.farmer, version: 2, currency: 'IDR', items: [item],
  subtotalIdr: 24000, itemCount: 1, quantityCount: 2, hasUnavailableItems: false };
const address = { id: id.address, label: 'Farm A', recipientName: 'Budi Fiktif', phone: '0800000000',
  addressLine: 'Jalan Fiktif', city: 'Bogor', province: 'Jawa Barat', postalCode: '16000' };
const line = { productId: id.product, nameSnapshot: item.name, categorySnapshot: item.category,
  unitPriceIdr: 12000, quantity: 2, lineTotalIdr: 24000 };
const quote = { id: id.quote, cartId: id.cart, cartVersion: 2, addressId: id.address,
  addressSnapshot: address, items: [line], subtotalIdr: 24000, shippingAmountIdr: 9000,
  shippingLabel: 'Ongkir lokal', totalIdr: 33000, currency: 'IDR', expiresAt: '2026-11-18T01:15:00.000Z' };
const order = { id: id.order, displayCode: 'VL-O-1', status: 'awaiting_payment', checkoutQuoteId: id.quote,
  addressId: id.address, addressSnapshot: address, items: [{ ...line, id: id.item }],
  subtotalIdr: 24000, shippingAmountIdr: 9000, shippingLabel: 'Ongkir lokal', totalIdr: 33000,
  currency: 'IDR', paymentId: null, paymentStatus: null, createdAt: at, version: 1 };

test('cart changes use server version and price; removal sends only expectedVersion', async () => {
  const calls = [];
  const repository = new HttpApiCommerceRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'DELETE') return response(200, { ...cart, version: 3, items: [], subtotalIdr: 0,
      itemCount: 0, quantityCount: 0 });
    return response(200, cart);
  }));
  assert.equal((await repository.getCart()).subtotalIdr, 24000);
  assert.equal((await repository.setCartItem(id.product, 2, 2)).items[0].quantity, 2);
  assert.equal((await repository.removeCartItem(id.product, 2)).itemCount, 0);
  assert.deepEqual(JSON.parse(calls[1].init.body), { quantity: 2, expectedVersion: 2 });
  assert.equal(calls[2].url.endsWith(`/${id.product}?expectedVersion=2`), true);
  assert.equal(calls[2].init.body, undefined);
});

test('checkout quote and idempotent order preserve server totals and awaiting_payment', async () => {
  const calls = [];
  const repository = new HttpApiCommerceRepository(apiClient(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/checkout-quotes')) return response(201, quote);
    if (calls.length === 2) throw new Error('response lost');
    return response(200, { operationId: id.operation, replayed: true, order });
  }));
  assert.equal((await repository.createQuote(id.address)).totalIdr, 33000);
  assert.deepEqual(JSON.parse(calls[0].init.body), { addressId: id.address });
  const key = 'order-operation-1';
  await assert.rejects(repository.createOrder(id.quote, key), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(calls.length, 2, 'no automatic retry after uncertain POST');
  const replay = await repository.createOrder(id.quote, key);
  assert.equal(replay.order.status, 'awaiting_payment');
  assert.equal(replay.replayed, true);
  assert.deepEqual(JSON.parse(calls[1].init.body), { quoteId: id.quote });
  assert.equal(calls[1].init.body, calls[2].init.body);
  assert.equal(calls[1].init.headers['Idempotency-Key'], calls[2].init.headers['Idempotency-Key']);
});

test('order page, detail, and shipment timeline retain owner-scoped server context', async () => {
  const calls = [];
  const shipment = { orderId: id.order, orderStatus: 'awaiting_payment', shipment: null,
    events: [{ id: `order:${id.order}:created`, eventId: null, type: 'order_created', outcome: 'succeeded',
      orderStatus: 'awaiting_payment', shipmentStatus: null, trackingCode: null,
      description: 'Pesanan dibuat.', occurredAt: at }] };
  const repository = new HttpApiCommerceRepository(apiClient(async (url) => {
    calls.push(url);
    if (url.includes('/shipment')) return response(200, shipment);
    if (url.includes('limit=')) return response(200, { items: [order], nextCursor: null, hasMore: false });
    return response(200, order);
  }));
  assert.equal((await repository.listOrders({ limit: 10, cursor: 'opaque' })).items[0].id, id.order);
  assert.equal((await repository.getOrder(id.order)).paymentStatus, null);
  assert.equal((await repository.getShipment(id.order)).events[0].type, 'order_created');
  assert.ok(calls[0].includes('cursor=opaque&limit=10'));
});

test('commerce adapter rejects invalid quantity, stale IDs, forged totals and malformed results', async () => {
  let calls = 0;
  const repository = new HttpApiCommerceRepository(apiClient(async () => { calls += 1; return response(200, cart); }));
  await assert.rejects(repository.setCartItem(id.product, 0, 2), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.removeCartItem('bad-id', 2), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createQuote('bad-id'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.createOrder(id.quote, 'short'), { code: 'VALIDATION_FAILED' });
  await assert.rejects(repository.listOrders({ limit: 101 }), { code: 'VALIDATION_FAILED' });
  assert.equal(calls, 0);
  const wrong = new HttpApiCommerceRepository(apiClient(async () => response(200, {
    ...quote, totalIdr: 32000,
  })));
  await assert.rejects(wrong.createQuote(id.address), { code: 'API_RESPONSE_INVALID' });
  const invalidOrder = new HttpApiCommerceRepository(apiClient(async () => response(201, {
    operationId: id.operation, replayed: false, order: { ...order, status: 'paid' },
  })));
  await assert.rejects(invalidOrder.createOrder(id.quote, 'order-operation-2'), { code: 'API_RESPONSE_INVALID' });
});

function apiClient(fetcher) {
  return new ApiClient('http://localhost:3000', {
    async read() { return { accessToken: 'access-token-1', refreshToken: 'refresh-token-1', sessionId: 'session-1' }; },
    async save() {}, async clear() {},
  }, fetcher);
}
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
