import type { SQLiteDatabase } from 'expo-sqlite';
import { validateFixtureGraph } from '../../../domain/fixtureValidation';
import { consultationFixtureEntities, consultationFixtureRelations, directoryFixturePatches, fixtureEntities, fixtureIds, fixtureRelations, fixtureSeedVersion } from '../../../testing/fixtures';
import { insertEntity, insertRelations } from './entitySql';

const seededAt = '2026-10-05T00:00:00.000Z';

export type SeedResult =
  | { status: 'seeded'; version: string; entityCount: number; relationCount: number }
  | { status: 'already-seeded'; version: string; entityCount: number; relationCount: number }
  | { status: 'skipped-nonempty'; entityCount: number; relationCount: number };

export async function seedFixturesIfEmpty(database: SQLiteDatabase): Promise<SeedResult> {
  validateFixtureGraph([...fixtureEntities, ...consultationFixtureEntities], [...fixtureRelations, ...consultationFixtureRelations]);
  let result: SeedResult | undefined;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const marker = await transaction.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = 'fixture_seed_version'",
    );
    if (marker) {
      if (marker.value === fixtureSeedVersion) {
        await extendDirectoryFixtures(transaction);
        await extendConsultationFixtures(transaction);
      }
      const counts = await getCounts(transaction);
      result = {
        status: 'already-seeded',
        version: marker.value,
        entityCount: counts.entityCount,
        relationCount: counts.relationCount,
      };
      return;
    }
    const counts = await getCounts(transaction);
    if (counts.entityCount > 0) {
      result = { status: 'skipped-nonempty', ...counts };
      return;
    }

    for (const entity of fixtureEntities) await insertEntity(transaction, entity);
    await insertRelations(transaction, fixtureRelations);
    await transaction.runAsync(
      `INSERT INTO domain_events (id, type, aggregate_id, occurred_at, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      'fixture-consultation-requested',
      'consultation.requested',
      fixtureIds.request,
      '2026-10-03T03:00:00.000Z',
      JSON.stringify({ fixture: true, recipientId: fixtureIds.budi }),
    );
    await transaction.runAsync(
      'INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)',
      'fixture_seed_version',
      fixtureSeedVersion,
      seededAt,
    );
    await transaction.runAsync('INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)', 'fixture_directory_version', 'fe08-v1', seededAt);
    await extendConsultationFixtures(transaction);
    const afterSeed = await getCounts(transaction);
    result = {
      status: 'seeded',
      version: fixtureSeedVersion,
      entityCount: afterSeed.entityCount,
      relationCount: afterSeed.relationCount,
    };
  });

  return result!;
}

async function extendDirectoryFixtures(database: SQLiteDatabase): Promise<void> {
  const marker = await database.getFirstAsync<{ value: string }>("SELECT value FROM app_metadata WHERE key = 'fixture_directory_version'");
  if (marker) return;
  for (const [id, fields] of Object.entries(directoryFixturePatches)) {
    const fixture = fixtureEntities.find((item) => item.id === id)!;
    const row = await database.getFirstAsync<{ payload_json: string; updated_at: string }>('SELECT payload_json, updated_at FROM entities WHERE id = ? AND kind = ? AND owner_id = ?', id, fixture.kind, fixture.ownerId);
    if (!row) continue;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const missing = Object.fromEntries(Object.entries(fields).filter(([key]) => !Object.hasOwn(payload, key)));
    if (!Object.keys(missing).length) continue;
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updated_at) || 0)).toISOString();
    await database.runAsync('UPDATE entities SET payload_json = ?, version = version + 1, updated_at = ? WHERE id = ?', JSON.stringify({ ...payload, ...missing }), updatedAt, id);
  }
  const review = fixtureEntities.find((item) => item.id === fixtureIds.yudaReview)!;
  const consultation = await database.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM entities WHERE id = ? AND kind = ?', fixtureIds.completed, 'consultation');
  const existing = await database.getFirstAsync<{ id: string }>("SELECT id FROM entities WHERE id = ? OR (kind = 'review' AND json_extract(payload_json, '$.consultationId') = ?)", review.id, fixtureIds.completed);
  if (consultation && !existing) {
    const payload = JSON.parse(consultation.payload_json) as Record<string, unknown>;
    if (payload.status === 'completed' && payload.vetId === fixtureIds.vetZero && payload.farmerId === fixtureIds.sari) {
      await insertEntity(database, review);
      await insertRelations(database, fixtureRelations.filter((relation) => relation.sourceId === review.id));
    }
  }
  await database.runAsync('INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)', 'fixture_directory_version', 'fe08-v1', new Date().toISOString());
}

async function getCounts(database: SQLiteDatabase) {
  const [entity, relation] = await Promise.all([
    database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM entities'),
    database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM entity_relations'),
  ]);
  return { entityCount: entity?.count ?? 0, relationCount: relation?.count ?? 0 };
}

export async function readFixtureSeedVersion(database: SQLiteDatabase): Promise<string | null> {
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = 'fixture_seed_version'",
  );
  return row?.value ?? null;
}

async function extendConsultationFixtures(database: SQLiteDatabase): Promise<void> {
  if (await database.getFirstAsync("SELECT value FROM app_metadata WHERE key = 'fixture_consultations_version'")) return;
  for (const record of consultationFixtureEntities) {
    const existing = await database.getFirstAsync<{ id: string }>('SELECT id FROM entities WHERE id = ?', record.id);
    if (existing) throw new Error('FE-10 fixture ID collision; existing data preserved.');
    await insertEntity(database, record);
  }
  await insertRelations(database, consultationFixtureRelations);
  await database.runAsync('INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)', 'fixture_consultations_version', 'fe10-v1', new Date().toISOString());
}
