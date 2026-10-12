import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CatalogService } from '../.test-build/src/application/CatalogService.js';
import { selectCatalogProducts } from '../.test-build/src/domain/catalog.js';
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
  const profiles = new SqliteProfileRepository(db);
  return { db, repository, service: new CatalogService(repository, profiles) };
}

function product(id, payload) {
  const timestamp = '2026-10-13T00:00:00.000Z';
  return { id, kind: 'product', ownerId: null, contextId: null, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
}

async function addRecommendation(s, { recommendationId = 'catalog-recommendation-1', consultationId = ids.chatFlow, productId = ids.product } = {}) {
  await s.repository.create({
    id: recommendationId,
    kind: 'recommendation',
    ownerId: ids.vetZero,
    contextId: consultationId,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    version: 1,
    payload: { consultationId, vetId: ids.vetZero, status: 'sent', sentAt: '2026-10-13T00:00:00.000Z' },
  }, [{ sourceId: consultationId, targetId: recommendationId, relationship: 'recommendation' }]);
  await s.repository.create({
    id: 'catalog-recommendation-item-1',
    kind: 'recommendationItem',
    ownerId: ids.vetZero,
    contextId: recommendationId,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    version: 1,
    payload: { recommendationId, productId, titleSnapshot: 'Perawatan ternak fiktif', instructions: 'Instruksi umum tanpa dosis.', note: '', position: 0 },
  }, [
    { sourceId: 'catalog-recommendation-item-1', targetId: recommendationId, relationship: 'recommendation' },
    { sourceId: 'catalog-recommendation-item-1', targetId: productId, relationship: 'product' },
  ]);
  return recommendationId;
}

test('FE17 reads active catalog products and applies combined query, category, and species filters', async () => {
  const s = await setup();
  try {
    await s.repository.create(product('catalog-supplement-1', {
      name: 'Suplemen ternak fiktif', category: 'supplement', species: ['cattle'], description: 'Informasi fiktif untuk filter.', unitPrice: 12000, currency: 'IDR', active: true,
    }));
    await s.repository.create(product('catalog-equipment-1', {
      name: 'Peralatan kandang fiktif', category: 'equipment', species: ['goat'], description: 'Peralatan lokal fiktif.', unitPrice: 55000, currency: 'IDR', active: true,
    }));
    await s.repository.create(product('catalog-inactive-1', {
      name: 'Produk tidak aktif fiktif', category: 'care', species: ['cattle'], description: 'Tidak tersedia.', unitPrice: 9000, currency: 'IDR', active: false,
    }));

    const catalog = await s.service.listProducts(ids.budi, 'farmer');
    assert.equal(catalog.some((item) => item.id === 'catalog-inactive-1'), false);
    assert.equal(catalog.find((item) => item.id === ids.product).unitPrice, 45000);
    assert.equal(catalog.find((item) => item.id === ids.product).currency, 'IDR');
    assert.deepEqual(selectCatalogProducts(catalog, { query: 'ternak fiktif', category: 'care', species: 'cattle' }).map((item) => item.id), [ids.product]);
    assert.deepEqual(selectCatalogProducts(catalog, { query: 'fiktif', category: 'supplement', species: 'cattle' }).map((item) => item.id), ['catalog-supplement-1']);
    assert.deepEqual(selectCatalogProducts(catalog, { category: 'equipment', species: 'cattle' }), []);
  } finally { s.db.close(); }
});

test('FE17 reports unknown/inactive products clearly and keeps marketplace farmer-only', async () => {
  const s = await setup();
  try {
    await s.repository.create(product('catalog-inactive-2', {
      name: 'Produk lama fiktif', category: 'care', species: ['goat'], description: 'Tidak tersedia.', unitPrice: 10000, currency: 'IDR', active: false,
    }));
    await assert.rejects(s.service.getProduct(ids.budi, 'farmer', 'unknown-product'), { code: 'NOT_FOUND' });
    await assert.rejects(s.service.getProduct(ids.budi, 'farmer', 'catalog-inactive-2'), { code: 'INVALID_STATE' });
    await assert.rejects(s.service.listProducts(ids.vetZero, 'vet'), { code: 'FORBIDDEN' });
  } finally { s.db.close(); }
});

test('FE17 validates the exact sent recommendation, consultation, farmer, item, and product links', async () => {
  const s = await setup();
  try {
    const recommendationId = await addRecommendation(s);
    await s.repository.create(product('catalog-unlinked-1', {
      name: 'Produk katalog lain fiktif', category: 'care', species: ['cattle'], description: 'Produk lain.', unitPrice: 20000, currency: 'IDR', active: true,
    }));

    await s.service.assertRecommendationContext(ids.budi, recommendationId, ids.chatFlow);
    const linked = await s.service.getRecommendedProduct(ids.budi, recommendationId, ids.chatFlow, ids.product);
    assert.equal(linked.id, ids.product);
    assert.equal(linked.unitPrice, 45000);
    await assert.rejects(s.service.getRecommendedProduct(ids.budi, ids.chatFlow, ids.chatFlow, ids.product), { code: 'NOT_FOUND' });
    await assert.rejects(s.service.getRecommendedProduct(ids.budi, recommendationId, ids.completed, ids.product), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.getRecommendedProduct(ids.sari, recommendationId, ids.chatFlow, ids.product), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.getRecommendedProduct(ids.budi, recommendationId, ids.chatFlow, 'catalog-unlinked-1'), { code: 'FORBIDDEN' });
    await assert.rejects(s.service.getRecommendedProduct(ids.budi, recommendationId, ids.chatFlow, 'unknown-product'), { code: 'NOT_FOUND' });
  } finally { s.db.close(); }
});

test('FE17 reports an inactive product reached from a valid sent recommendation', async () => {
  const s = await setup();
  try {
    const recommendationId = await addRecommendation(s);
    const current = await s.repository.findById('product', ids.product);
    await s.repository.update({ ...current, version: current.version + 1, payload: { ...current.payload, active: false } }, current.version);
    await assert.rejects(s.service.getRecommendedProduct(ids.budi, recommendationId, ids.chatFlow, ids.product), { code: 'INVALID_STATE' });
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
