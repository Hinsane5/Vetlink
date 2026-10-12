import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '../src/database/postgres-pool.js';

const lockId = 2_610_130_001;

async function main(): Promise<void> {
  const pool = createPostgresPool();
  const connection = await pool.connect();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum_sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await connection.query('SELECT pg_advisory_lock($1::bigint)', [lockId]);

    const directory = resolve(process.cwd(), 'database/migrations');
    const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    for (const name of names) {
      const sql = await readFile(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await connection.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM schema_migrations WHERE name = $1',
        [name],
      );

      if (existing.rowCount) {
        if (existing.rows[0].checksum_sha256 !== checksum) {
          throw new Error(`Applied migration ${name} has changed; add a new migration instead`);
        }
        console.log(`Sudah diterapkan: ${name}`);
        continue;
      }

      await connection.query('BEGIN');
      try {
        await connection.query(sql);
        await connection.query(
          'INSERT INTO schema_migrations (name, checksum_sha256) VALUES ($1, $2)',
          [name, checksum],
        );
        await connection.query('COMMIT');
        console.log(`Diterapkan: ${name}`);
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
    }
    console.log(`Migrasi selesai (${names.length} file).`);
  } finally {
    try {
      await connection.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]);
    } finally {
      connection.release();
      await pool.end();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error';
  console.error(`Migrasi gagal: ${message}`);
  process.exitCode = 1;
});
