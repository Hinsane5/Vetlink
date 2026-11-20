import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiPatientClinicalNote, ApiPatientRecord, PatientClinicalReadRepository, PatientReadRepository } from './ports/PatientReadRepository';
import type { ApiHealthEvent, LivestockHealthReadRepository } from './ports/LivestockHealthRepository';
import type { ApiMediaRepository } from './ports/ApiMediaRepository';
import type { PatientMediaReadRepository, ApiPatientMediaRecord } from './ports/PatientMediaReadRepository';
import type { ServerChatMediaStore } from './ports/ServerChatMediaStore';
import type { ApiMessageAttachment } from './ports/ApiChatRepository';

export interface ServerPatientDetail {
  patient: ApiPatientRecord;
  events: ApiHealthEvent[];
  clinicalNotes: ApiPatientClinicalNote[];
  media?: ApiPatientMediaRecord[];
}

/** BE-16 patient rows are already scoped by veterinarian assignment on the server. */
export class ServerPatientService {
  constructor(
    private readonly patients: PatientReadRepository,
    private readonly health: LivestockHealthReadRepository,
    private readonly clinicalNotes: PatientClinicalReadRepository,
    private readonly patientMedia?: PatientMediaReadRepository,
    private readonly media?: ApiMediaRepository,
    private readonly mediaStore?: ServerChatMediaStore,
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
    const [events, clinicalNotes, media] = await Promise.all([
      this.health.listHealthEvents(patient.id),
      this.clinicalNotes.listFinalNotes(patient.id),
      this.patientMedia ? this.patientMedia.listForPatient(patient.id) : Promise.resolve(undefined),
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
    if (media) {
      const mediaIds = new Set<string>();
      for (const item of media) {
        if (!item.id || !item.consultationId || !item.recordId || mediaIds.has(item.id))
          throw new DomainError('API_RESPONSE_INVALID', 'Lampiran pasien server memuat metadata tidak valid atau ID ganda.');
        mediaIds.add(item.id);
      }
    }
    clinicalNotes.sort((left, right) => Date.parse(right.finalizedAt ?? '') - Date.parse(left.finalizedAt ?? ''));
    return { patient, events, clinicalNotes, ...(media ? { media } : {}) };
  }

  async downloadPatientMedia(role: AccountRole, userId: string, item: ApiPatientMediaRecord): Promise<string> {
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter terkait yang dapat membuka lampiran pasien.');
    if (!this.patientMedia || !this.media || !this.mediaStore) throw new DomainError('INVALID_STATE', 'Lampiran pasien belum tersedia pada sesi ini.');
    if (!item || !item.id || !item.consultationId || !item.recordId) throw new DomainError('VALIDATION_FAILED', 'Lampiran pasien tidak valid.');
    const downloaded = await this.media.download(item.id);
    if (downloaded.attachment.id !== item.id || downloaded.attachment.uploadStatus !== 'committed'
      || downloaded.attachment.kind !== item.kind || downloaded.attachment.mimeType !== item.mimeType
      || downloaded.attachment.filename !== item.filename || downloaded.attachment.byteSize !== item.byteSize
      || downloaded.attachment.url !== item.url) {
      throw new DomainError('API_RESPONSE_INVALID', 'Metadata file tidak cocok dengan projection pasien.');
    }
    const localUri = await this.mediaStore.storeDownloadedFile(userId, {
      id: item.id, kind: item.kind, mimeType: item.mimeType, filename: item.filename, byteSize: item.byteSize, url: item.url,
    } satisfies ApiMessageAttachment, downloaded.bytes);
    return localUri;
  }
}

export function filterServerPatients(records: readonly ApiPatientRecord[], query: string): ApiPatientRecord[] {
  const term = query.trim().toLocaleLowerCase('id-ID');
  if (!term) return [...records];
  return records.filter((record) => [record.name, record.displayCode, record.species, record.ownerName]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(term)));
}
