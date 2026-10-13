import type { SQLiteDatabase } from 'expo-sqlite';
import type { DomainRepository } from '../../../application/ports/DomainRepository';
import { DomainError } from '../../../domain/errors';
import { isEntityKind, type DomainEntity, type EntityKind, type EntityRelation } from '../../../domain/entities';
import { assertClinicalNoteFinalizable } from '../../../domain/policies';
import { columnsForAlias, entityColumns, insertEntity, insertRelations, toDomainEntity, type EntityRow } from './entitySql';

const immutableKinds = new Set<EntityKind>(['ledgerEntry', 'orderItem', 'paymentAttempt', 'review', 'consultationAction']);

export class SqliteDomainRepository implements DomainRepository {
  constructor(private readonly database: SQLiteDatabase, private readonly inTransaction = false) {}

  private async write(action: (transaction: SQLiteDatabase) => Promise<void>): Promise<void> {
    if (this.inTransaction) await action(this.database);
    else await this.database.withExclusiveTransactionAsync(action);
  }

  async create(entity: DomainEntity, relations: readonly EntityRelation[] = []): Promise<void> {
    assertValidFinalNote(entity);
    await this.write(async (transaction) => {
      await insertEntity(transaction, entity);
      await insertRelations(transaction, relations);
    });
  }

  async findById(kind: EntityKind, id: string): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND id = ?`,
      kind,
      id,
    );
    return row ? toDomainEntity(row) : null;
  }

  async listByOwner(kind: EntityKind, ownerId: string): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND owner_id = ? ORDER BY updated_at DESC, id`,
      kind,
      ownerId,
    );
    return rows.map(toDomainEntity);
  }

  async listRelated(kind: EntityKind, id: string, relationship: string): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${columnsForAlias('target')}
       FROM entity_relations relation
       JOIN entities source ON source.id = relation.source_id
       JOIN entities target ON target.id = relation.target_id
       WHERE source.kind = ? AND source.id = ? AND relation.relationship = ?
       ORDER BY target.created_at, target.id`,
      kind,
      id,
      relationship,
    );
    return rows.map(toDomainEntity);
  }

  async listByRelated(kind: EntityKind, relatedId: string, relationship: string): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${columnsForAlias('source')}
       FROM entity_relations relation
       JOIN entities source ON source.id = relation.source_id
       WHERE source.kind = ? AND relation.target_id = ? AND relation.relationship = ?
       ORDER BY source.updated_at DESC, source.id`,
      kind,
      relatedId,
      relationship,
    );
    return rows.map(toDomainEntity);
  }

  async update(
    entity: DomainEntity,
    expectedVersion: number,
    relations?: readonly EntityRelation[],
  ): Promise<void> {
    if (entity.version !== expectedVersion + 1) {
      throw new DomainError('VERSION_CONFLICT', 'Versi perubahan tidak berurutan.');
    }
    if (immutableKinds.has(entity.kind)) {
      throw new DomainError('IMMUTABLE_RECORD', 'Record transaksi atau histori bersifat append-only.');
    }

    await this.write(async (transaction) => {
      if (entity.kind === 'clinicalNote') {
        const existing = await transaction.getFirstAsync<{ payload_json: string }>(
          'SELECT payload_json FROM entities WHERE id = ? AND kind = ?',
          entity.id,
          entity.kind,
        );
        if (!existing) throw new DomainError('NOT_FOUND', 'Catatan klinis tidak ditemukan.');
        const currentPayload = JSON.parse(existing.payload_json) as Record<string, unknown>;
        if (currentPayload.status === 'final') {
          throw new DomainError('IMMUTABLE_RECORD', 'Catatan klinis final tidak dapat diubah.');
        }
      }
      if (entity.kind === 'recommendationItem') await assertRecommendationItemEditable(transaction, entity.id);
      assertValidFinalNote(entity);
      const result = await transaction.runAsync(
        `UPDATE entities
         SET owner_id = ?, context_id = ?, payload_json = ?, updated_at = ?, version = ?
         WHERE id = ? AND kind = ? AND version = ?`,
        entity.ownerId,
        entity.contextId,
        JSON.stringify(entity.payload),
        entity.updatedAt,
        entity.version,
        entity.id,
        entity.kind,
        expectedVersion,
      );
      if (result.changes !== 1) {
        const current = await transaction.getFirstAsync<{ version: number }>(
          'SELECT version FROM entities WHERE id = ? AND kind = ?',
          entity.id,
          entity.kind,
        );
        if (!current) throw new DomainError('NOT_FOUND', 'Data yang akan diubah tidak ditemukan.');
        throw new DomainError('VERSION_CONFLICT', 'Data sudah berubah; muat ulang sebelum menyimpan.');
      }
      if (relations) {
        await transaction.runAsync('DELETE FROM entity_relations WHERE source_id = ?', entity.id);
        await insertRelations(transaction, relations);
      }
    });
  }

  async delete(kind: EntityKind, id: string, expectedVersion: number): Promise<void> {
    if (kind !== 'recommendationItem' && kind !== 'cartItem') {
      throw new DomainError('INVALID_STATE', 'Penghapusan record ini belum tersedia.');
    }
    await this.write(async (transaction) => {
      const current = await transaction.getFirstAsync<{ version: number }>(
        'SELECT version FROM entities WHERE id = ? AND kind = ?', id, kind,
      );
      if (!current) throw new DomainError('NOT_FOUND', 'Item rekomendasi tidak ditemukan.');
      if (current.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Item rekomendasi sudah berubah. Muat ulang sebelum menghapus.');
      if (kind === 'recommendationItem') await assertRecommendationItemEditable(transaction, id);
      await transaction.runAsync('DELETE FROM entity_relations WHERE source_id = ? OR target_id = ?', id, id);
      const result = await transaction.runAsync(
        'DELETE FROM entities WHERE id = ? AND kind = ? AND version = ?', id, kind, expectedVersion,
      );
      if (result.changes !== 1) throw new DomainError('VERSION_CONFLICT', 'Item rekomendasi sudah berubah. Muat ulang sebelum menghapus.');
    });
  }

  async listByKind(kind: EntityKind): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? ORDER BY created_at, id`,
      kind,
    );
    return rows.map(toDomainEntity);
  }

  async countAll(): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM entities',
    );
    return row?.count ?? 0;
  }

  async relationCount(): Promise<number> {
    const row = await this.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM entity_relations',
    );
    return row?.count ?? 0;
  }
}

function assertValidFinalNote(entity: DomainEntity): void {
  if (entity.kind !== 'clinicalNote' || entity.payload.status !== 'final') return;
  const fields = ['complaint', 'findings', 'assessment', 'actions', 'careInstructions'] as const;
  for (const field of fields) {
    if (typeof entity.payload[field] !== 'string') {
      throw new DomainError('VALIDATION_FAILED', `Field catatan ${field} harus berupa teks.`);
    }
  }
  assertClinicalNoteFinalizable({
    complaint: entity.payload.complaint as string,
    findings: entity.payload.findings as string,
    assessment: entity.payload.assessment as string,
    actions: entity.payload.actions as string,
    careInstructions: entity.payload.careInstructions as string,
  });
}

export function isKnownStoredKind(kind: string): kind is EntityKind {
  return isEntityKind(kind);
}

async function assertRecommendationItemEditable(database: SQLiteDatabase, id: string): Promise<void> {
  const links = await database.getAllAsync<{ target_id: string }>(
    'SELECT target_id FROM entity_relations WHERE source_id = ? AND relationship = ?', id, 'recommendation',
  );
  if (links.length !== 1) throw new DomainError('INVALID_STATE', 'Relasi item rekomendasi tidak valid.');
  const parent = await database.getFirstAsync<{ payload_json: string }>(
    'SELECT payload_json FROM entities WHERE id = ? AND kind = ?', links[0].target_id, 'recommendation',
  );
  if (!parent) throw new DomainError('INVALID_STATE', 'Rekomendasi induk tidak ditemukan.');
  const payload = JSON.parse(parent.payload_json) as Record<string, unknown>;
  if (payload.status === 'sent') throw new DomainError('IMMUTABLE_RECORD', 'Rekomendasi yang sudah terkirim hanya dapat dibaca.');
}
