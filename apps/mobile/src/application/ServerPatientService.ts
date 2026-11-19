import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiPatientRecord, PatientReadRepository } from './ports/PatientReadRepository';

/** BE-16 patient rows are already scoped by veterinarian assignment on the server. */
export class ServerPatientService {
  constructor(private readonly patients: PatientReadRepository) {}

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
}

export function filterServerPatients(records: readonly ApiPatientRecord[], query: string): ApiPatientRecord[] {
  const term = query.trim().toLocaleLowerCase('id-ID');
  if (!term) return [...records];
  return records.filter((record) => [record.name, record.displayCode, record.species, record.ownerName]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(term)));
}
