import type { DomainRepository } from './ports/DomainRepository';
import type { ProfileService } from './ProfileService';
import { projectDirectorySlots, type DirectorySchedule, type DirectoryServiceType, type DirectoryVet } from '../domain/directory';
import { DomainError } from '../domain/errors';
import type { DomainEntity } from '../domain/entities';

export class VetDirectoryService {
  constructor(
    private readonly repository: Pick<DomainRepository, 'listByKind' | 'listByOwner' | 'listByRelated'>,
    private readonly profiles: Pick<ProfileService, 'load'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<DirectoryVet[]> {
    const clock = this.now().getTime();
    const [users, reviews, consultations] = await Promise.all([
      this.repository.listByKind('user'), this.repository.listByKind('review'), this.repository.listByKind('consultation'),
    ]);
    const publicReviews = reviews.filter((review) => {
      const consultation = consultations.find((item) => item.id === review.payload.consultationId);
      return consultation?.payload.status === 'completed'
        && consultation.payload.vetId === review.payload.vetId
        && consultation.payload.farmerId === review.payload.farmerId
        && review.ownerId === review.payload.farmerId
        && Number.isInteger(review.payload.stars) && Number(review.payload.stars) >= 1 && Number(review.payload.stars) <= 5;
    });
    const vets = users.filter((user) => user.payload.status === 'active' && Array.isArray(user.payload.roles) && user.payload.roles.includes('vet'));
    return Promise.all(vets.map(async (user) => {
      const [profile, availability, rates] = await Promise.all([
        this.profiles.load(user.id, 'vet'), this.repository.listByOwner('availability', user.id), this.repository.listByOwner('serviceRate', user.id),
      ]);
      const services = profile.vet?.services ?? [];
      return {
        id: user.id, name: profile.vet?.professionalName || profile.displayName, photoUri: profile.photo?.localUri || null,
        verified: profile.verificationStatus === 'verified',
        accepting: newestAvailability(availability)?.payload.acceptingNewRequests === true && profile.verificationStatus === 'verified',
        species: profile.vet?.species ?? [], services, location: profile.vet?.practiceLocation ?? '',
        visitRegions: profile.vet?.visitRegions ?? [], experienceYears: profile.vet?.experienceYears ?? 0,
        rates: services.flatMap((service) => {
          const rate = rates.filter((item) => item.payload.serviceType === service && Number.isSafeInteger(item.payload.amount) && Number(item.payload.amount) >= 0 && Date.parse(String(item.payload.effectiveAt)) <= clock)
            .sort((a, b) => Date.parse(String(b.payload.effectiveAt)) - Date.parse(String(a.payload.effectiveAt)) || Number(b.payload.configurationVersion ?? 0) - Number(a.payload.configurationVersion ?? 0) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
          return rate ? [{ service, amount: Number(rate.payload.amount) }] : [];
        }),
        reviews: publicReviews.filter((review) => review.payload.vetId === user.id).map((review) => ({
          id: review.id, stars: Number(review.payload.stars), text: typeof review.payload.text === 'string' ? review.payload.text : '', submittedAt: Number.isFinite(Date.parse(String(review.payload.submittedAt))) ? String(review.payload.submittedAt) : review.createdAt,
        })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      } satisfies DirectoryVet;
    }));
  }

  async get(id: string): Promise<DirectoryVet> {
    const vet = (await this.list()).find((item) => item.id === id);
    if (!vet) throw new DomainError('NOT_FOUND', 'Dokter tidak ditemukan.');
    return vet;
  }

  async slots(id: string, service: DirectoryServiceType): Promise<DirectorySchedule> {
    const vet = await this.get(id);
    const [availability, blocked, consultations, followUps] = await Promise.all([
      this.repository.listByOwner('availability', id), this.repository.listByOwner('blockedTime', id),
      this.repository.listByRelated('consultation', id, 'veterinarian'), this.repository.listByKind('followUp'),
    ]);
    return projectDirectorySlots(vet, service, newestAvailability(availability), [...blocked, ...consultations, ...followUps.filter((item) => item.payload.vetId === id)], this.now());
  }
}

function newestAvailability(records: DomainEntity[]): DomainEntity | undefined {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version)[0];
}
