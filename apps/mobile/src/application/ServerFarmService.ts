import type { ApiAddressRecord, ApiFarmRecord, FarmReadRepository } from './ports/FarmReadRepository';
import type { AddressPatchInput, AddressWriteInput, FarmWriteRepository } from './ports/FarmWriteRepository';
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

  listAddresses(role: 'farmer' | 'vet'): Promise<ApiAddressRecord[]> {
    this.requireFarmer(role);
    return this.reads.listAddresses();
  }

  createAddress(role: 'farmer' | 'vet', input: AddressWriteInput): Promise<ApiAddressRecord> {
    this.requireFarmer(role);
    const normalized = normalizeAddress(input);
    return this.writes.createAddress(normalized);
  }

  async updateAddress(role: 'farmer' | 'vet', addressId: string, input: AddressPatchInput): Promise<ApiAddressRecord> {
    this.requireFarmer(role);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new DomainError('VALIDATION_FAILED', 'Versi alamat tidak valid. Muat ulang sebelum menyimpan.');
    }
    const current = await this.reads.getAddressById(addressId);
    if (current.id !== addressId || current.version !== input.expectedVersion) {
      throw new DomainError('VERSION_CONFLICT', 'Alamat berubah di server. Muat ulang sebelum menyimpan.');
    }
    const saved = await this.writes.updateAddress(addressId, { ...normalizeAddress(input), expectedVersion: input.expectedVersion });
    if (saved.id !== addressId || saved.version <= current.version) {
      throw new DomainError('API_RESPONSE_INVALID', 'Alamat server tidak menyimpan perubahan dengan versi baru.');
    }
    return saved;
  }

  async setVisitAddress(role: 'farmer' | 'vet', farmId: string, addressId: string): Promise<ApiFarmRecord> {
    this.requireFarmer(role);
    if (!farmId || !addressId) throw new DomainError('VALIDATION_FAILED', 'Pilih Farm dan alamat kunjungan.');
    const farm = await this.reads.getFarmById(farmId);
    const address = await this.reads.getAddressById(addressId);
    if (farm.id !== farmId || address.id !== addressId) {
      throw new DomainError('API_RESPONSE_INVALID', 'Farm atau alamat server tidak sesuai pilihan.');
    }
    if (farm.visitAddressId === addressId) return farm;
    const saved = await this.writes.updateFarm(farmId, { visitAddressId: addressId, expectedVersion: farm.version });
    if (saved.id !== farmId || saved.visitAddressId !== addressId || saved.version <= farm.version) {
      throw new DomainError('API_RESPONSE_INVALID', 'Farm server tidak menyimpan alamat kunjungan yang dipilih.');
    }
    return saved;
  }

  private requireFarmer(role: 'farmer' | 'vet'): void {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat mengakses peternakan.');
  }
}

function normalizeAddress(input: AddressWriteInput): AddressWriteInput {
  if (!input || typeof input !== 'object') throw new DomainError('VALIDATION_FAILED', 'Data alamat tidak lengkap.');
  const fields: (keyof Pick<AddressWriteInput, 'label' | 'recipientName' | 'phone' | 'addressLine' | 'city' | 'province' | 'postalCode'>)[] = [
    'label', 'recipientName', 'phone', 'addressLine', 'city', 'province', 'postalCode',
  ];
  const values = Object.fromEntries(fields.map((field) => [field, input[field]?.trim() ?? ''])) as Pick<AddressWriteInput, typeof fields[number]>;
  const bounds: Record<(typeof fields)[number], [number, number, string]> = {
    label: [1, 80, 'Label alamat'],
    recipientName: [1, 120, 'Nama penerima'],
    phone: [5, 32, 'Nomor telepon'],
    addressLine: [1, 500, 'Alamat lengkap'],
    city: [1, 120, 'Kota/kabupaten'],
    province: [1, 120, 'Provinsi'],
    postalCode: [1, 16, 'Kode pos'],
  };
  for (const field of fields) {
    const [minimum, maximum, label] = bounds[field];
    if (values[field].length < minimum || values[field].length > maximum) {
      throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${minimum} sampai ${maximum} karakter.`);
    }
  }
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    throw new DomainError('VALIDATION_FAILED', 'Latitude dan longitude harus diisi bersama.');
  }
  return { ...values, ...(input.latitude === undefined ? {} : { latitude: input.latitude, longitude: input.longitude }) };
}
