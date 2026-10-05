import type { SQLiteDatabase } from 'expo-sqlite';
import type { BookingRepository, BookingUnit } from '../../../application/ports/BookingRepository';
import { SqliteDomainRepository } from './SqliteDomainRepository';
import { SqliteProfileRepository } from './SqliteProfileRepository';

// Expo creates a connection per exclusive transaction. Serialize booking commands
// on the shared database so simultaneous retries can read the committed result.
const queues = new WeakMap<SQLiteDatabase, Promise<void>>();
export class SqliteBookingRepository implements BookingRepository {
  readonly read: BookingUnit;
  constructor(private readonly database: SQLiteDatabase) {
    this.read = { repository: new SqliteDomainRepository(database), profiles: new SqliteProfileRepository(database) };
  }
  async transaction<T>(action: (unit: BookingUnit) => Promise<T>): Promise<T> {
    const task = (queues.get(this.database) ?? Promise.resolve()).then(async () => {
      let result!: T;
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        result = await action({ repository: new SqliteDomainRepository(transaction, true), profiles: new SqliteProfileRepository(transaction) });
      });
      return result;
    });
    queues.set(this.database, task.then(() => {}, () => {}));
    return task;
  }
}
