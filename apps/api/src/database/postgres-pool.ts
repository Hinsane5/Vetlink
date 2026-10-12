import { Pool } from 'pg';
import type { AppConfig } from '../config/app-config.js';
import { loadAppConfig } from '../config/app-config.js';

export function createPostgresPool(config: AppConfig = loadAppConfig()): Pool {
  return new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 2_500,
    idleTimeoutMillis: 30_000,
    application_name: 'vetlink-api',
  });
}
