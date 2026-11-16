import type { LivestockSpecies } from '../../domain/profiles';

export interface ApiFarmRecord {
  id: string;
  name: string;
  species: LivestockSpecies[];
  timezone: string;
  location: Record<string, unknown> | null;
  visitAddressId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ApiAddressRecord {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  latitude: string | null;
  longitude: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Read-only access to the active farmer's farms and saved addresses. */
export interface FarmReadRepository {
  listFarms(): Promise<ApiFarmRecord[]>;
  getFarmById(farmId: string): Promise<ApiFarmRecord>;
  listAddresses(): Promise<ApiAddressRecord[]>;
  getAddressById(addressId: string): Promise<ApiAddressRecord>;
}
