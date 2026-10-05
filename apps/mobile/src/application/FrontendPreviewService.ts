import type { AccountRole, SessionSnapshot } from '../domain/auth';
import { DomainError } from '../domain/errors';
import { fixtureIds } from '../testing/fixtures';
import type { ProfileService } from './ProfileService';
import type { DomainRepository } from './ports/DomainRepository';

// Identitas ini hanya memilih persona dari fixture lokal untuk menelusuri frontend.
// Tidak ada credential, session persisten, atau hak akses produksi yang diberikan.
const personaIds: Record<AccountRole, string> = {
  farmer: fixtureIds.budi,
  vet: fixtureIds.vetZero,
};

export class FrontendPreviewService {
  constructor(
    private readonly repository: Pick<DomainRepository, 'findById'>,
    private readonly profiles: Pick<ProfileService, 'load'>,
  ) {}

  async open(role: AccountRole): Promise<SessionSnapshot> {
    const userId = personaIds[role];
    const user = await this.repository.findById('user', userId);
    if (!user || user.kind !== 'user') {
      throw new DomainError('NOT_FOUND', 'Data contoh peran ini belum tersedia di penyimpanan lokal.');
    }
    const profile = await this.profiles.load(userId, role);
    if (profile.role !== role || (role === 'farmer' ? !profile.farmer : !profile.vet)) {
      throw new DomainError('NOT_FOUND', 'Profil contoh peran ini belum tersedia.');
    }
    const name = typeof user.payload.name === 'string' ? user.payload.name : profile.displayName;
    const email = typeof user.payload.email === 'string' ? user.payload.email : '';
    return {
      sessionId: `frontend-preview:${role}`,
      userId,
      displayName: name,
      email,
      activeRole: role,
      roles: [role],
      expiresAt: '',
    };
  }
}
