import type { SQLiteDatabase } from 'expo-sqlite';
import { DomainError } from '../../../domain/errors';

interface Migration {
  version: number;
  sql: string;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE entities (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        owner_id TEXT REFERENCES entities(id) ON DELETE RESTRICT,
        context_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        idempotency_key TEXT,
        event_id TEXT,
        recipient_id TEXT,
        source_key TEXT,
        UNIQUE (kind, id)
      );

      CREATE INDEX entities_kind_owner_updated
        ON entities(kind, owner_id, updated_at DESC, id);
      CREATE INDEX entities_kind_context_updated
        ON entities(kind, context_id, updated_at DESC, id);
      CREATE UNIQUE INDEX entities_idempotency_key
        ON entities(kind, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX notification_recipient_event
        ON entities(recipient_id, event_id)
        WHERE kind = 'notification' AND recipient_id IS NOT NULL AND event_id IS NOT NULL;
      CREATE UNIQUE INDEX health_event_source_key
        ON entities(source_key)
        WHERE kind = 'healthEvent' AND source_key IS NOT NULL;

      CREATE TABLE entity_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL,
        target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        UNIQUE (source_id, relationship, target_id)
      );
      CREATE INDEX entity_relations_target ON entity_relations(target_id, relationship, source_id);

      CREATE TABLE domain_events (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE event_effects (
        event_id TEXT NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
        effect_key TEXT NOT NULL,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
        PRIMARY KEY (event_id, effect_key),
        UNIQUE (event_id, entity_id)
      );

      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE UNIQUE INDEX user_email_unique
        ON entities(lower(trim(json_extract(payload_json, '$.email'))))
        WHERE kind = 'user' AND json_type(payload_json, '$.email') = 'text';
    `,
  },
  {
    version: 3,
    sql: `
      UPDATE entities AS profile
      SET payload_json = json_set(profile.payload_json, '$.farmId', (
        SELECT relation.target_id
        FROM entity_relations relation
        JOIN entities farm ON farm.id = relation.target_id AND farm.kind = 'farm'
        WHERE relation.source_id = profile.id AND relation.relationship = 'farm'
          AND farm.owner_id = profile.owner_id
        ORDER BY relation.id LIMIT 1
      ))
      WHERE profile.kind = 'farmerProfile'
        AND (json_type(profile.payload_json, '$.farmId') IS NULL OR json_type(profile.payload_json, '$.farmId') = 'null')
        AND EXISTS (
          SELECT 1 FROM entity_relations relation
          JOIN entities farm ON farm.id = relation.target_id AND farm.kind = 'farm'
          WHERE relation.source_id = profile.id AND relation.relationship = 'farm'
            AND farm.owner_id = profile.owner_id
        );

      INSERT INTO entity_relations (source_id, relationship, target_id)
      SELECT farm.id, 'owner', farm.owner_id
      FROM entities farm
      JOIN entities owner ON owner.id = farm.owner_id AND owner.kind = 'user'
      WHERE farm.kind = 'farm'
        AND NOT EXISTS (
          SELECT 1 FROM entity_relations relation
          WHERE relation.source_id = farm.id AND relation.relationship = 'owner'
            AND relation.target_id = farm.owner_id
        );

      UPDATE entities AS farm
      SET payload_json = json_set(farm.payload_json, '$.visitAddressId', (
        SELECT relation.target_id
        FROM entity_relations relation
        JOIN entities profile ON profile.id = relation.source_id AND profile.kind = 'farmerProfile'
        WHERE relation.relationship = 'address' AND profile.owner_id = farm.owner_id
          AND json_extract(profile.payload_json, '$.farmId') = farm.id
        ORDER BY relation.id LIMIT 1
      ))
      WHERE farm.kind = 'farm'
        AND (json_type(farm.payload_json, '$.visitAddressId') IS NULL OR json_type(farm.payload_json, '$.visitAddressId') = 'null')
        AND EXISTS (
          SELECT 1 FROM entity_relations relation
          JOIN entities profile ON profile.id = relation.source_id AND profile.kind = 'farmerProfile'
          JOIN entities address ON address.id = relation.target_id AND address.kind = 'address'
          WHERE relation.relationship = 'address' AND profile.owner_id = farm.owner_id
            AND json_extract(profile.payload_json, '$.farmId') = farm.id
            AND address.owner_id = farm.owner_id
        );

      INSERT INTO entity_relations (source_id, relationship, target_id)
      SELECT farm.id, 'visitAddress', json_extract(farm.payload_json, '$.visitAddressId')
      FROM entities farm
      JOIN entities address ON address.id = json_extract(farm.payload_json, '$.visitAddressId')
        AND address.kind = 'address' AND address.owner_id = farm.owner_id
      WHERE farm.kind = 'farm' AND json_type(farm.payload_json, '$.visitAddressId') = 'text'
        AND NOT EXISTS (
          SELECT 1 FROM entity_relations relation
          WHERE relation.source_id = farm.id AND relation.relationship = 'visitAddress'
            AND relation.target_id = json_extract(farm.payload_json, '$.visitAddressId')
        );

      UPDATE entities AS address
      SET context_id = (
        SELECT farm.id FROM entities farm
        JOIN entity_relations relation ON relation.source_id = farm.id
          AND relation.relationship = 'visitAddress' AND relation.target_id = address.id
        WHERE farm.kind = 'farm' AND farm.owner_id = address.owner_id
        ORDER BY relation.id LIMIT 1
      )
      WHERE address.kind = 'address'
        AND EXISTS (
          SELECT 1 FROM entities farm
          JOIN entity_relations relation ON relation.source_id = farm.id
            AND relation.relationship = 'visitAddress' AND relation.target_id = address.id
          WHERE farm.kind = 'farm' AND farm.owner_id = address.owner_id
        );

      UPDATE entities AS animal
      SET payload_json = json_set(animal.payload_json, '$.farmId', COALESCE(
        (SELECT relation.target_id FROM entity_relations relation
         JOIN entities farm ON farm.id = relation.target_id AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
         WHERE relation.source_id = animal.id AND relation.relationship = 'farm'
         ORDER BY relation.id LIMIT 1),
        (SELECT COALESCE(json_extract(profile.payload_json, '$.farmId'), profileFarm.target_id)
         FROM entities profile
         LEFT JOIN entity_relations profileFarm ON profileFarm.source_id = profile.id AND profileFarm.relationship = 'farm'
         JOIN entities farm ON farm.id = COALESCE(json_extract(profile.payload_json, '$.farmId'), profileFarm.target_id)
           AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
         WHERE profile.kind = 'farmerProfile' AND profile.owner_id = animal.owner_id
         ORDER BY profile.created_at, profile.id LIMIT 1)
      ))
      WHERE animal.kind = 'livestock'
        AND (json_type(animal.payload_json, '$.farmId') IS NULL OR json_type(animal.payload_json, '$.farmId') = 'null')
        AND COALESCE(
          (SELECT relation.target_id FROM entity_relations relation
           JOIN entities farm ON farm.id = relation.target_id AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
           WHERE relation.source_id = animal.id AND relation.relationship = 'farm'
           ORDER BY relation.id LIMIT 1),
          (SELECT COALESCE(json_extract(profile.payload_json, '$.farmId'), profileFarm.target_id)
           FROM entities profile
           LEFT JOIN entity_relations profileFarm ON profileFarm.source_id = profile.id AND profileFarm.relationship = 'farm'
           JOIN entities farm ON farm.id = COALESCE(json_extract(profile.payload_json, '$.farmId'), profileFarm.target_id)
             AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
           WHERE profile.kind = 'farmerProfile' AND profile.owner_id = animal.owner_id
           ORDER BY profile.created_at, profile.id LIMIT 1)
        ) IS NOT NULL;

      INSERT INTO entity_relations (source_id, relationship, target_id)
      SELECT animal.id, 'farm', json_extract(animal.payload_json, '$.farmId')
      FROM entities animal
      JOIN entities farm ON farm.id = json_extract(animal.payload_json, '$.farmId')
        AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
      WHERE animal.kind = 'livestock'
        AND json_type(animal.payload_json, '$.farmId') = 'text'
        AND NOT EXISTS (
          SELECT 1 FROM entity_relations relation
          WHERE relation.source_id = animal.id AND relation.relationship = 'farm'
            AND relation.target_id = json_extract(animal.payload_json, '$.farmId')
        );

      UPDATE entities AS animal
      SET context_id = json_extract(animal.payload_json, '$.farmId')
      WHERE animal.kind = 'livestock'
        AND EXISTS (
          SELECT 1 FROM entities farm
          WHERE farm.id = json_extract(animal.payload_json, '$.farmId')
            AND farm.kind = 'farm' AND farm.owner_id = animal.owner_id
        );

      UPDATE entities AS consultation
      SET payload_json = json_set(consultation.payload_json, '$.farmId', (
        SELECT json_extract(animal.payload_json, '$.farmId')
        FROM entity_relations relation
        JOIN entities animal ON animal.id = relation.target_id AND animal.kind = 'livestock'
        WHERE relation.source_id = consultation.id AND relation.relationship = 'animal'
        ORDER BY relation.id LIMIT 1
      ))
      WHERE consultation.kind = 'consultation'
        AND (json_type(consultation.payload_json, '$.farmId') IS NULL OR json_type(consultation.payload_json, '$.farmId') = 'null')
        AND EXISTS (
          SELECT 1 FROM entity_relations relation
          JOIN entities animal ON animal.id = relation.target_id AND animal.kind = 'livestock'
          WHERE relation.source_id = consultation.id AND relation.relationship = 'animal'
        );

      UPDATE entities AS consultation
      SET context_id = json_extract(consultation.payload_json, '$.farmId')
      WHERE consultation.kind = 'consultation'
        AND EXISTS (
          SELECT 1 FROM entities farm
          WHERE farm.id = json_extract(consultation.payload_json, '$.farmId')
            AND farm.kind = 'farm' AND farm.owner_id = consultation.owner_id
        );

      INSERT INTO entity_relations (source_id, relationship, target_id)
      SELECT consultation.id, 'farm', json_extract(consultation.payload_json, '$.farmId')
      FROM entities consultation
      JOIN entities farm ON farm.id = json_extract(consultation.payload_json, '$.farmId')
        AND farm.kind = 'farm' AND farm.owner_id = consultation.owner_id
      WHERE consultation.kind = 'consultation'
        AND json_type(consultation.payload_json, '$.farmId') = 'text'
        AND NOT EXISTS (
          SELECT 1 FROM entity_relations relation
          WHERE relation.source_id = consultation.id AND relation.relationship = 'farm'
            AND relation.target_id = json_extract(consultation.payload_json, '$.farmId')
        );

      UPDATE entities AS draft
      SET payload_json = json_set(draft.payload_json, '$.input.farmId', (
        SELECT json_extract(animal.payload_json, '$.farmId')
        FROM entities animal
        WHERE animal.kind = 'livestock'
          AND animal.id = json_extract(draft.payload_json, '$.input.animalId')
        LIMIT 1
      ))
      WHERE draft.kind = 'bookingDraft'
        AND (json_type(draft.payload_json, '$.input.farmId') IS NULL OR json_type(draft.payload_json, '$.input.farmId') = 'null')
        AND EXISTS (
          SELECT 1 FROM entities animal
          WHERE animal.kind = 'livestock'
            AND animal.id = json_extract(draft.payload_json, '$.input.animalId')
        );
    `,
  },
];

export async function migrateDatabase(database: SQLiteDatabase): Promise<number> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  const latestVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion > latestVersion) {
    throw new DomainError('INVALID_STATE', 'Database dibuat oleh versi VetLink yang lebih baru.');
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(migration.sql);
      await transaction.runAsync(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        migration.version,
        new Date().toISOString(),
      );
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return latestVersion;
}
