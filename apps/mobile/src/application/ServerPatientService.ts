import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiPatientClinicalNote, ApiPatientRecord, PatientClinicalReadRepository, PatientReadRepository } from './ports/PatientReadRepository';
import type { ApiHealthEvent, LivestockHealthReadRepository } from './ports/LivestockHealthRepository';

export interface ServerPatientDetail {
  patient: ApiPatientRecord;
  events: ApiHealthEvent[];
  clinicalNotes: ApiPatientClinicalNote[];
}

/** BE-16 patient rows are already scoped by veterinarian assignment on the server. */
export class ServerPatientService {
  constructor(
    private readonly patients: PatientReadRepository,
    private readonly health: LivestockHealthReadRepository,
    private readonly clinicalNotes: PatientClinicalReadRepository,
  ) {}

  async listAssigned(role: AccountRole): Promise<ApiPatientRecord[]> {
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter Hewan dapat membaca daftar pasien terkait layanan.');
    const records = await this.patients.listPatients();
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) throw new DomainError('API_RESPONSE_INVALID', 'Daftar pasien server memuat ID ganda.');
      seen.add(record.id);
    }
    return records;
  }

  async getAssignedDetail(role: AccountRole, animalId: string): Promise<ServerPatientDetail> {
    const patient = (await this.listAssigned(role)).find((record) => record.id === animalId);
    if (!patient) throw new DomainError('NOT_FOUND', 'Pasien tidak ditemukan pada layanan Dokter ini.');
    const [events, clinicalNotes] = await Promise.all([
      this.health.listHealthEvents(patient.id),
      this.clinicalNotes.listFinalNotes(patient.id),
    ]);
    const eventIds = new Set<string>();
    for (const event of events) {
      if (eventIds.has(event.id)) throw new DomainError('API_RESPONSE_INVALID', 'Timeline pasien server memuat ID catatan ganda.');
      eventIds.add(event.id);
    }
    const noteIds = new Set<string>();
    for (const note of clinicalNotes) {
      if (!note.id || !note.finalizedAt || !Number.isFinite(Date.parse(note.finalizedAt))
        || !note.consultationId || noteIds.has(note.id)) {
        throw new DomainError('API_RESPONSE_INVALID', 'Catatan klinis pasien server tidak cocok dengan konsultasi final yang ditugaskan.');
      }
      noteIds.add(note.id);
    }
    clinicalNotes.sort((left, right) => Date.parse(right.finalizedAt ?? '') - Date.parse(left.finalizedAt ?? ''));
    return { patient, events, clinicalNotes };
  }
}

export function filterServerPatients(records: readonly ApiPatientRecord[], query: string): ApiPatientRecord[] {
  const term = query.trim().toLocaleLowerCase('id-ID');
  if (!term) return [...records];
  return records.filter((record) => [record.name, record.displayCode, record.species, record.ownerName]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(term)));
}
