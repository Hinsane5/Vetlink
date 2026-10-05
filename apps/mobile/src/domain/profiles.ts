import { DomainError } from './errors';
import type { AccountRole } from './auth';
import type { VerificationStatus } from './policies';

export const livestockSpecies = [
  'cattle',
  'goat',
  'sheep',
  'poultry',
  'duck',
  'pig',
  'horse',
] as const;

export type LivestockSpecies = (typeof livestockSpecies)[number];
export type VetService = 'chat' | 'visit';

export interface FarmerProfileInput {
  displayName: string;
  farmName: string;
  species: LivestockSpecies[];
  farmLocation: string;
  addressLabel: string;
  recipient: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface VetProfileInput {
  professionalName: string;
  registrationNumber: string;
  experienceYears: number;
  services: VetService[];
  species: LivestockSpecies[];
  practiceLocation: string;
  visitRegions: string[];
}

export type ProfileForm =
  | { role: 'farmer'; values: FarmerProfileInput }
  | { role: 'vet'; values: VetProfileInput };

export interface SelectedAsset {
  uri: string;
  filename: string;
  mimeType: string;
  byteSize: number | null;
  kind: 'image' | 'document';
}

export type AttachmentSelection =
  | { type: 'new'; asset: SelectedAsset }
  | { type: 'existing'; attachmentId: string };

export interface ProfileMediaSelection {
  photo?: AttachmentSelection;
  documents?: AttachmentSelection[];
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  localUri: string;
  kind: 'image' | 'document';
}

export interface ProfileDraftSnapshot {
  form: ProfileForm;
  photo: AttachmentSummary | null;
  documents: AttachmentSummary[];
}

export interface ProfileSnapshot {
  role: AccountRole;
  displayName: string;
  farmer: FarmerProfileInput | null;
  vet: VetProfileInput | null;
  photo: AttachmentSummary | null;
  verificationStatus: VerificationStatus | null;
  reviewerReason: string | null;
  verificationDocuments: AttachmentSummary[];
  draft: ProfileDraftSnapshot | null;
}

export function validateFarmerProfile(input: FarmerProfileInput): FarmerProfileInput {
  const normalized: FarmerProfileInput = {
    displayName: requiredText(input.displayName, 'Nama lengkap', 2, 80),
    farmName: requiredText(input.farmName, 'Nama peternakan', 2, 100),
    species: normalizeChoiceList(input.species, livestockSpecies, 'Pilih minimal satu jenis ternak.'),
    farmLocation: requiredText(input.farmLocation, 'Wilayah peternakan', 2, 120),
    addressLabel: requiredText(input.addressLabel, 'Label alamat', 2, 80),
    recipient: requiredText(input.recipient, 'Nama penerima', 2, 80),
    phone: requiredText(input.phone, 'Nomor telepon', 8, 24),
    address: requiredText(input.address, 'Alamat lengkap', 5, 240),
    city: requiredText(input.city, 'Kota atau kabupaten', 2, 80),
    province: requiredText(input.province, 'Provinsi', 2, 80),
    postalCode: requiredText(input.postalCode, 'Kode pos', 3, 12),
  };
  return normalized;
}

export function validateVetProfile(input: VetProfileInput): VetProfileInput {
  const services = [...new Set(input.services.filter((service): service is VetService => service === 'chat' || service === 'visit'))];
  if (!services.length) throw new DomainError('VALIDATION_FAILED', 'Pilih minimal satu jenis layanan.');
  if (!Number.isInteger(input.experienceYears) || input.experienceYears < 0 || input.experienceYears > 70) {
    throw new DomainError('VALIDATION_FAILED', 'Pengalaman harus berupa bilangan bulat antara 0 sampai 70 tahun.');
  }
  return {
    professionalName: requiredText(input.professionalName, 'Nama profesional', 2, 100),
    registrationNumber: requiredText(input.registrationNumber, 'Nomor registrasi profesi', 3, 80),
    experienceYears: input.experienceYears,
    services,
    species: normalizeChoiceList(input.species, livestockSpecies, 'Pilih minimal satu jenis ternak yang dilayani.'),
    practiceLocation: requiredText(input.practiceLocation, 'Lokasi praktik', 2, 160),
    visitRegions: normalizeTextList(input.visitRegions, 'Tambahkan minimal satu wilayah layanan.'),
  };
}

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return value === 'not_submitted' || value === 'pending' || value === 'revision_required' || value === 'verified';
}

function requiredText(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${min} sampai ${max} karakter.`);
  }
  return normalized;
}

function normalizeChoiceList<T extends string>(values: readonly string[], allowed: readonly T[], message: string): T[] {
  const normalized = [...new Set(values.filter((value): value is T => allowed.includes(value as T)))];
  if (!normalized.length) throw new DomainError('VALIDATION_FAILED', message);
  return normalized;
}

function normalizeTextList(values: readonly string[], message: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (!normalized.length) throw new DomainError('VALIDATION_FAILED', message);
  return normalized;
}
