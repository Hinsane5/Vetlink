import type { LivestockSex } from '../../domain/livestock';
import type { LivestockSpecies } from '../../domain/profiles';

export interface ApiLivestockRecord {
  id: string;
  farmerId: string;
  farmId: string;
  displayCode: string;
  name: string;
  species: LivestockSpecies;
  breed: string | null;
  sex: LivestockSex;
  birthDate: string | null;
  estimatedAgeMonths: number | null;
  /** PostgreSQL decimal string; preserve precision and do not coerce to number. */
  weightKg: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LivestockReadQuery {
  /** Opaque server cursor. Pass it back unchanged to the same route/scope. */
  cursor?: string;
  limit?: number;
}

export interface LivestockReadPage {
  items: ApiLivestockRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The server applies farmer ownership or veterinarian assignment scope. */
export interface LivestockReadRepository {
  listPage(query?: LivestockReadQuery): Promise<LivestockReadPage>;
  getById(livestockId: string): Promise<ApiLivestockRecord>;
}
