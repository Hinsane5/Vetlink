import type { SQLiteDatabase } from 'expo-sqlite';
import type { AuthRepository } from '../../../application/ports/AuthRepository';
import type { AccountRole } from '../../../domain/auth';
import { DomainError } from '../../../domain/errors';
import type { DomainEntity, EntityRelation } from '../../../domain/entities';
import { entityColumns, insertEntity, insertRelations, toDomainEntity, type EntityRow } from './entitySql';

const profileKind: Record<AccountRole, DomainEntity['kind']> = {
  farmer: 'farmerProfile',
  vet: 'vetProfile',
};

export class SqliteAuthRepository implements AuthRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async findUserByEmail(normalizedEmail: string): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities
       WHERE kind = 'user' AND lower(trim(json_extract(payload_json, '$.email'))) = ?
       LIMIT 1`,
      normalizedEmail,
    );
    return row ? toDomainEntity(row) : null;
  }

  async findUserById(userId: string): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = 'user' AND id = ?`,
      userId,
    );
    return row ? toDomainEntity(row) : null;
  }

  async findRoleProfile(userId: string, role: AccountRole): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = ? AND owner_id = ? LIMIT 1`,
      profileKind[role],
      userId,
    );
    return row ? toDomainEntity(row) : null;
  }

  async createAccount(user: DomainEntity, profile: DomainEntity, relations: readonly EntityRelation[]): Promise<void> {
    if (user.kind !== 'user' || (profile.kind !== 'farmerProfile' && profile.kind !== 'vetProfile')) {
      throw new DomainError('VALIDATION_FAILED', 'Jenis akun tidak sesuai.');
    }
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const email = String(user.payload.email ?? '').trim().toLowerCase();
        const existing = await transaction.getFirstAsync<{ id: string }>(
          `SELECT id FROM entities
           WHERE kind = 'user' AND lower(trim(json_extract(payload_json, '$.email'))) = ?
           LIMIT 1`,
          email,
        );
        if (existing) throw new DomainError('EMAIL_IN_USE', 'Email ini sudah terdaftar.');
        await insertEntity(transaction, user);
        await insertEntity(transaction, profile);
        await insertRelations(transaction, relations);
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (isUniqueConstraint(error)) throw new DomainError('EMAIL_IN_USE', 'Email ini sudah terdaftar.');
      throw error;
    }
  }

  async createSession(session: DomainEntity, relation: EntityRelation): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await insertEntity(transaction, session);
      await insertRelations(transaction, [relation]);
    });
  }

  async findSession(sessionId: string): Promise<DomainEntity | null> {
    const row = await this.database.getFirstAsync<EntityRow>(
      `SELECT ${entityColumns} FROM entities WHERE kind = 'session' AND id = ?`,
      sessionId,
    );
    return row ? toDomainEntity(row) : null;
  }

  async updateSession(session: DomainEntity, expectedVersion: number): Promise<void> {
    if (session.kind !== 'session' || session.version !== expectedVersion + 1) {
      throw new DomainError('VERSION_CONFLICT', 'Versi sesi tidak berurutan.');
    }
    const result = await this.database.runAsync(
      `UPDATE entities SET payload_json = ?, updated_at = ?, version = ?
       WHERE id = ? AND kind = 'session' AND version = ?`,
      JSON.stringify(session.payload),
      session.updatedAt,
      session.version,
      session.id,
      expectedVersion,
    );
    if (result.changes !== 1) {
      throw new DomainError('VERSION_CONFLICT', 'Sesi sudah berubah; silakan masuk kembali.');
    }
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message);
}
