import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { DirectoryServiceType } from '../domain/directory';
import type { ApiVetDirectoryDetail, ApiVetDirectoryRecord, ApiVetSlot, VetDirectoryReadRepository } from './ports/VetDirectoryReadRepository';

/** Verified-vet discovery and slots. Server endpoints remain authoritative for eligibility. */
export class ServerVetDirectoryService {
  constructor(private readonly directory: VetDirectoryReadRepository) {}

  async listVerified(role: AccountRole): Promise<ApiVetDirectoryRecord[]> {
    this.requireFarmer(role);
    const results: ApiVetDirectoryRecord[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.directory.search({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const vet of page.items) {
        if (seenIds.has(vet.id)) throw new DomainError('API_RESPONSE_INVALID', 'Direktori Dokter server memuat ID ganda.');
        seenIds.add(vet.id);
        results.push(vet);
      }
      if (!page.hasMore) return results;
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        throw new DomainError('API_RESPONSE_INVALID', 'Cursor direktori Dokter server tidak valid.');
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new DomainError('API_RESPONSE_INVALID', 'Direktori Dokter server terlalu panjang untuk dimuat sekaligus.');
  }

  async getDetail(role: AccountRole, vetId: string): Promise<ApiVetDirectoryDetail> {
    this.requireFarmer(role);
    return this.directory.getById(vetId);
  }

  async getSlots(role: AccountRole, vetId: string, service: DirectoryServiceType, dateFrom: string, dateTo: string): Promise<ApiVetSlot[]> {
    this.requireFarmer(role);
    if (service !== 'chat' && service !== 'visit') throw new DomainError('VALIDATION_FAILED', 'Jenis layanan Dokter tidak tersedia.');
    return this.directory.getSlots(vetId, { service, dateFrom, dateTo });
  }

  private requireFarmer(role: AccountRole): void {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Direktori layanan hanya tersedia untuk Peternak.');
  }
}

export function filterServerVets(records: readonly ApiVetDirectoryRecord[], query: string): ApiVetDirectoryRecord[] {
  const term = query.trim().toLocaleLowerCase('id-ID');
  if (!term) return [...records];
  return records.filter((vet) => [vet.professionalName, vet.practiceLocation, ...vet.serviceAreas, ...vet.specialties, ...vet.species]
    .some((value) => value.toLocaleLowerCase('id-ID').includes(term)));
}
