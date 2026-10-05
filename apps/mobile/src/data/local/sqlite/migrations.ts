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
