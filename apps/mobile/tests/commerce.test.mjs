import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CommerceService } from '../.test-build/src/application/CommerceService.js';
import { PaymentService } from '../.test-build/src/application/PaymentService.js';
import { LocalShippingQuoteAdapter } from '../.test-build/src/data/local/commerce/LocalShippingQuoteAdapter.js';
import { LocalShipmentStatusAdapter } from '../.test-build/src/data/local/commerce/LocalShipmentStatusAdapter.js';
import { SqliteCommerceRepository } from '../.test-build/src/data/local/sqlite/SqliteCommerceRepository.js';
import { SqliteDomainRepository } from '../.test-build/src/data/local/sqlite/SqliteDomainRepository.js';
import { SqliteProfileRepository } from '../.test-build/src/data/local/sqlite/SqliteProfileRepository.js';
import { migrateDatabase } from '../.test-build/src/data/local/sqlite/migrations.js';
import { seedFixturesIfEmpty } from '../.test-build/src/data/local/sqlite/seed.js';
import { fixtureIds as ids } from '../.test-build/src/testing/fixtures.js';

async function setup() {
  const db = new SQLiteAdapter();
  await migrateDatabase(db);
  await seedFixturesIfEmpty(db);
  const repository = new SqliteDomainRepository(db);
  const storage = new SqliteCommerceRepository(db);
  const profiles = new SqliteProfileRepository(db);
  let nextId = 1;
  const idFactory = { create: () => `commerce-test-${nextId++}` };
  const now = () => new Date('2026-10-13T00:00:00.000Z');
  return { db, repository, storage, idFactory, service: new CommerceService(storage, profiles, new LocalShippingQuoteAdapter(), idFactory, now, new LocalShipmentStatusAdapter(storage)) };
}

test('FE20 order list is owner scoped, uses item price snapshots and shipment adapter timeline', async () => {
  const s = await setup();
  try {
    const orders = await s.service.listOrders(ids.budi, 'farmer');
    const shipped = orders.find((order) => order.id === ids.order);
    const delivered = orders.find((order) => order.id === ids.deliveredOrder);
    assert.equal(shipped.status, 'shipped');
    assert.equal(shipped.paymentStatus, 'succeeded');
    assert.equal(shipped.totalAmount, 99000);
    assert.deepEqual(shipped.items.map((item) => [item.nameSnapshot, item.unitPrice, item.quantity, item.lineTotal]), [['Paket perawatan ternak fiktif', 45000, 2, 90000]]);
    assert.equal(shipped.trackingCode, 'TRK-FIKTIF-201');
    assert.equal(shipped.shipmentEvents[0].status, 'shipped');
    assert.equal(delivered.status, 'delivered');
    await assert.rejects(s.service.getOrder(ids.sari, 'farmer', ids.order), { code: 'NOT_FOUND' });
    await assert.rejects(s.service.listOrders(ids.vetZero, 'vet'), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE20 failed shipment remains a paid order and never appears delivered', async () => {
  const s = await setup();
  try {
    const quote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    const order = await s.service.submitOrder(ids.budi, 'farmer', quote.id);
    const payments = new PaymentService(s.storage, { submit: async () => ({ outcome: 'succeeded' }) }, s.idFactory);
    const payment = await payments.submit(ids.budi, 'farmer', 'order', order.id, 'bank_transfer', 'fe20-paid-order');
    const stamp = '2026-10-13T00:00:00.000Z';
    await s.repository.create({ id: 'shipment-failed-fe20', kind: 'shipment', ownerId: ids.budi, contextId: order.id, createdAt: stamp, updatedAt: stamp, version: 1, payload: { orderId: order.id, status: 'failed', trackingCode: 'TRK-FIKTIF-FAIL', events: [{ status: 'failed', time: stamp, description: 'Pengiriman tertunda.' }] } }, [{ sourceId: 'shipment-failed-fe20', targetId: order.id, relationship: 'order' }]);
    const detail = await s.service.getOrder(ids.budi, 'farmer', order.id);
    assert.equal(payment.status, 'succeeded');
    assert.equal(detail.status, 'paid');
    assert.equal(detail.shipmentEvents[0].status, 'failed');
    assert.notEqual(detail.status, 'delivered');
  } finally { s.db.close(); }
});

test('FE19 selecting a method is inert; persisted adapter outcome is idempotent and order remains separate', async () => {
  const s = await setup();
  try {
    const quote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    const order = await s.service.submitOrder(ids.budi, 'farmer', quote.id);
    let calls = 0;
    const payments = new PaymentService(s.storage, { submit: async () => { calls++; return { outcome: 'pending', message: 'Menunggu konfirmasi.' }; } }, s.idFactory, () => new Date('2026-10-13T00:00:00.000Z'));
    assert.equal((await s.repository.listByOwner('payment', ids.budi)).some((p) => p.payload.payableId === order.id), false);
    const [first, retry] = await Promise.all([
      payments.submit(ids.budi, 'farmer', 'order', order.id, 'bank_transfer', 'payment-order-once'),
      payments.submit(ids.budi, 'farmer', 'order', order.id, 'bank_transfer', 'payment-order-once'),
    ]);
    assert.equal(first.id, retry.id);
    assert.equal(first.status, 'pending');
    assert.equal((await s.repository.findById('order', order.id)).payload.status, 'awaiting_payment');
    assert.equal(calls, 1);
    await assert.rejects(payments.submit(ids.budi, 'farmer', 'order', order.id, 'e_wallet', 'another-pending-attempt'), { code: 'INVALID_STATE' });
    await assert.rejects(payments.submit(ids.budi, 'vet', 'order', order.id, 'bank_transfer', 'vet-attempt'), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE19 only persisted success marks an order paid; failed service result stays failed', async () => {
  const s = await setup();
  try {
    const quote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    const order = await s.service.submitOrder(ids.budi, 'farmer', quote.id);
    const failed = new PaymentService(s.storage, { submit: async () => ({ outcome: 'failed', message: 'Layanan gagal.' }) }, s.idFactory);
    const result = await failed.submit(ids.budi, 'farmer', 'order', order.id, 'e_wallet', 'failed-order-attempt');
    assert.equal(result.status, 'failed');
    assert.equal((await s.repository.findById('order', order.id)).payload.status, 'awaiting_payment');
    const succeeded = new PaymentService(s.storage, { submit: async () => ({ outcome: 'succeeded' }) }, s.idFactory);
    const paid = await succeeded.submit(ids.budi, 'farmer', 'order', order.id, 'e_wallet', 'success-order-attempt');
    assert.equal(paid.status, 'succeeded');
    const savedOrder = await s.repository.findById('order', order.id);
    assert.equal(savedOrder.payload.status, 'paid');
    assert.equal(savedOrder.payload.paymentId, paid.id);
    assert.deepEqual((await succeeded.list(ids.budi, 'farmer')).filter((item) => item.payableId === order.id).map((item) => item.status).sort(), ['failed', 'succeeded']);
  } finally { s.db.close(); }
});

function validAddress(overrides = {}) {
  return {
    label: 'Alamat rumah',
    recipient: 'Budi Santoso',
    phone: '081234567890',
    address: 'Jalan Ternak Fiktif Nomor 1',
    city: 'Bogor',
    province: 'Jawa Barat',
    postalCode: '16111',
    ...overrides,
  };
}

test('FE18 cart quantities are positive integers; removal returns an empty cart and Dokter is denied', async () => {
  const s = await setup();
  try {
    const initial = await s.service.getCart(ids.budi, 'farmer');
    assert.equal(initial.lines.length, 1);
    assert.equal(initial.lines[0].quantity, 2);
    await assert.rejects(s.service.setQuantity(ids.budi, 'farmer', ids.product, 0), { code: 'VALIDATION_FAILED' });
    await assert.rejects(s.service.setQuantity(ids.budi, 'farmer', ids.product, 1.5), { code: 'VALIDATION_FAILED' });

    const updated = await s.service.setQuantity(ids.budi, 'farmer', ids.product, 3);
    assert.equal(updated.lines[0].quantity, 3);
    assert.equal(updated.subtotal, 135000);
    const empty = await s.service.removeItem(ids.budi, 'farmer', ids.product);
    assert.deepEqual(empty.lines, []);
    assert.equal(empty.subtotal, 0);
    assert.equal((await s.service.getCart(ids.budi, 'farmer')).quantityCount, 0);
    await assert.rejects(s.service.getCart(ids.vetZero, 'vet'), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.addItem(ids.vetZero, 'vet', ids.product), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE18 requires a complete address and fails unsupported local shipping before writing a quote', async () => {
  const s = await setup();
  try {
    await assert.rejects(s.service.createQuote(ids.budi, 'farmer', { address: {} }), { code: 'VALIDATION_FAILED' });
    await assert.rejects(s.service.createQuote(ids.budi, 'farmer', {
      address: validAddress({ city: 'Makassar', province: 'Sulawesi Selatan' }),
    }), { code: 'INVALID_STATE' });
    assert.equal((await s.repository.listByKind('quote')).length, 0);
    assert.equal((await s.repository.listByOwner('address', ids.budi)).length, 1);
    await s.service.addItem(ids.sari, 'farmer', ids.product);
    await assert.rejects(s.service.createQuote(ids.sari, 'farmer', { addressId: ids.budiAddress }), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE18 quote totals and checkout persist immutable item/address snapshots; retries create one order', async () => {
  const s = await setup();
  try {
    const quote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    assert.equal(quote.subtotal, 90000);
    assert.equal(quote.shippingAmount, 9000);
    assert.equal(quote.totalAmount, 99000);
    assert.equal(quote.lines[0].unitPrice, 45000);
    assert.equal(quote.lines[0].quantity, 2);

    const [order, retry] = await Promise.all([
      s.service.submitOrder(ids.budi, 'farmer', quote.id),
      s.service.submitOrder(ids.budi, 'farmer', quote.id),
    ]);
    assert.equal(order.id, retry.id);
    assert.equal(order.status, 'awaiting_payment');
    assert.equal(order.paymentId, null);
    assert.equal(order.totalAmount, 99000);
    assert.equal(order.address.address, 'Jalan Ternak Fiktif Nomor 1');
    assert.deepEqual(order.items.map(({ nameSnapshot, unitPrice, quantity, lineTotal }) => ({ nameSnapshot, unitPrice, quantity, lineTotal })), [
      { nameSnapshot: 'Paket perawatan ternak fiktif', unitPrice: 45000, quantity: 2, lineTotal: 90000 },
    ]);
    assert.equal((await s.repository.listByOwner('order', ids.budi)).filter((item) => item.payload.operationKey === `checkout:${quote.id}`).length, 1);
    assert.equal((await s.repository.listByOwner('orderItem', ids.budi)).filter((item) => item.payload.orderId === order.id).length, 1);
    assert.deepEqual((await s.service.getCart(ids.budi, 'farmer')).lines, []);

    const product = await s.repository.findById('product', ids.product);
    await s.repository.update({ ...product, version: product.version + 1, payload: { ...product.payload, unitPrice: 99000 } }, product.version);
    const savedOrder = await s.repository.findById('order', order.id);
    assert.equal(savedOrder.payload.totalSnapshot, 99000);
    assert.equal(order.items[0].unitPrice, 45000);
  } finally { s.db.close(); }
});

test('FE18 rejects a stale cart price or address after a quote was created', async () => {
  const s = await setup();
  try {
    const quote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    const product = await s.repository.findById('product', ids.product);
    await s.repository.update({ ...product, version: product.version + 1, payload: { ...product.payload, unitPrice: 50000 } }, product.version);
    await assert.rejects(s.service.submitOrder(ids.budi, 'farmer', quote.id), { code: 'VERSION_CONFLICT' });
    assert.equal((await s.repository.listByOwner('order', ids.budi)).some((item) => item.payload.quoteId === quote.id), false);

    const freshQuote = await s.service.createQuote(ids.budi, 'farmer', { address: validAddress() });
    const address = await s.repository.findById('address', freshQuote.address.id);
    await s.repository.update({ ...address, version: address.version + 1, payload: { ...address.payload, address: 'Jalan lain yang berbeda' } }, address.version);
    await assert.rejects(s.service.submitOrder(ids.budi, 'farmer', freshQuote.id), { code: 'VERSION_CONFLICT' });
  } finally { s.db.close(); }
});

class SQLiteAdapter {
  constructor() { this.database = new DatabaseSync(':memory:'); this.database.exec('PRAGMA foreign_keys = ON'); this.queue = Promise.resolve(); }
  async execAsync(sql) { this.database.exec(sql); }
  async getFirstAsync(sql, ...bindings) { return this.database.prepare(sql).get(...bindings) ?? null; }
  async getAllAsync(sql, ...bindings) { return this.database.prepare(sql).all(...bindings); }
  async runAsync(sql, ...bindings) { return this.database.prepare(sql).run(...bindings); }
  async withExclusiveTransactionAsync(action) {
    const task = this.queue.then(async () => {
      this.database.exec('BEGIN IMMEDIATE');
      try { await action(this); this.database.exec('COMMIT'); }
      catch (error) { this.database.exec('ROLLBACK'); throw error; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  close() { this.database.close(); }
}
