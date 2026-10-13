import type { SQLiteDatabase } from 'expo-sqlite';
import type { CommerceRepository } from '../../../application/ports/CommerceRepository';
import type { DomainRepository } from '../../../application/ports/DomainRepository';
import { SqliteDomainRepository } from './SqliteDomainRepository';

const queues = new WeakMap<SQLiteDatabase, Promise<void>>();

/** Serializes commerce commands and commits every multi-record command atomically. */
export class SqliteCommerceRepository implements CommerceRepository {
  readonly read: DomainRepository;

  constructor(private readonly database: SQLiteDatabase) {
    this.read = new SqliteDomainRepository(database);
  }

  async transaction<T>(action: (repository: DomainRepository) => Promise<T>): Promise<T> {
    const task = (queues.get(this.database) ?? Promise.resolve()).then(async () => {
      let result!: T;
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        result = await action(new SqliteDomainRepository(transaction, true));
      });
      return result;
    });
    queues.set(this.database, task.then(() => {}, () => {}));
    return task;
  }
}
