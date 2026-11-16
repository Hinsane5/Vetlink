import type { LivestockSex } from '../../domain/livestock';
import type { LivestockSpecies } from '../../domain/profiles';
import type { ApiLivestockRecord } from './LivestockReadRepository';

export interface LivestockCreateInput {
  /** Explicit Farm selected by the Peternak; the account can own several Farms. */
  farmId: string;
  displayCode: string;
  name: string;
  species: LivestockSpecies;
  breed?: string;
  sex: LivestockSex;
  birthDate?: string;
  estimatedAgeMonths?: number;
  weightKg?: number;
}

export interface LivestockPatchInput {
  expectedVersion: number;
  displayCode?: string;
  name?: string;
  species?: LivestockSpecies;
  breed?: string | null;
  sex?: LivestockSex;
  birthDate?: string | null;
  estimatedAgeMonths?: number | null;
  weightKg?: number | null;
}

/** The server derives farmer ownership and applies active-role authorization. */
export interface LivestockWriteRepository {
  create(input: LivestockCreateInput): Promise<ApiLivestockRecord>;
  update(livestockId: string, input: LivestockPatchInput): Promise<ApiLivestockRecord>;
}
