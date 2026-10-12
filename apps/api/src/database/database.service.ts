import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import { createPostgresPool } from './postgres-pool.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = createPostgresPool();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(sql, [...values]);
  }

  async transaction<Result>(operation: (client: PoolClient) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
