import type { AccountRole } from '../domain/auth';
import type { DashboardConsultationItem, DashboardContextDetail, DashboardReminderItem, DashboardSnapshot } from '../domain/dashboard';
import { selectFarmerDashboard, selectVetDashboard } from '../domain/dashboard';
import type { DomainEntity } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { calculateWalletBalances, type LedgerMovement } from '../domain/ledger';
import { isVerificationStatus } from '../domain/profiles';
import type { IdFactory } from './ports/AuthRepository';
import type { DomainRepository } from './ports/DomainRepository';
import type { ProfileService } from './ProfileService';

const ledgerKinds = new Set([
  'earn_pending',
  'release_pending',
  'credit_available',
  'reserve_withdrawal',
  'release_withdrawal',
  'payout_paid',
]);

export class DashboardService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly profiles: ProfileService,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole): Promise<DashboardSnapshot> {
    const profile = await this.profiles.load(userId, role);
    if (role === 'farmer') {
      const [animals, ownedConsultations, ownedReminders] = await Promise.all([
        this.repository.listByOwner('livestock', userId),
        this.repository.listByOwner('consultation', userId),
        this.repository.listByOwner('reminder', userId),
      ]);
      const consultations = await this.mapConsultations(ownedConsultations, userId, role);
      const reminders = await this.mapReminders(ownedReminders, userId);
      return selectFarmerDashboard({
        userId,
        displayName: profile.displayName,
        farmName: profile.farmer?.farmName ?? '',
        farmLocation: profile.farmer?.farmLocation ?? '',
        animals,
        consultations,
        reminders,
        now: this.now(),
      });
    }

    const [relatedConsultations, availabilityRecords, ledgerRecords] = await Promise.all([
      this.repository.listByRelated('consultation', userId, 'veterinarian'),
      this.repository.listByOwner('availability', userId),
      this.repository.listByOwner('ledgerEntry', userId),
    ]);
    const consultations = await this.mapConsultations(relatedConsultations, userId, role);
    const verificationStatus = isVerificationStatus(profile.verificationStatus)
      ? profile.verificationStatus
      : 'not_submitted';
    const availability = availabilityRecords.find((record) =>
      record.kind === 'availability' && record.payload.vetId === userId,
    );
    const entries = ledgerRecords.flatMap((record) => {
      const kind = record.payload.kind;
      const amount = record.payload.amount;
      if (record.kind !== 'ledgerEntry' || record.payload.vetId !== userId) return [];
      if (typeof kind !== 'string' || !ledgerKinds.has(kind)) {
        throw new DomainError('INVALID_STATE', 'Jenis pergerakan ledger tidak dikenali.');
      }
      if (typeof amount !== 'number') {
        throw new DomainError('VALIDATION_FAILED', 'Nilai ledger harus berupa integer rupiah.');
      }
      return [{ kind: kind as LedgerMovement['kind'], amount }];
    });
    const balances = calculateWalletBalances(entries);
    return selectVetDashboard({
      userId,
      displayName: profile.vet?.professionalName || profile.displayName,
      verificationStatus,
      acceptingNewRequests: availability?.payload.acceptingNewRequests === true,
      consultations,
      availableBalance: balances.available,
      pendingBalance: balances.pending,
      now: this.now(),
    });
  }

  async setAvailability(userId: string, acceptingNewRequests: boolean): Promise<void> {
    const profile = await this.profiles.load(userId, 'vet');
    const status = isVerificationStatus(profile.verificationStatus)
      ? profile.verificationStatus
      : 'not_submitted';
    if (acceptingNewRequests && status !== 'verified') {
      throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi sebelum menerima layanan baru.');
    }

    const profiles = await this.repository.listByOwner('vetProfile', userId);
    const vetProfile = profiles[0];
    if (!vetProfile) throw new DomainError('FORBIDDEN', 'Profil dokter untuk akun ini tidak ditemukan.');
    const records = await this.repository.listByOwner('availability', userId);
    const current = records.find((record) => record.kind === 'availability' && record.payload.vetId === userId);
    const timestamp = this.now().toISOString();
    if (current) {
      if (current.payload.acceptingNewRequests === acceptingNewRequests) return;
      await this.repository.update({
        ...current,
        payload: { ...current.payload, acceptingNewRequests },
        updatedAt: timestamp,
        version: current.version + 1,
      }, current.version);
      return;
    }

    const availabilityId = this.ids.create();
    const availability: DomainEntity = {
      id: availabilityId,
      kind: 'availability',
      ownerId: userId,
      contextId: vetProfile.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      payload: {
        vetId: userId,
        acceptingNewRequests,
        timezone: 'Asia/Jakarta',
        services: profile.vet?.services ?? [],
      },
    };
    await this.repository.create(availability, [
      { sourceId: vetProfile.id, relationship: 'availability', targetId: availabilityId },
      { sourceId: availabilityId, relationship: 'user', targetId: userId },
    ]);
  }

  async loadContext(userId: string, role: AccountRole, kind: 'consultation' | 'reminder', id: string): Promise<DashboardContextDetail> {
    if (kind === 'reminder') return this.loadReminderContext(userId, role, id);
    const consultation = await this.repository.findById('consultation', id);
    if (!consultation) throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    if (!await this.canReadConsultation(consultation, userId, role)) {
      throw new DomainError('FORBIDDEN', 'Akun ini tidak memiliki akses ke layanan tersebut.');
    }
    const item = (await this.mapConsultations([consultation], userId, role))[0];
    if (!item) throw new DomainError('FORBIDDEN', 'Data pasien pada layanan ini tidak dapat dibaca.');
    return {
      role,
      kind,
      id: item.id,
      title: item.displayCode,
      status: item.status,
      statusLabel: consultationStatusLabel(item.status),
      dateLabel: item.startsAt,
      animalName: item.animalName,
      otherPartyName: item.otherPartyName,
      description: item.complaint,
      visitAddress: item.visitAddress,
    };
  }

  private async loadReminderContext(userId: string, role: AccountRole, id: string): Promise<DashboardContextDetail> {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Pengingat ini hanya dapat dibuka oleh pemilik ternak.');
    const reminder = await this.repository.findById('reminder', id);
    if (!reminder) throw new DomainError('NOT_FOUND', 'Pengingat tidak ditemukan.');
    if (reminder.ownerId !== userId || reminder.payload.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Akun ini tidak memiliki akses ke pengingat tersebut.');
    }
    const animalId = stringValue(reminder.payload.animalId);
    const linkedAnimals = await this.repository.listRelated('reminder', id, 'animal');
    const animal = linkedAnimals.find((item) => item.kind === 'livestock' && item.id === animalId && item.ownerId === userId);
    if (animalId && !animal) throw new DomainError('FORBIDDEN', 'Ternak yang terkait dengan pengingat ini tidak dapat dibaca.');
    const dueAt = stringValue(reminder.payload.dueAt);
    const kindLabel = reminder.payload.kind === 'follow_up' ? 'Tindak lanjut' : 'Perawatan ternak';
    const careStatus = stringValue(reminder.payload.careStatus) || 'scheduled';
    return {
      role,
      kind: 'reminder',
      id,
      title: kindLabel,
      status: careStatus,
      statusLabel: careStatus === 'done' ? 'Selesai' : 'Terjadwal',
      dateLabel: dueAt || null,
      animalName: animal ? stringValue(animal.payload.name) || 'Ternak' : 'Ternak',
      otherPartyName: null,
      description: stringValue(reminder.payload.instructions) || 'Tidak ada instruksi tambahan.',
      visitAddress: null,
    };
  }

  private async mapConsultations(records: readonly DomainEntity[], userId: string, role: AccountRole): Promise<DashboardConsultationItem[]> {
    const items: DashboardConsultationItem[] = [];
    for (const record of records) {
      if (record.kind !== 'consultation') continue;
      const farmerId = stringValue(record.payload.farmerId);
      const vetId = stringValue(record.payload.vetId);
      if (role === 'farmer' && (record.ownerId !== userId || farmerId !== userId)) continue;
      if (role === 'vet' && vetId !== userId) continue;

      const animalId = stringValue(record.payload.animalId) || null;
      const relatedAnimals = await this.repository.listRelated('consultation', record.id, 'animal');
      const animal = relatedAnimals.find((item) => item.kind === 'livestock' && item.id === animalId);
      if (animalId && !animal) continue;
      if (role === 'farmer' && animal && animal.ownerId !== userId) continue;

      const otherPartyId = role === 'farmer' ? vetId : farmerId;
      const otherPartyRelationship = role === 'farmer' ? 'veterinarian' : 'farmer';
      const relatedPeople = await this.repository.listRelated('consultation', record.id, otherPartyRelationship);
      const otherParty = relatedPeople.find((item) => item.kind === 'user' && item.id === otherPartyId);
      items.push({
        id: record.id,
        displayCode: stringValue(record.payload.displayCode) || record.id,
        farmerId,
        vetId,
        animalId,
        animalName: animal ? stringValue(animal.payload.name) || 'Ternak' : 'Ternak',
        otherPartyName: otherParty ? stringValue(otherParty.payload.name) || 'Pengguna' : role === 'farmer' ? 'Dokter hewan' : 'Peternak',
        type: record.payload.type === 'chat' || record.payload.type === 'visit' ? record.payload.type : 'unknown',
        status: stringValue(record.payload.status) || 'unknown',
        startsAt: stringValue(record.payload.startsAt) || null,
        endsAt: stringValue(record.payload.endsAt) || null,
        complaint: stringValue(record.payload.complaint),
        visitAddress: stringValue(record.payload.visitAddressSnapshot) || null,
      });
    }
    return items;
  }

  private async mapReminders(records: readonly DomainEntity[], userId: string): Promise<DashboardReminderItem[]> {
    const items: DashboardReminderItem[] = [];
    for (const record of records) {
      if (record.kind !== 'reminder' || record.ownerId !== userId || record.payload.ownerId !== userId) continue;
      const animalId = stringValue(record.payload.animalId) || null;
      const linkedAnimals = await this.repository.listRelated('reminder', record.id, 'animal');
      const animal = linkedAnimals.find((item) => item.kind === 'livestock' && item.id === animalId && item.ownerId === userId);
      if (animalId && !animal) continue;
      const dueAt = stringValue(record.payload.dueAt);
      if (!dueAt || !Number.isFinite(Date.parse(dueAt))) continue;
      items.push({
        id: record.id,
        ownerId: userId,
        animalId,
        animalName: animal ? stringValue(animal.payload.name) || 'Ternak' : 'Ternak',
        kind: stringValue(record.payload.kind) || 'care',
        dueAt,
        instructions: stringValue(record.payload.instructions),
        careStatus: stringValue(record.payload.careStatus) || 'scheduled',
        deliveryStatus: stringValue(record.payload.deliveryStatus) || 'pending',
      });
    }
    return items;
  }

  private async canReadConsultation(consultation: DomainEntity, userId: string, role: AccountRole): Promise<boolean> {
    if (consultation.kind !== 'consultation') return false;
    if (role === 'farmer') return consultation.ownerId === userId && consultation.payload.farmerId === userId;
    if (consultation.payload.vetId !== userId) return false;
    const assigned = await this.repository.listByRelated('consultation', userId, 'veterinarian');
    return assigned.some((item) => item.id === consultation.id);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function consultationStatusLabel(status: string): string {
  switch (status) {
    case 'requested': return 'Menunggu dokter';
    case 'awaiting_payment': return 'Menunggu pembayaran';
    case 'scheduled': return 'Terjadwal';
    case 'in_progress': return 'Berlangsung';
    case 'completed': return 'Selesai';
    case 'rejected': return 'Ditolak';
    case 'cancelled': return 'Dibatalkan';
    default: return status;
  }
}
