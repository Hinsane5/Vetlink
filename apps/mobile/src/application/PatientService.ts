import type { DomainEntity } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { selectPatients, type PatientConsultationSnapshot, type PatientDetailSnapshot, type PatientFilters, type PatientSnapshot } from '../domain/health';
import type { ProfileService } from './ProfileService';
import type { DomainRepository } from './ports/DomainRepository';
import { listVetPatientAssignments, type VetPatientAssignment } from './vetPatientAccess';
import type { HealthRecordService } from './HealthRecordService';

export class PatientService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly profiles: Pick<ProfileService, 'load'>,
    private readonly healthRecords: Pick<HealthRecordService, 'listForVet'>,
  ) {}

  async list(vetId: string, filters: PatientFilters = {}): Promise<PatientSnapshot[]> {
    await this.assertVet(vetId);
    const assignments = await listVetPatientAssignments(this.repository, vetId);
    const groups = groupAssignments(assignments);
    const snapshots = await Promise.all([...groups.values()].map((group) => this.toSnapshot(group)));
    return selectPatients(snapshots, filters);
  }

  async get(vetId: string, animalId: string): Promise<PatientDetailSnapshot> {
    await this.assertVet(vetId);
    const assignments = await listVetPatientAssignments(this.repository, vetId);
    const group = groupAssignments(assignments).get(animalId);
    if (!group) throw new DomainError('FORBIDDEN', 'Dokter ini tidak memiliki layanan terkait pasien tersebut.');
    return {
      patient: await this.toSnapshot(group),
      consultations: group.consultations.map(toConsultationSnapshot)
        .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? '') || a.id.localeCompare(b.id)),
      history: await this.healthRecords.listForVet(vetId, animalId),
    };
  }

  private async assertVet(vetId: string): Promise<void> {
    const profile = await this.profiles.load(vetId, 'vet');
    if (profile.role !== 'vet' || !profile.vet) {
      throw new DomainError('FORBIDDEN', 'Daftar pasien hanya tersedia untuk profil Dokter milik akun ini.');
    }
  }

  private async toSnapshot(group: PatientGroup): Promise<PatientSnapshot> {
    const { animal, farmer, consultations } = group;
    const latest = latestStatusConsultation(consultations);
    return {
      id: animal.id,
      name: stringValue(animal.payload.name) || 'Ternak',
      displayCode: stringValue(animal.payload.displayCode) || animal.id,
      species: stringValue(animal.payload.species),
      breed: stringValue(animal.payload.breed),
      sex: stringValue(animal.payload.sex),
      estimatedAgeMonths: finiteNumber(animal.payload.estimatedAgeMonths),
      weightKg: finiteNumber(animal.payload.weightKg),
      ownerId: farmer.id,
      ownerName: stringValue(farmer.payload.name) || 'Peternak',
      lastServiceAt: latestServiceAt(consultations),
      serviceCount: consultations.length,
      latestServiceType: latest ? (latest.payload.type === 'visit' ? 'visit' : 'chat') : null,
      latestServiceStatus: latest ? stringValue(latest.payload.status) || null : null,
      photo: await this.photoFor(animal),
    };
  }

  private async photoFor(animal: DomainEntity): Promise<PatientSnapshot['photo']> {
    const photos = await this.repository.listRelated('livestock', animal.id, 'photo');
    const photo = photos.find((item) => item.kind === 'attachment'
      && item.ownerId === animal.ownerId
      && item.contextId === animal.id
      && item.payload.accessContext === 'livestock'
      && item.payload.kind === 'image'
      && typeof item.payload.mimeType === 'string'
      && item.payload.mimeType.startsWith('image/'));
    if (!photo) return null;
    const uri = stringValue(photo.payload.localUri) || null;
    return {
      id: photo.id,
      filename: stringValue(photo.payload.filename) || 'Foto ternak',
      mimeType: stringValue(photo.payload.mimeType),
      uri,
      available: uri !== null,
    };
  }
}

interface PatientGroup {
  animal: DomainEntity;
  farmer: DomainEntity;
  consultations: DomainEntity[];
}

function groupAssignments(assignments: readonly VetPatientAssignment[]): Map<string, PatientGroup> {
  const groups = new Map<string, PatientGroup>();
  for (const assignment of assignments) {
    const group = groups.get(assignment.animal.id) ?? {
      animal: assignment.animal,
      farmer: assignment.farmer,
      consultations: [],
    };
    if (!group.consultations.some((item) => item.id === assignment.consultation.id)) {
      group.consultations.push(assignment.consultation);
    }
    groups.set(assignment.animal.id, group);
  }
  return groups;
}

function toConsultationSnapshot(record: DomainEntity): PatientConsultationSnapshot {
  return {
    id: record.id,
    displayCode: stringValue(record.payload.displayCode) || record.id,
    type: record.payload.type === 'visit' ? 'visit' : 'chat',
    status: stringValue(record.payload.status) || 'unknown',
    startsAt: isoTimestamp(record.payload.startsAt),
    complaint: stringValue(record.payload.complaint),
  };
}

function latestServiceAt(consultations: readonly DomainEntity[]): string | null {
  const dates = consultations.flatMap((record) => {
    const date = isoTimestamp(record.payload.completionAt) ?? isoTimestamp(record.payload.startsAt) ?? isoTimestamp(record.updatedAt);
    return date ? [date] : [];
  });
  return dates.sort().at(-1) ?? null;
}

function latestStatusConsultation(consultations: readonly DomainEntity[]): DomainEntity | null {
  const statusPriority = (record: DomainEntity): number => {
    const status = stringValue(record.payload.status);
    if (status === 'in_progress' || status === 'en_route' || status === 'arrived' || status === 'examining') return 3;
    if (status === 'requested' || status === 'scheduled') return 2;
    return 1;
  };
  return consultations.slice().sort((left, right) => {
    const priorityDifference = statusPriority(right) - statusPriority(left);
    if (priorityDifference) return priorityDifference;
    const leftDate = isoTimestamp(left.payload.startsAt) ?? isoTimestamp(left.payload.completionAt) ?? left.updatedAt;
    const rightDate = isoTimestamp(right.payload.startsAt) ?? isoTimestamp(right.payload.completionAt) ?? right.updatedAt;
    return (rightDate ?? '').localeCompare(leftDate ?? '') || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
