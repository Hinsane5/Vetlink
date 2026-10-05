import type { SQLiteDatabase } from 'expo-sqlite';
import type { DomainEntity, EntityRelation } from '../../../domain/entities';

export async function insertEntity(
  database: SQLiteDatabase,
  entity: DomainEntity,
  idempotencyKey: string | null = null,
): Promise<void> {
  const storedIdempotencyKey =
    idempotencyKey ?? (typeof entity.payload.operationKey === 'string' ? entity.payload.operationKey : null);
  await database.runAsync(
    `INSERT INTO entities
      (id, kind, owner_id, context_id, payload_json, created_at, updated_at, version,
       idempotency_key, event_id, recipient_id, source_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entity.id,
    entity.kind,
    entity.ownerId,
    entity.contextId,
    JSON.stringify(entity.payload),
    entity.createdAt,
    entity.updatedAt,
    entity.version,
    storedIdempotencyKey,
    typeof entity.payload.eventId === 'string' ? entity.payload.eventId : null,
    typeof entity.payload.recipientId === 'string' ? entity.payload.recipientId : null,
    typeof entity.payload.sourceKey === 'string' ? entity.payload.sourceKey : null,
  );
}

export async function insertRelations(
  database: SQLiteDatabase,
  relations: readonly EntityRelation[],
): Promise<void> {
  for (const relation of relations) {
    await database.runAsync(
      'INSERT INTO entity_relations (source_id, relationship, target_id) VALUES (?, ?, ?)',
      relation.sourceId,
      relation.relationship,
      relation.targetId,
    );
  }
}

export async function replaceRelations(
  database: SQLiteDatabase,
  sourceId: string,
  relations: readonly EntityRelation[],
): Promise<void> {
  await database.runAsync('DELETE FROM entity_relations WHERE source_id = ?', sourceId);
  await insertRelations(database, relations);
}

export const entityColumns = `
  id, kind, owner_id, context_id, payload_json, created_at, updated_at, version
`;

export function columnsForAlias(alias: string): string {
  return 'id, kind, owner_id, context_id, payload_json, created_at, updated_at, version'
    .split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

export interface EntityRow {
  id: string;
  kind: string;
  owner_id: string | null;
  context_id: string | null;
  payload_json: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export function toDomainEntity(row: EntityRow): DomainEntity {
  return {
    id: row.id,
    kind: row.kind as DomainEntity['kind'],
    ownerId: row.owner_id,
    contextId: row.context_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}
