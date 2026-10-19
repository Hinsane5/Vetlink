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
import { HealthRecordService } from '../../../application/HealthRecordService';
import { PatientService } from '../../../application/PatientService';
import { FrontendPreviewService } from '../../../application/FrontendPreviewService';
import { AvailabilityService } from '../../../application/AvailabilityService';
import { CareCoordinationService } from '../../../application/CareCoordinationService';
import { ChatService } from '../../../application/ChatService';
import { ConsultationService } from '../../../application/ConsultationService';
import { ClinicalNoteService } from '../../../application/ClinicalNoteService';
import { RecommendationService } from '../../../application/RecommendationService';
import { BookingService } from '../../../application/BookingService';
import { SqliteBookingRepository } from './SqliteBookingRepository';
import { VetDirectoryService } from '../../../application/VetDirectoryService';
import { CatalogService } from '../../../application/CatalogService';
import { CommerceService } from '../../../application/CommerceService';
import { PaymentService, type PaymentAdapter } from '../../../application/PaymentService';
import { ExpoAttachmentMedia } from '../ExpoAttachmentMedia';
import { LocalShippingQuoteAdapter } from '../commerce/LocalShippingQuoteAdapter';
import { SqliteCommerceRepository } from './SqliteCommerceRepository';
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
  healthRecords: HealthRecordService;
  patients: PatientService;
  preview: FrontendPreviewService;
  vetDirectory: VetDirectoryService;
  catalog: CatalogService;
  commerce: CommerceService;
  payments: PaymentService;
  booking: BookingService;
  consultations: ConsultationService;
  clinicalNotes: ClinicalNoteService;
  recommendations: RecommendationService;
  chat: ChatService;
  availability: AvailabilityService;
  careCoordination: CareCoordinationService;
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
  const healthRecords = new HealthRecordService(repositories, livestock, profiles, events);
  const patients = new PatientService(repositories, profiles, healthRecords);
  const preview = new FrontendPreviewService(repositories, profiles);
  const vetDirectory = new VetDirectoryService(repositories, profiles);
  const catalog = new CatalogService(repositories, profileRepository);
  const commerce = new CommerceService(
    new SqliteCommerceRepository(database),
    profileRepository,
    new LocalShippingQuoteAdapter(),
    new ExpoIdFactory(),
  );
  const payments = new PaymentService(new SqliteCommerceRepository(database), { submit: async () => ({ outcome: 'pending', message: 'Instruksi pembayaran lokal tersimpan dan menunggu konfirmasi.' }) } satisfies PaymentAdapter, new ExpoIdFactory());
  const bookingRepository = new SqliteBookingRepository(database);
  const booking = new BookingService(bookingRepository, attachmentMedia, new ExpoIdFactory());
  const consultations = new ConsultationService(bookingRepository, attachmentMedia, new ExpoIdFactory());
  const clinicalNotes = new ClinicalNoteService(bookingRepository, new ExpoIdFactory());
  const recommendations = new RecommendationService(bookingRepository, new ExpoIdFactory());
  const chat = new ChatService(bookingRepository, attachmentMedia, new ExpoIdFactory());
  const availability = new AvailabilityService(bookingRepository, attachmentMedia, new ExpoIdFactory());
  const careCoordination = new CareCoordinationService(bookingRepository);
  const counts = await repositories.countAll();

  if (__DEV__) {
    console.info(
      `[VetLink][local-store] schema=${schemaVersion} seed=${fixtureSeedVersion ?? 'none'} ` +
        `entities=${counts} seedStatus=${seedResult.status}`,
    );
  }

  return { database, repositories, events, auth, profiles, dashboard, livestock, healthRecords, patients, preview, vetDirectory, catalog, commerce, payments, booking, consultations, clinicalNotes, recommendations, chat, availability, careCoordination, authStore, schemaVersion, fixtureSeedVersion, seedResult };
}
