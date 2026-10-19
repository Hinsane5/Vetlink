import { DomainError } from './errors';
import { livestockSpecies, type LivestockSpecies } from './profiles';

export type FarmInput = {
  name: string;
  species: LivestockSpecies[];
  location: string;
  addressLabel: string;
  recipient: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
};

export type FarmAddress = Pick<FarmInput, 'addressLabel' | 'recipient' | 'phone' | 'address' | 'city' | 'province' | 'postalCode'>;

export type FarmSnapshot = FarmInput & {
  id: string;
  selected: boolean;
  visitAddress: string;
  version: number;
};

export function validateFarmInput(input: FarmInput): FarmInput {
  const species = [...new Set(input.species.filter((value): value is LivestockSpecies => livestockSpecies.includes(value)))];
  if (!species.length) throw new DomainError('VALIDATION_FAILED', 'Pilih minimal satu jenis ternak.');
  return {
    name: requiredText(input.name, 'Nama peternakan', 2, 100),
    species,
    location: requiredText(input.location, 'Wilayah peternakan', 2, 120),
    addressLabel: requiredText(input.addressLabel, 'Label alamat', 2, 80),
    recipient: requiredText(input.recipient, 'Nama penerima', 2, 80),
    phone: requiredText(input.phone, 'Nomor telepon', 8, 24),
    address: requiredText(input.address, 'Alamat lengkap', 5, 240),
    city: requiredText(input.city, 'Kota atau kabupaten', 2, 80),
    province: requiredText(input.province, 'Provinsi', 2, 80),
    postalCode: requiredText(input.postalCode, 'Kode pos', 3, 12),
  };
}

export function formatFarmAddress(address: Pick<FarmInput, 'address' | 'city' | 'province' | 'postalCode'>): string {
  return [address.address, address.city, address.province, address.postalCode].filter(Boolean).join(', ');
}

function requiredText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${min} sampai ${max} karakter.`);
  }
  return normalized;
}
