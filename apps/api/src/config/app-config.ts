import { resolve } from 'node:path';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  media: MediaConfig;
  chatDeliveryFailFirstAttemptForTest: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface MediaConfig {
  storageDirectory: string;
  imageMaxBytes: number;
  videoMaxBytes: number;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key]?.trim();
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function byteLimit(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key]?.trim();
  if (!value) return fallback;

  const parsed = Number(value);
  const maximum = 100 * 1024 * 1024;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  return {
    storageDirectory: resolve(env.MEDIA_STORAGE_DIR?.trim() || '.local/private-media'),
    imageMaxBytes: byteLimit(env, 'MEDIA_IMAGE_MAX_BYTES', 10 * 1024 * 1024),
    videoMaxBytes: byteLimit(env, 'MEDIA_VIDEO_MAX_BYTES', 50 * 1024 * 1024),
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development').trim();
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const sslValue = (env.DATABASE_SSL ?? 'false').trim().toLowerCase();
  if (sslValue !== 'true' && sslValue !== 'false') {
    throw new Error('DATABASE_SSL must be true or false');
  }

  const failFirstAttempt = (env.CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT ?? 'false').trim().toLowerCase();
  if (failFirstAttempt !== 'true' && failFirstAttempt !== 'false') {
    throw new Error('CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT must be true or false');
  }
  if (failFirstAttempt === 'true' && nodeEnv !== 'test') {
    throw new Error('CHAT_DELIVERY_TEST_FAIL_FIRST_ATTEMPT is available only when NODE_ENV=test');
  }

  return {
    nodeEnv,
    port: integer(env, 'PORT', 3000),
    database: {
      host: required(env, 'DATABASE_HOST'),
      port: integer(env, 'DATABASE_PORT', 5432),
      database: required(env, 'DATABASE_NAME'),
      user: required(env, 'DATABASE_USER'),
      password: required(env, 'DATABASE_PASSWORD'),
      ssl: sslValue === 'true',
    },
    media: loadMediaConfig(env),
    chatDeliveryFailFirstAttemptForTest: failFirstAttempt === 'true',
  };
}
