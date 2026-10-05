import { DomainError } from './errors';

export const healthRecordKinds = ['examination', 'disease', 'vaccine', 'medication', 'care'] as const;
export type HealthRecordKind = (typeof healthRecordKinds)[number];
export type FarmerReportKind = Exclude<HealthRecordKind, 'examination'>;
export type HealthRecordSource = 'clinical_note' | 'farmer_report' | 'reminder';

export interface FarmerHealthReportInput {
  kind: FarmerReportKind;
  occurredAt: string;
  description: string;
  operationKey: string;
}

export interface HealthRecordAttachment {
  id: string;
  filename: string;
  mimeType: string;
  uri: string | null;
  available: boolean;
}

export interface ClinicalNoteSummary {
  consultationId: string;
  complaint: string;
  findings: string;
  assessment: string;
  actions: string;
  careInstructions: string;
  finalizedAt: string;
}

export interface HealthRecordSnapshot {
  id: string;
  animalId: string;
  kind: HealthRecordKind;
  occurredAt: string;
  description: string;
  actorId: string;
  actorName: string;
  source: HealthRecordSource;
  clinicalNote: ClinicalNoteSummary | null;
  attachments: HealthRecordAttachment[];
}

export interface HealthHistoryFilters {
  kind?: HealthRecordKind;
}

export interface PatientFilters {
  query?: string;
  species?: string;
}

export interface PatientSnapshot {
  id: string;
  name: string;
  displayCode: string;
  species: string;
  breed: string;
  sex: string;
  estimatedAgeMonths: number | null;
  weightKg: number | null;
  ownerId: string;
  ownerName: string;
  lastServiceAt: string | null;
  serviceCount: number;
  latestServiceType?: 'chat' | 'visit' | null;
  latestServiceStatus?: string | null;
  photo: HealthRecordAttachment | null;
}

export interface PatientConsultationSnapshot {
  id: string;
  displayCode: string;
  type: 'chat' | 'visit';
  status: string;
  startsAt: string | null;
  complaint: string;
}

export interface PatientDetailSnapshot {
  patient: PatientSnapshot;
  consultations: PatientConsultationSnapshot[];
  history: HealthRecordSnapshot[];
}

export function validateFarmerHealthReport(input: FarmerHealthReportInput): FarmerHealthReportInput {
  if (!input || !isFarmerReportKind(input.kind)) {
    throw new DomainError('VALIDATION_FAILED', 'Jenis laporan kesehatan tidak valid.');
  }
  const timestamp = new Date(input.occurredAt);
  if (!input.occurredAt.trim() || Number.isNaN(timestamp.getTime())) {
    throw new DomainError('VALIDATION_FAILED', 'Tanggal catatan kesehatan tidak valid.');
  }
  const description = input.description.trim().replace(/\s+/g, ' ');
  if (description.length < 3 || description.length > 500) {
    throw new DomainError('VALIDATION_FAILED', 'Catatan harus berisi 3 sampai 500 karakter.');
  }
  const operationKey = input.operationKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(operationKey)) {
    throw new DomainError('VALIDATION_FAILED', 'Kunci operasi catatan tidak valid.');
  }
  return { kind: input.kind, occurredAt: timestamp.toISOString(), description, operationKey };
}

export function selectHealthHistory(
  records: readonly HealthRecordSnapshot[],
  filters: HealthHistoryFilters = {},
): HealthRecordSnapshot[] {
  return records
    .filter((item) => !filters.kind || item.kind === filters.kind)
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
}

export function selectPatients(
  patients: readonly PatientSnapshot[],
  filters: PatientFilters = {},
): PatientSnapshot[] {
  const query = (filters.query ?? '').trim().toLocaleLowerCase('id-ID');
  const species = filters.species?.trim().toLocaleLowerCase('id-ID');
  return patients
    .filter((patient) => {
      if (species && patient.species.toLocaleLowerCase('id-ID') !== species) return false;
      if (!query) return true;
      return [patient.name, patient.displayCode, patient.species, patient.breed, patient.ownerName]
        .some((value) => value.toLocaleLowerCase('id-ID').includes(query));
    })
    .slice()
    .sort((a, b) => (b.lastServiceAt ?? '').localeCompare(a.lastServiceAt ?? '')
      || a.name.localeCompare(b.name, 'id-ID')
      || a.id.localeCompare(b.id));
}

function isFarmerReportKind(value: unknown): value is FarmerReportKind {
  return value === 'disease' || value === 'vaccine' || value === 'medication' || value === 'care';
}
