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

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development').trim();
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const sslValue = (env.DATABASE_SSL ?? 'false').trim().toLowerCase();
  if (sslValue !== 'true' && sslValue !== 'false') {
    throw new Error('DATABASE_SSL must be true or false');
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
  };
}
