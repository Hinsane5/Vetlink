import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import { speciesLabel } from '../domain/catalog';
import { livestockSexes } from '../domain/livestock';
import { livestockSpecies, type LivestockSpecies } from '../domain/profiles';
import type { FarmReadRepository } from './ports/FarmReadRepository';
import type { ApiLivestockRecord, LivestockReadRepository } from './ports/LivestockReadRepository';
import type { LivestockCreateInput, LivestockPatchInput, LivestockWriteRepository } from './ports/LivestockWriteRepository';

/** Farmer livestock commands stay bound to an owned Farm in the server session. */
export class ServerLivestockService {
  constructor(
    private readonly farms: FarmReadRepository,
    private readonly reads: LivestockReadRepository,
    private readonly writes: LivestockWriteRepository,
  ) {}

  async listForFarm(role: AccountRole, userId: string, farmId: string): Promise<ApiLivestockRecord[]> {
    this.requireFarmer(role);
    await this.farms.getFarmById(farmId);
    const results: ApiLivestockRecord[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.reads.listPage({ limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) {
        if (item.farmerId !== userId || seenIds.has(item.id)) {
          throw new DomainError('API_RESPONSE_INVALID', 'Daftar ternak server tidak sesuai pemilik atau memuat ID ganda.');
        }
        seenIds.add(item.id);
        if (item.farmId === farmId) results.push(item);
      }
      if (!page.hasMore) return results;
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        throw new DomainError('API_RESPONSE_INVALID', 'Cursor daftar ternak server tidak valid.');
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new DomainError('API_RESPONSE_INVALID', 'Daftar ternak terlalu panjang untuk dimuat sekaligus.');
  }

  async getForFarm(role: AccountRole, userId: string, farmId: string, livestockId: string): Promise<ApiLivestockRecord> {
    this.requireFarmer(role);
    await this.farms.getFarmById(farmId);
    const animal = await this.reads.getById(livestockId);
    if (animal.farmerId !== userId || animal.farmId !== farmId || animal.id !== livestockId) {
      throw new DomainError('FORBIDDEN', 'Ternak tidak berada dalam peternakan milik akun ini.');
    }
    return animal;
  }

  async create(role: AccountRole, farmId: string, input: Omit<LivestockCreateInput, 'farmId'>): Promise<ApiLivestockRecord> {
    this.requireFarmer(role);
    const farm = await this.farms.getFarmById(farmId);
    const code = input.displayCode.trim().toUpperCase();
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code)) {
      throw new DomainError('VALIDATION_FAILED', 'Kode ternak harus berisi 1–32 huruf, angka, titik, garis bawah, atau tanda hubung.');
    }
    if (name.length < 2 || name.length > 120) {
      throw new DomainError('VALIDATION_FAILED', 'Nama ternak harus berisi 2 sampai 120 karakter.');
    }
    if (!livestockSpecies.includes(input.species)) {
      throw new DomainError('VALIDATION_FAILED', 'Pilih jenis ternak yang tersedia.');
    }
    if (farm.species.length && !farm.species.includes(input.species)) {
      throw new DomainError('VALIDATION_FAILED', 'Jenis ternak tidak sesuai dengan peternakan yang dipilih.');
    }
    if (!livestockSexes.includes(input.sex)) {
      throw new DomainError('VALIDATION_FAILED', 'Pilih jenis kelamin ternak yang tersedia.');
    }
    return this.writes.create({ ...input, farmId, displayCode: code, name });
  }

  async update(role: AccountRole, userId: string, farmId: string, livestockId: string, input: LivestockPatchInput): Promise<ApiLivestockRecord> {
    const current = await this.getForFarm(role, userId, farmId, livestockId);
    if (current.version !== input.expectedVersion) {
      throw new DomainError('VERSION_CONFLICT', 'Data ternak berubah di server. Muat ulang sebelum menyimpan.');
    }
    const name = input.name === undefined ? undefined : input.name.trim().replace(/\s+/g, ' ');
    if (name !== undefined && (name.length < 2 || name.length > 120)) {
      throw new DomainError('VALIDATION_FAILED', 'Nama ternak harus berisi 2 sampai 120 karakter.');
    }
    if (input.sex !== undefined && !livestockSexes.includes(input.sex)) {
      throw new DomainError('VALIDATION_FAILED', 'Pilih jenis kelamin ternak yang tersedia.');
    }
    const saved = await this.writes.update(livestockId, { ...input, ...(name === undefined ? {} : { name }) });
    if (saved.id !== livestockId || saved.farmerId !== userId || saved.farmId !== farmId || saved.version <= current.version) {
      throw new DomainError('API_RESPONSE_INVALID', 'Hasil perubahan ternak tidak sesuai konteks atau versi server.');
    }
    return saved;
  }

  private requireFarmer(role: AccountRole): void {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat mengubah ternak.');
  }
}

export function filterServerLivestock(items: readonly ApiLivestockRecord[], filters: {
  query?: string;
  species?: LivestockSpecies | null;
}): ApiLivestockRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase('id-ID') ?? '';
  return items.filter((animal) => {
    if (filters.species && animal.species !== filters.species) return false;
    if (!query) return true;
    return [animal.displayCode, animal.name, animal.breed ?? '', speciesLabel(animal.species)]
      .some((value) => value.toLocaleLowerCase('id-ID').includes(query));
  });
}
