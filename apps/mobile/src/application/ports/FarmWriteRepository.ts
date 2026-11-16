import type { LivestockSpecies } from '../../domain/profiles';
import type { ApiAddressRecord, ApiFarmRecord } from './FarmReadRepository';

export interface FarmWriteInput {
  name: string;
  species?: LivestockSpecies[];
  timezone?: string;
  location?: Record<string, unknown>;
  visitAddressId?: string;
}

export interface FarmPatchInput extends Partial<FarmWriteInput> {
  expectedVersion: number;
}

/** Coordinates are JSON numbers on write and decimal strings on read. */
export interface AddressWriteInput {
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
}

export interface AddressPatchInput extends AddressWriteInput {
  expectedVersion: number;
}

/** Writes are scoped to the authenticated server session; no owner ID is accepted. */
export interface FarmWriteRepository {
  createFarm(input: FarmWriteInput): Promise<ApiFarmRecord>;
  updateFarm(farmId: string, input: FarmPatchInput): Promise<ApiFarmRecord>;
  createAddress(input: AddressWriteInput): Promise<ApiAddressRecord>;
  updateAddress(addressId: string, input: AddressPatchInput): Promise<ApiAddressRecord>;
  deleteAddress(addressId: string): Promise<void>;
}
