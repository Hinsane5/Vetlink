import type { DirectoryServiceType } from '../../domain/directory';
import type { LivestockSpecies } from '../../domain/profiles';

export interface ApiDirectoryWeekdayRule {
  weekday: number;
  start: string;
  end: string;
}

/** A discoverable summary returned only by the verified-vet directory route. */
export interface ApiVetDirectoryRecord {
  id: string;
  professionalName: string;
  experienceYears: number;
  specialties: string[];
  species: LivestockSpecies[];
  practiceLocation: string;
  serviceAreas: string[];
  acceptingNewRequests: boolean;
  services: DirectoryServiceType[];
  timezone: string;
  weekdayRules: ApiDirectoryWeekdayRule[];
  fees: Partial<Record<DirectoryServiceType, number>>;
  minFeeIdr: number;
  maxFeeIdr: number;
  ratingAverage: number;
  ratingCount: number;
}

export interface ApiVetDirectoryDetail extends Omit<ApiVetDirectoryRecord, 'fees' | 'minFeeIdr' | 'maxFeeIdr'> {
  chatDurationMinutes: number;
  visitDurationMinutes: number;
  rates: Partial<Record<DirectoryServiceType, number>>;
}

export interface VetDirectoryQuery {
  name?: string;
  species?: LivestockSpecies;
  service?: DirectoryServiceType;
  location?: string;
  available?: boolean;
  minFeeIdr?: number;
  maxFeeIdr?: number;
  /** Opaque server cursor. Pass it back unchanged to the same route/scope. */
  cursor?: string;
  limit?: number;
}

export interface VetDirectoryPage {
  items: ApiVetDirectoryRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface VetSlotsQuery {
  dateFrom: string;
  dateTo: string;
  service: DirectoryServiceType;
}

export interface ApiVetSlot {
  startsAt: string;
  endsAt: string;
}

/** Verified directory/detail/slot reads; service eligibility remains server-enforced. */
export interface VetDirectoryReadRepository {
  search(query?: VetDirectoryQuery): Promise<VetDirectoryPage>;
  getById(vetId: string): Promise<ApiVetDirectoryDetail>;
  getSlots(vetId: string, query: VetSlotsQuery): Promise<ApiVetSlot[]>;
}
