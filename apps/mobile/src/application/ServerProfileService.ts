import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type {
  ApiFarmerProfile, ApiProfileRepository, ApiVerificationSubmission, ApiVetProfile,
} from './ports/ApiProfileRepository';

export type ServerProfileForm = {
  fullName: string;
  professionalName: string;
  registrationReference: string;
};

export type ServerProfileSnapshot =
  | { role: 'farmer'; profile: ApiFarmerProfile; submissions: [] }
  | { role: 'vet'; profile: ApiVetProfile; submissions: ApiVerificationSubmission[] };

export class ServerProfileService {
  constructor(private readonly profiles: ApiProfileRepository) {}

  async get(role: AccountRole): Promise<ServerProfileSnapshot> {
    if (role === 'farmer') return { role, profile: await this.profiles.getFarmer(), submissions: [] };
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membaca profil server.');
    const [profile, submissions] = await Promise.all([this.profiles.getVet(), this.profiles.listVerification()]);
    return { role, profile, submissions };
  }

  async save(role: AccountRole, input: ServerProfileForm): Promise<ApiFarmerProfile | ApiVetProfile> {
    if (!input || typeof input !== 'object' || typeof input.fullName !== 'string')
      throw new DomainError('VALIDATION_FAILED', 'Nama profil tidak valid.');
    const fullName = input.fullName.trim();
    if (!fullName || fullName.length > 120)
      throw new DomainError('VALIDATION_FAILED', 'Nama lengkap harus berisi 1–120 karakter.');
    if (role === 'farmer') return this.profiles.patchFarmer({ fullName });
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat mengubah profil server.');
    const professionalName = normalizeOptional(input.professionalName, 'Nama praktik');
    const registrationReference = normalizeOptional(input.registrationReference, 'Nomor registrasi');
    return this.profiles.patchVet({ fullName, professionalName, registrationReference });
  }
}

function normalizeOptional(value: string, label: string): string {
  if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', `${label} tidak valid.`);
  const normalized = value.trim();
  if (normalized.length > 120) throw new DomainError('VALIDATION_FAILED', `${label} maksimal 120 karakter.`);
  return normalized;
}
