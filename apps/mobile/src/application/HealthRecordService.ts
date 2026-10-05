import type { DomainEntity, DomainEvent } from '../domain/entities';
import { DomainError } from '../domain/errors';
import {
  selectHealthHistory,
  validateFarmerHealthReport,
  type FarmerHealthReportInput,
  type HealthRecordAttachment,
  type HealthRecordKind,
  type HealthRecordSnapshot,
} from '../domain/health';
import type { LivestockService } from './LivestockService';
import type { ProfileService } from './ProfileService';
import type { DomainRepository } from './ports/DomainRepository';
import type { EventStore } from './ports/EventStore';
import { publishLocalEvent } from './publishLocalEvent';
import { listVetPatientAssignments } from './vetPatientAccess';

export class HealthRecordService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly livestock: Pick<LivestockService, 'get'>,
    private readonly profiles: Pick<ProfileService, 'load'>,
    private readonly events: EventStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listForFarmer(farmerId: string, animalId: string): Promise<HealthRecordSnapshot[]> {
    await this.livestock.get(farmerId, animalId);
    const animal = await this.requireAnimal(animalId);
    return this.readHistory(animal);
  }

  async addFarmerReport(
    farmerId: string,
    animalId: string,
    input: FarmerHealthReportInput,
  ): Promise<HealthRecordSnapshot> {
    await this.livestock.get(farmerId, animalId);
    const animal = await this.requireAnimal(animalId);
    const values = validateFarmerHealthReport(input);
    const key = `${farmerId}:${animalId}:${values.operationKey}`;
    const eventId = `health-report:${key}`;
    const healthEventId = `health-event:${key}`;
    const timestamp = this.now().toISOString();
    const record: DomainEntity = {
      id: healthEventId,
      kind: 'healthEvent',
      ownerId: farmerId,
      contextId: animalId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      payload: {
        animalId,
        kind: values.kind,
        occurredAt: values.occurredAt,
        description: values.description,
        actorId: farmerId,
        provenance: 'farmer_report',
        operationKey: values.operationKey,
        sourceKey: `farmer-report:${key}`,
      },
    };
    const event: DomainEvent = {
      id: eventId,
      type: 'health_event.farmer_reported',
      aggregateId: animalId,
      occurredAt: values.occurredAt,
      payload: {
        farmerId,
        animalId,
        healthEventId,
        kind: values.kind,
        occurredAt: values.occurredAt,
        description: values.description,
        operationKey: values.operationKey,
      },
    };
    await publishLocalEvent(this.events, event, [{
      key: `farmer-health-report:${key}`,
      entity: record,
      relations: [{ sourceId: record.id, relationship: 'animal', targetId: animal.id }],
    }]);
    const persisted = await this.repository.findById('healthEvent', healthEventId);
    if (!persisted) throw new DomainError('INVALID_STATE', 'Laporan kesehatan tidak ditemukan setelah disimpan.');
    const history = await this.readHistory(animal);
    const result = history.find((item) => item.id === persisted.id);
    if (!result) throw new DomainError('INVALID_STATE', 'Laporan kesehatan tersimpan tetapi tidak dapat dibaca.');
    return result;
  }

  async listForVet(vetId: string, animalId: string): Promise<HealthRecordSnapshot[]> {
    await this.assertVet(vetId);
    const assignments = await listVetPatientAssignments(this.repository, vetId);
    const assignment = assignments.find((item) => item.animal.id === animalId);
    if (!assignment) throw new DomainError('FORBIDDEN', 'Dokter ini tidak memiliki layanan terkait pasien tersebut.');
    return this.readHistory(assignment.animal);
  }

  async getAttachmentForFarmer(
    farmerId: string,
    animalId: string,
    attachmentId: string,
  ): Promise<HealthRecordAttachment> {
    const records = await this.listForFarmer(farmerId, animalId);
    return findAttachment(records, attachmentId);
  }

  async getAttachmentForVet(
    vetId: string,
    animalId: string,
    attachmentId: string,
  ): Promise<HealthRecordAttachment> {
    const records = await this.listForVet(vetId, animalId);
    return findAttachment(records, attachmentId);
  }

  private async assertVet(vetId: string): Promise<void> {
    const profile = await this.profiles.load(vetId, 'vet');
    if (profile.role !== 'vet' || !profile.vet) {
      throw new DomainError('FORBIDDEN', 'Fitur pasien hanya tersedia untuk profil Dokter milik akun ini.');
    }
  }

  private async requireAnimal(animalId: string): Promise<DomainEntity> {
    const animal = await this.repository.findById('livestock', animalId);
    if (!animal || animal.kind !== 'livestock') throw new DomainError('NOT_FOUND', 'Data ternak tidak ditemukan.');
    return animal;
  }

  private async readHistory(animal: DomainEntity): Promise<HealthRecordSnapshot[]> {
    const [events, notes] = await Promise.all([
      this.repository.listByRelated('healthEvent', animal.id, 'animal'),
      this.repository.listByRelated('clinicalNote', animal.id, 'animal'),
    ]);
    const items: HealthRecordSnapshot[] = [];
    const representedNoteIds = new Set<string>();

    for (const note of notes) {
      const item = await this.toClinicalRecord(note, animal);
      if (!item) continue;
      items.push(item);
      representedNoteIds.add(note.id);
    }

    for (const event of events) {
      if (event.kind !== 'healthEvent' || event.ownerId !== animal.ownerId || event.payload.animalId !== animal.id) continue;
      const linkedNoteId = stringValue(event.payload.clinicalNoteId);
      if (linkedNoteId && representedNoteIds.has(linkedNoteId)) continue;
      const item = await this.toFarmerReportOrReminder(event, animal);
      if (item) items.push(item);
    }
    return selectHealthHistory(items);
  }

  private async toClinicalRecord(note: DomainEntity, animal: DomainEntity): Promise<HealthRecordSnapshot | null> {
    if (note.kind !== 'clinicalNote' || note.payload.animalId !== animal.id || note.payload.status !== 'final') return null;
    const vetId = stringValue(note.payload.vetId);
    const finalizedAt = isoTimestamp(note.payload.finalizedAt);
    if (!vetId || note.ownerId !== vetId || note.payload.finalizedBy !== vetId || !finalizedAt) return null;

    const [animalLinks, vetLinks, noteConsultations] = await Promise.all([
      this.repository.listRelated('clinicalNote', note.id, 'animal'),
      this.repository.listRelated('clinicalNote', note.id, 'veterinarian'),
      this.repository.listRelated('clinicalNote', note.id, 'consultation'),
    ]);
    if (!animalLinks.some((item) => item.id === animal.id)) return null;
    if (!vetLinks.some((item) => item.id === vetId && item.kind === 'user')) return null;

    let validConsultation: DomainEntity | null = null;
    for (const linked of noteConsultations) {
      const consultation = await this.repository.findById('consultation', linked.id);
      if (!consultation || consultation.kind !== 'consultation') continue;
      if (consultation.payload.animalId !== animal.id || consultation.payload.vetId !== vetId) continue;
      if (consultation.payload.farmerId !== animal.ownerId || consultation.ownerId !== animal.ownerId) continue;
      const [consultationAnimals, farmers, vets] = await Promise.all([
        this.repository.listRelated('consultation', consultation.id, 'animal'),
        this.repository.listRelated('consultation', consultation.id, 'farmer'),
        this.repository.listRelated('consultation', consultation.id, 'veterinarian'),
      ]);
      if (!consultationAnimals.some((item) => item.id === animal.id)
        || !farmers.some((item) => item.id === animal.ownerId)
        || !vets.some((item) => item.id === vetId)) continue;
      validConsultation = consultation;
      break;
    }
    if (!validConsultation) return null;

    const actor = await this.repository.findById('user', vetId);
    const complaint = stringValue(note.payload.complaint);
    const findings = stringValue(note.payload.findings);
    const clinicalNote = {
      consultationId: validConsultation.id,
      complaint,
      findings,
      assessment: stringValue(note.payload.assessment),
      actions: stringValue(note.payload.actions),
      careInstructions: stringValue(note.payload.careInstructions),
      finalizedAt,
    };
    return {
      id: note.id,
      animalId: animal.id,
      kind: 'examination',
      occurredAt: finalizedAt,
      description: complaint || findings || 'Catatan pemeriksaan final',
      actorId: vetId,
      actorName: stringValue(actor?.payload.name) || stringValue(actor?.payload.professionalName) || 'Dokter hewan',
      source: 'clinical_note',
      clinicalNote,
      attachments: await this.attachmentsFor(note),
    };
  }

  private async toFarmerReportOrReminder(
    event: DomainEntity,
    animal: DomainEntity,
  ): Promise<HealthRecordSnapshot | null> {
    const kind = stringValue(event.payload.kind);
    if (!isHealthRecordKind(kind) || kind === 'examination') return null;
    const occurredAt = isoTimestamp(event.payload.occurredAt) ?? isoTimestamp(event.createdAt);
    if (!occurredAt) return null;

    const actorId = stringValue(event.payload.actorId);
    const description = stringValue(event.payload.description);
    const provenance = stringValue(event.payload.provenance);
    let source: HealthRecordSnapshot['source'];
    if (provenance === 'farmer_report' && actorId === animal.ownerId && event.ownerId === animal.ownerId) {
      source = 'farmer_report';
    } else if (kind === 'care' && provenance === 'reminder') {
      const reminderId = stringValue(event.payload.reminderId);
      const reminder = reminderId ? await this.repository.findById('reminder', reminderId) : null;
      const links = reminder ? await this.repository.listRelated('healthEvent', event.id, 'reminder') : [];
      if (!reminder || reminder.kind !== 'reminder' || reminder.ownerId !== animal.ownerId
        || reminder.payload.animalId !== animal.id || reminder.payload.careStatus !== 'done'
        || !links.some((item) => item.id === reminder.id)) return null;
      source = 'reminder';
    } else {
      return null;
    }
    if (description.length < 1) return null;
    const actor = actorId ? await this.repository.findById('user', actorId) : null;
    return {
      id: event.id,
      animalId: animal.id,
      kind,
      occurredAt,
      description,
      actorId: actorId || animal.ownerId || '',
      actorName: stringValue(actor?.payload.name) || (source === 'reminder' ? 'Perawatan ternak' : 'Peternak'),
      source,
      clinicalNote: null,
      attachments: await this.attachmentsFor(event),
    };
  }

  private async attachmentsFor(source: DomainEntity): Promise<HealthRecordAttachment[]> {
    const related = await this.repository.listRelated(source.kind, source.id, 'attachment');
    return related.flatMap((item) => {
      if (item.kind !== 'attachment' || item.ownerId !== source.ownerId || item.contextId !== source.id) return [];
      if (item.payload.accessContext !== 'health_record') return [];
      const mimeType = stringValue(item.payload.mimeType);
      if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/') && mimeType !== 'application/pdf') return [];
      const uri = stringValue(item.payload.localUri) || null;
      return [{
        id: item.id,
        filename: stringValue(item.payload.filename) || 'Lampiran',
        mimeType,
        uri,
        available: uri !== null,
      }];
    });
  }
}

function findAttachment(records: readonly HealthRecordSnapshot[], attachmentId: string): HealthRecordAttachment {
  for (const record of records) {
    const attachment = record.attachments.find((item) => item.id === attachmentId);
    if (attachment) return attachment;
  }
  throw new DomainError('NOT_FOUND', 'Lampiran tidak tersedia pada riwayat pasien ini.');
}

function isHealthRecordKind(value: string): value is HealthRecordKind {
  return value === 'examination' || value === 'disease' || value === 'vaccine' || value === 'medication' || value === 'care';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
