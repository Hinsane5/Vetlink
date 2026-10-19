import type { DomainEntity } from '../domain/entities';
import type { DomainRepository } from './ports/DomainRepository';

export async function hasOwnedFarmContext(repository: DomainRepository, farmerId: string, animal: DomainEntity): Promise<boolean> {
  if (animal.kind !== 'livestock' || animal.ownerId !== farmerId) return false;
  const farmId = stringValue(animal.payload.farmId);
  if (!farmId || animal.contextId !== farmId) return false;
  const farm = await repository.findById('farm', farmId);
  if (!farm || farm.kind !== 'farm' || farm.ownerId !== farmerId) return false;
  const [farmOwners, animalFarms, animalFarmers] = await Promise.all([
    repository.listRelated('farm', farmId, 'owner'),
    repository.listRelated('livestock', animal.id, 'farm'),
    repository.listRelated('livestock', animal.id, 'farmer'),
  ]);
  return farmOwners.some((item) => item.kind === 'user' && item.id === farmerId && item.ownerId === null)
    && animalFarms.some((item) => item.id === farmId && item.ownerId === farmerId)
    && animalFarmers.some((item) => item.kind === 'user' && item.id === farmerId);
}

export async function hasConsultationFarmContext(repository: DomainRepository, consultation: DomainEntity, animal: DomainEntity, farmerId: string): Promise<boolean> {
  if (!await hasOwnedFarmContext(repository, farmerId, animal)) return false;
  const farmId = stringValue(animal.payload.farmId);
  if (consultation.payload.farmId !== farmId || consultation.contextId !== farmId) return false;
  const farmLinks = await repository.listRelated('consultation', consultation.id, 'farm');
  return farmLinks.some((item) => item.id === farmId && item.ownerId === farmerId && item.kind === 'farm');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
