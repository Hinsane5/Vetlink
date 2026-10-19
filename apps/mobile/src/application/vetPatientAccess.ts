import type { DomainEntity } from '../domain/entities';
import type { DomainRepository } from './ports/DomainRepository';
import { hasConsultationFarmContext } from './livestockAccess';

const patientConsultationStatuses = new Set([
  'requested',
  'scheduled',
  'reschedule_pending',
  'en_route',
  'arrived',
  'examining',
  'in_progress',
  'completed',
]);

export interface VetPatientAssignment {
  consultation: DomainEntity;
  animal: DomainEntity;
  farmer: DomainEntity;
}

/** Returns only animals linked to an active or completed consultation assigned to this veterinarian. */
export async function listVetPatientAssignments(
  repository: DomainRepository,
  vetId: string,
): Promise<VetPatientAssignment[]> {
  const assigned = await repository.listByRelated('consultation', vetId, 'veterinarian');
  const results: VetPatientAssignment[] = [];
  for (const consultation of assigned) {
    if (consultation.kind !== 'consultation' || consultation.payload.vetId !== vetId) continue;
    const status = stringValue(consultation.payload.status);
    if (!patientConsultationStatuses.has(status)) continue;

    const animalId = stringValue(consultation.payload.animalId);
    const farmerId = stringValue(consultation.payload.farmerId);
    if (!animalId || !farmerId || consultation.ownerId !== farmerId) continue;
    const animal = await repository.findById('livestock', animalId);
    const farmer = await repository.findById('user', farmerId);
    if (!animal || animal.kind !== 'livestock' || animal.ownerId !== farmerId || !farmer || farmer.kind !== 'user') continue;

    const [animalsOnConsultation, farmersOnConsultation, vetsOnConsultation, farmersOnAnimal, farmsOnAnimal] = await Promise.all([
      repository.listRelated('consultation', consultation.id, 'animal'),
      repository.listRelated('consultation', consultation.id, 'farmer'),
      repository.listRelated('consultation', consultation.id, 'veterinarian'),
      repository.listRelated('livestock', animal.id, 'farmer'),
      repository.listRelated('livestock', animal.id, 'farm'),
    ]);
    if (!animalsOnConsultation.some((item) => item.id === animalId && item.kind === 'livestock')) continue;
    if (!farmersOnConsultation.some((item) => item.id === farmerId && item.kind === 'user')) continue;
    if (!vetsOnConsultation.some((item) => item.id === vetId && item.kind === 'user')) continue;
    if (!farmersOnAnimal.some((item) => item.id === farmerId && item.kind === 'user')) continue;
    if (!farmsOnAnimal.some((item) => item.kind === 'farm' && item.ownerId === farmerId)
      || !(await hasConsultationFarmContext(repository, consultation, animal, farmerId))) continue;
    results.push({ consultation, animal, farmer });
  }
  return results;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
