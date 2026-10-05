import type { SQLiteDatabase } from 'expo-sqlite';
import type { EventStore, EventTransaction } from '../../../application/ports/EventStore';
import type { DomainEvent } from '../../../domain/entities';
import { entityColumns, insertEntity, insertRelations, toDomainEntity, type EntityRow } from './entitySql';

interface EventRow {
  id: string;
  type: string;
  aggregate_id: string;
  occurred_at: string;
  payload_json: string;
}

function toDomainEvent(row: EventRow): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

export class SqliteEventStore implements EventStore {
  constructor(private readonly database: SQLiteDatabase) {}

  async transaction<T>(work: (transaction: EventTransaction) => Promise<T>): Promise<T> {
    let result: T;
    await this.database.withExclusiveTransactionAsync(async (database) => {
      const transaction: EventTransaction = {
        insertEventIfAbsent: async (event) => {
          const insertion = await database.runAsync(
            `INSERT OR IGNORE INTO domain_events (id, type, aggregate_id, occurred_at, payload_json)
             VALUES (?, ?, ?, ?, ?)`,
            event.id,
            event.type,
            event.aggregateId,
            event.occurredAt,
            JSON.stringify(event.payload),
          );
          return insertion.changes === 1;
        },
        findEvent: async (eventId) => {
          const row = await database.getFirstAsync<EventRow>(
            'SELECT id, type, aggregate_id, occurred_at, payload_json FROM domain_events WHERE id = ?',
            eventId,
          );
          return row ? toDomainEvent(row) : null;
        },
        insertEffect: async (effect, eventId) => {
          await insertEntity(database, effect.entity, effect.key);
          await insertRelations(database, effect.relations ?? []);
          await database.runAsync(
            'INSERT INTO event_effects (event_id, effect_key, entity_id) VALUES (?, ?, ?)',
            eventId,
            effect.key,
            effect.entity.id,
          );
        },
      };
      result = await work(transaction);
    });
    return result!;
  }

  async findByKind(kind: string): Promise<DomainEvent[]> {
    const rows = await this.database.getAllAsync<EventRow>(
      `SELECT id, type, aggregate_id, occurred_at, payload_json FROM domain_events WHERE type = ? ORDER BY occurred_at, id`,
      kind,
    );
    return rows.map(toDomainEvent);
  }

  async notificationCountForEvent(eventId: string, recipientId: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM entities
       WHERE kind = 'notification' AND event_id = ? AND recipient_id = ?`,
      eventId,
      recipientId,
    );
    return row?.count ?? 0;
  }

  async healthEventCountForSource(sourceKey: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM entities WHERE kind = 'healthEvent' AND source_key = ?`,
      sourceKey,
    );
    return row?.count ?? 0;
  }
}

export async function findEntityById(database: SQLiteDatabase, id: string) {
  const row = await database.getFirstAsync<EntityRow>(
    `SELECT ${entityColumns} FROM entities WHERE id = ?`,
    id,
  );
  return row ? toDomainEntity(row) : null;
}
