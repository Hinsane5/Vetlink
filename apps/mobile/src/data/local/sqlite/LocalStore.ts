import * as SQLite from 'expo-sqlite';
import { LocalAuthService } from '../../../application/LocalAuthService';
import { SqliteAuthRepository } from './SqliteAuthRepository';
import { ExpoIdFactory, ExpoPasswordVerifier, ExpoSecureAuthStore } from '../secure/ExpoSecureAuthStore';
import { SqliteDomainRepository } from './SqliteDomainRepository';
import { SqliteEventStore } from './SqliteEventStore';
import { SqliteProfileRepository } from './SqliteProfileRepository';
import { ProfileService } from '../../../application/ProfileService';
import { DashboardService } from '../../../application/DashboardService';
import { LivestockService } from '../../../application/LivestockService';
import { ExpoAttachmentMedia } from '../ExpoAttachmentMedia';
import { migrateDatabase } from './migrations';
import { readFixtureSeedVersion, seedFixturesIfEmpty, type SeedResult } from './seed';

export interface LocalStore {
  database: SQLite.SQLiteDatabase;
  repositories: SqliteDomainRepository;
  events: SqliteEventStore;
  auth: LocalAuthService;
  profiles: ProfileService;
  dashboard: DashboardService;
  livestock: LivestockService;
  authStore: ExpoSecureAuthStore;
  schemaVersion: number;
  fixtureSeedVersion: string | null;
  seedResult: SeedResult;
}

let bootstrap: Promise<LocalStore> | null = null;

export function openLocalStore(): Promise<LocalStore> {
  bootstrap ??= createLocalStore();
  return bootstrap;
}

export function retryLocalStoreBootstrap(): Promise<LocalStore> {
  bootstrap = null;
  return openLocalStore();
}

async function createLocalStore(): Promise<LocalStore> {
  const database = await SQLite.openDatabaseAsync('vetlink.db');
  await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const schemaVersion = await migrateDatabase(database);
  const seedResult = await seedFixturesIfEmpty(database);
  const fixtureSeedVersion = await readFixtureSeedVersion(database);
  const repositories = new SqliteDomainRepository(database);
  const profileRepository = new SqliteProfileRepository(database);
  const attachmentMedia = new ExpoAttachmentMedia();
  const events = new SqliteEventStore(database);
  const authStore = new ExpoSecureAuthStore();
  const auth = new LocalAuthService(
    new SqliteAuthRepository(database),
    authStore,
    authStore,
    new ExpoPasswordVerifier(),
    new ExpoIdFactory(),
  );
  const profiles = new ProfileService(
    profileRepository,
    attachmentMedia,
    new ExpoIdFactory(),
  );
  const dashboard = new DashboardService(repositories, profiles, new ExpoIdFactory());
  const livestock = new LivestockService(repositories, profileRepository, attachmentMedia, new ExpoIdFactory());
  const counts = await repositories.countAll();

  if (__DEV__) {
    console.info(
      `[VetLink][local-store] schema=${schemaVersion} seed=${fixtureSeedVersion ?? 'none'} ` +
        `entities=${counts} seedStatus=${seedResult.status}`,
    );
  }

  return { database, repositories, events, auth, profiles, dashboard, livestock, authStore, schemaVersion, fixtureSeedVersion, seedResult };
}
