import type { SQLiteDatabase } from 'expo-sqlite';
import { validateFixtureGraph } from '../../../domain/fixtureValidation';
import { fixtureEntities, fixtureIds, fixtureRelations, fixtureSeedVersion } from '../../../testing/fixtures';
import { insertEntity, insertRelations } from './entitySql';

const seededAt = '2026-10-05T00:00:00.000Z';

export type SeedResult =
  | { status: 'seeded'; version: string; entityCount: number; relationCount: number }
  | { status: 'already-seeded'; version: string; entityCount: number; relationCount: number }
  | { status: 'skipped-nonempty'; entityCount: number; relationCount: number };

export async function seedFixturesIfEmpty(database: SQLiteDatabase): Promise<SeedResult> {
  validateFixtureGraph(fixtureEntities, fixtureRelations);
  let result: SeedResult | undefined;

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const marker = await transaction.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = 'fixture_seed_version'",
    );
    const counts = await getCounts(transaction);
    if (marker) {
      result = {
        status: 'already-seeded',
        version: marker.value,
        entityCount: counts.entityCount,
        relationCount: counts.relationCount,
      };
      return;
    }
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
