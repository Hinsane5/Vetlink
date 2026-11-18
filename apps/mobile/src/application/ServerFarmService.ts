import type { ApiFarmRecord, FarmReadRepository } from './ports/FarmReadRepository';
import type { FarmWriteRepository } from './ports/FarmWriteRepository';
import { DomainError } from '../domain/errors';

/** Owner scope is enforced by BE-02; this use case validates user input and session role. */
export class ServerFarmService {
  constructor(private readonly reads: FarmReadRepository, private readonly writes: FarmWriteRepository) {}

  list(role: 'farmer' | 'vet'): Promise<ApiFarmRecord[]> {
    this.requireFarmer(role);
    return this.reads.listFarms();
  }

  create(role: 'farmer' | 'vet', name: string): Promise<ApiFarmRecord> {
    this.requireFarmer(role);
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2 || normalized.length > 120) {
      throw new DomainError('VALIDATION_FAILED', 'Nama peternakan harus berisi 2 sampai 120 karakter.');
    }
    return this.writes.createFarm({ name: normalized, species: [] });
  }

  private requireFarmer(role: 'farmer' | 'vet'): void {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat mengakses peternakan.');
  }
}
