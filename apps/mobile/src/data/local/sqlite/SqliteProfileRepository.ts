import type { SQLiteDatabase } from 'expo-sqlite';
import type { AccountRole } from '../../../domain/auth';
import { DomainError } from '../../../domain/errors';
import type { DomainEntity, EntityRelation } from '../../../domain/entities';
import type { ProfileAggregate, ProfileCreate, ProfileRepository, ProfileUpdate } from '../../../application/ports/ProfileRepository';
import { columnsForAlias, entityColumns, insertEntity, insertRelations, replaceRelations, toDomainEntity, type EntityRow } from './entitySql';

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async loadProfile(userId: string, role: AccountRole): Promise<ProfileAggregate> {
    const userRow = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = 'user' AND id = ?`,
      userId,
    );
    if (!userRow) throw new DomainError('NOT_FOUND', 'Akun profil tidak ditemukan.');
    const profileKind = role === 'farmer' ? 'farmerProfile' : 'vetProfile';
    const profileRow = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND owner_id = ? ORDER BY created_at, id LIMIT 1`,
      profileKind,
      userId,
    );
    if (!profileRow) throw new DomainError('FORBIDDEN', 'Akun ini tidak memiliki profil untuk peran tersebut.');
    const user = toDomainEntity(userRow);
    const profile = toDomainEntity(profileRow);
    const profileRelations = await this.relationsFrom(profile.id);
    const farmId = typeof profile.payload.farmId === 'string'
      ? profile.payload.farmId
      : profileRelations.find((relation) => relation.relationship === 'farm')?.targetId;
    const addressId = profileRelations.find((relation) => relation.relationship === 'address')?.targetId;
    const farm = farmId ? await this.findEntity('farm', farmId) : null;
    const farmRelations = farm ? await this.relationsFrom(farm.id) : [];
    const resolvedAddressId = addressId ?? (typeof farm?.payload.visitAddressId === 'string' ? farm.payload.visitAddressId : null);
    const address = resolvedAddressId ? await this.findEntity('address', resolvedAddressId) : null;
    const submissions = role === 'vet' ? await this.related(profile.id, 'verificationSubmission') : [];
    const attachments = await this.listByOwner('attachment', userId);
    const drafts = await this.listByOwner('profileDraft', userId);
    return { user, profile, farm, address, submissions, attachments, drafts, profileRelations, farmRelations };
  }

  async commit(changes: { creates?: readonly ProfileCreate[]; updates?: readonly ProfileUpdate[] }): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const { entity } of changes.creates ?? []) await insertEntity(transaction, entity);
      for (const change of changes.updates ?? []) await this.updateEntity(transaction, change);
      const links = (changes.creates ?? []).flatMap((item) => item.relations ?? []);
      for (const change of changes.updates ?? []) {
        if (change.relations) {
          await replaceRelations(transaction, change.entity.id, change.relations);
        }
      }
      await insertRelations(transaction, links);
    });
  }

  private async updateEntity(transaction: SQLiteDatabase, change: ProfileUpdate): Promise<void> {
    if (change.entity.version !== change.expectedVersion + 1) {
      throw new DomainError('VERSION_CONFLICT', 'Versi perubahan profil tidak berurutan.');
    }
    const result = await transaction.runAsync(
      `UPDATE entities
       SET owner_id = ?, context_id = ?, payload_json = ?, updated_at = ?, version = ?
       WHERE id = ? AND kind = ? AND version = ?`,
      change.entity.ownerId,
      change.entity.contextId,
      JSON.stringify(change.entity.payload),
      change.entity.updatedAt,
      change.entity.version,
      change.entity.id,
      change.entity.kind,
      change.expectedVersion,
    );
    if (result.changes !== 1) {
      const exists = await transaction.getFirstAsync<{ version: number }>(
        'SELECT version FROM entities WHERE id = ? AND kind = ?',
        change.entity.id,
        change.entity.kind,
      );
      if (!exists) throw new DomainError('NOT_FOUND', 'Data profil tidak ditemukan.');
      throw new DomainError('VERSION_CONFLICT', 'Profil sudah berubah. Muat ulang sebelum menyimpan.');
    }
  }

  private async findEntity(kind: DomainEntity['kind'], id: string): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND id = ?`,
      kind,
      id,
    );
    return row ? toDomainEntity(row) : null;
  }

  private async listByOwner(kind: DomainEntity['kind'], ownerId: string): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND owner_id = ? ORDER BY created_at, id`,
      kind,
      ownerId,
    );
    return rows.map(toDomainEntity);
  }

  private async related(sourceId: string, relationship: string): Promise<DomainEntity[]> {
    const rows = await this.database.getAllAsync<EntityRow>(
      `SELECT ${columnsForAlias('target')}
       FROM entity_relations relation
       JOIN entities source ON source.id = relation.source_id
       JOIN entities target ON target.id = relation.target_id
       WHERE source.id = ? AND relation.relationship = ?
       ORDER BY target.created_at DESC, target.id DESC`,
      sourceId,
      relationship,
    );
    return rows.map(toDomainEntity);
  }

  private async relationsFrom(sourceId: string): Promise<EntityRelation[]> {
    const rows = await this.database.getAllAsync<{ source_id: string; relationship: string; target_id: string }>(
      'SELECT source_id, relationship, target_id FROM entity_relations WHERE source_id = ? ORDER BY id',
      sourceId,
    );
    return rows.map((row) => ({ sourceId: row.source_id, relationship: row.relationship, targetId: row.target_id }));
  }
}
