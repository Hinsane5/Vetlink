import { DomainError } from './errors';
import { livestockSpecies, type LivestockSpecies } from './profiles';

export const livestockSexes = ['female', 'male', 'unknown'] as const;
export type LivestockSex = (typeof livestockSexes)[number];

export interface LivestockInput {
  displayCode: string;
  name: string;
  species: LivestockSpecies;
  breed: string;
  sex: LivestockSex;
  estimatedAgeMonths: number;
  weightKg: number;
}

export interface LivestockPhoto {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  localUri: string;
}

export interface LivestockSnapshot extends LivestockInput {
  id: string;
  farmId: string;
  photo: LivestockPhoto | null;
  createdAt: string;
  updatedAt: string;
}

export interface LivestockFilters {
  query?: string;
  species?: LivestockSpecies;
  sex?: LivestockSex;
}

export function validateLivestockInput(input: LivestockInput): LivestockInput {
  const displayCode = requiredText(input.displayCode, 'ID ternak', 2, 24).toLocaleUpperCase('id-ID');
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(displayCode)) {
    throw new DomainError('VALIDATION_FAILED', 'ID ternak hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.');
  }
  const name = requiredText(input.name, 'Nama ternak', 2, 100);
  const breed = requiredText(input.breed, 'Ras ternak', 2, 100);
  if (!livestockSpecies.includes(input.species)) {
    throw new DomainError('VALIDATION_FAILED', 'Pilih jenis ternak yang tersedia.');
  }
  if (!livestockSexes.includes(input.sex)) {
    throw new DomainError('VALIDATION_FAILED', 'Pilih jenis kelamin ternak yang tersedia.');
  }
  if (!Number.isInteger(input.estimatedAgeMonths) || input.estimatedAgeMonths < 0 || input.estimatedAgeMonths > 1200) {
    throw new DomainError('VALIDATION_FAILED', 'Umur harus berupa bilangan bulat dari 0 sampai 1200 bulan.');
  }
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0 || input.weightKg > 100000) {
    throw new DomainError('VALIDATION_FAILED', 'Berat harus lebih dari 0 dan tidak melebihi 100.000 kg.');
  }
  return { displayCode, name, species: input.species, breed, sex: input.sex, estimatedAgeMonths: input.estimatedAgeMonths, weightKg: input.weightKg };
}

export function selectLivestock(items: readonly LivestockSnapshot[], filters: LivestockFilters = {}): LivestockSnapshot[] {
  const query = filters.query?.trim().toLocaleLowerCase('id-ID') ?? '';
  return items
    .filter((item) => !filters.species || item.species === filters.species)
    .filter((item) => !filters.sex || item.sex === filters.sex)
    .filter((item) => {
      if (!query) return true;
      return [item.displayCode, item.name, item.species, item.breed]
        .some((value) => value.toLocaleLowerCase('id-ID').includes(query));
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'id-ID') || left.id.localeCompare(right.id));
}

function requiredText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${min} sampai ${max} karakter.`);
  }
  return normalized;
}
