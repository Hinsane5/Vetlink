import type { BookingMedia, BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { IdFactory } from './ports/AuthRepository';
import { LivestockService } from './LivestockService';
import { ProfileService } from './ProfileService';
import { VetDirectoryService } from './VetDirectoryService';
import type { DomainEntity, EntityKind } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { emptyBookingInput, validateBookingInput, type BookingAttachment, type BookingDraft, type BookingInput, type BookingReview } from '../domain/booking';

export class BookingService {
  constructor(private readonly storage: BookingRepository, private readonly media: BookingMedia, private readonly ids: IdFactory, private readonly now: () => Date = () => new Date()) {}

  private services(unit: BookingUnit) {
    const profiles = new ProfileService(unit.profiles, this.media, this.ids, this.now);
    return { profiles, livestock: new LivestockService(unit.repository, unit.profiles, this.media, this.ids, this.now), directory: new VetDirectoryService(unit.repository, profiles, this.now) };
  }

  async open(userId: string, vetId: string) {
    const { livestock, profiles, directory } = this.services(this.storage.read);
    const [vet, animals, profile] = await Promise.all([directory.get(vetId), livestock.list(userId), profiles.load(userId, 'farmer')]);
    const draft = await this.storage.transaction(async (unit) => {
      const existing = (await unit.repository.listByOwner('bookingDraft', userId)).find((item) => item.payload.vetId === vetId && item.payload.status === 'draft');
      if (existing) return toDraft(existing);
      const address = profile.farmer;
      const record = this.entity('bookingDraft', this.ids.create(), userId, { vetId, status: 'draft', input: { ...emptyBookingInput, service: vet.services[0] ?? 'chat', visitAddress: address?.address ? [address.address, address.city, address.province, address.postalCode].filter(Boolean).join(', ') : '' } }, vetId);
      await unit.repository.create(record, [{ sourceId: record.id, targetId: vetId, relationship: 'veterinarian' }]);
      return toDraft(record);
    });
    return { vet, animals: animals.filter((animal) => vet.species.includes(animal.species)), draft, attachments: await this.attachments(userId, draft.id) };
  }

  async save(userId: string, draft: BookingDraft, input: BookingInput): Promise<BookingDraft> {
    const removed: string[] = [];
    const saved = await this.storage.transaction(async (unit) => {
      const record = await this.ownedDraft(unit, userId, draft.id);
      this.assertEditable(record, draft.version);
      if (input.complaint.length > 2000 || input.visitAddress.length > 1000 || !['chat', 'visit'].includes(input.service)) throw new DomainError('VALIDATION_FAILED', 'Periksa panjang keluhan, alamat dan pilihan layanan.');
      await this.validateAttachments(unit, record, input.attachmentIds);
      for (const id of toDraft(record).input.attachmentIds.filter((id) => !input.attachmentIds.includes(id))) {
        const attachment = await unit.repository.findById('attachment', id);
        if (!attachment || attachment.ownerId !== userId || attachment.contextId !== record.id) throw new DomainError('FORBIDDEN', 'Lampiran tidak dapat dihapus.');
        await unit.repository.update({ ...attachment, version: attachment.version + 1, updatedAt: this.now().toISOString(), payload: { ...attachment.payload, uploadStatus: 'removed' } }, attachment.version);
        removed.push(String(attachment.payload.localUri));
      }
      const updated = { ...record, updatedAt: this.now().toISOString(), version: record.version + 1, payload: { ...record.payload, input: { ...input, attachmentIds: [...input.attachmentIds] } } };
      await unit.repository.update(updated, record.version);
      return toDraft(updated);
    });
    for (const uri of removed) await this.removeFile(uri);
    return saved;
  }

  async attachments(userId: string, draftId: string): Promise<BookingAttachment[]> {
    const record = await this.ownedDraft(this.storage.read, userId, draftId);
    const ids = toDraft(record).input.attachmentIds;
    return Promise.all(ids.map(async (id) => {
      const attachment = await this.storage.read.repository.findById('attachment', id);
      if (!attachment || attachment.ownerId !== userId || attachment.contextId !== draftId) throw new DomainError('FORBIDDEN', 'Lampiran tidak dapat diakses.');
      return { id, filename: String(attachment.payload.filename), kind: attachment.payload.kind as 'image' | 'video', localUri: String(attachment.payload.localUri), byteSize: Number(attachment.payload.byteSize) };
    }));
  }

  async pickMedia(userId: string, draft: BookingDraft, input: BookingInput): Promise<BookingDraft | null> {
    if (input.complaint.length > 2000 || input.visitAddress.length > 1000 || !['chat', 'visit'].includes(input.service)) throw new DomainError('VALIDATION_FAILED', 'Periksa panjang keluhan, alamat dan pilihan layanan.');
    const assets = await this.media.pickBookingMedia();
    if (!assets.length) return null;
    const created: DomainEntity[] = [];
    const removed: string[] = [];
    try {
      for (const asset of assets) {
        if (!['image', 'video'].includes(asset.kind) || !asset.mimeType.startsWith(`${asset.kind}/`)) throw new DomainError('VALIDATION_FAILED', 'Pilih foto atau video yang valid.');
        const id = this.ids.create();
        const stored = await this.media.store(asset, id);
        created.push(this.entity('attachment', id, userId, { ...stored, kind: asset.kind, accessContext: draft.id, uploadStatus: 'local' }, draft.id));
      }
      const saved = await this.storage.transaction(async (unit) => {
        const record = await this.ownedDraft(unit, userId, draft.id);
        this.assertEditable(record, draft.version);
        await this.validateAttachments(unit, record, input.attachmentIds);
        for (const id of toDraft(record).input.attachmentIds.filter((id) => !input.attachmentIds.includes(id))) {
          const attachment = await unit.repository.findById('attachment', id);
          if (!attachment || attachment.ownerId !== userId || attachment.contextId !== record.id) throw new DomainError('FORBIDDEN', 'Lampiran tidak dapat dihapus.');
          await unit.repository.update({ ...attachment, version: attachment.version + 1, updatedAt: this.now().toISOString(), payload: { ...attachment.payload, uploadStatus: 'removed' } }, attachment.version);
          removed.push(String(attachment.payload.localUri));
        }
        for (const entity of created) await unit.repository.create(entity);
        const next = { ...record, updatedAt: this.now().toISOString(), version: record.version + 1, payload: { ...record.payload, input: { ...input, attachmentIds: [...input.attachmentIds, ...created.map((item) => item.id)] } } };
        await unit.repository.update(next, record.version);
        return toDraft(next);
      });
      for (const uri of removed) await this.removeFile(uri);
      return saved;
    } catch (error) {
      for (const attachment of created) await this.removeFile(String(attachment.payload.localUri));
      throw error;
    }
  }

  async discard(userId: string, draft: BookingDraft): Promise<void> {
    await this.storage.transaction(async (unit) => {
      const record = await this.ownedDraft(unit, userId, draft.id);
      this.assertEditable(record, draft.version);
      await unit.repository.update({ ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, status: 'discarded', input: { ...emptyBookingInput } } }, record.version);
    });
    const media = (await this.storage.read.repository.listByOwner('attachment', userId)).filter((item) => item.contextId === draft.id);
    for (const attachment of media) await this.removeFile(String(attachment.payload.localUri));
  }

  async review(userId: string, draft: BookingDraft): Promise<BookingReview> {
    return this.storage.transaction(async (unit) => {
      const record = await this.ownedDraft(unit, userId, draft.id);
      this.assertEditable(record, draft.version);
      return this.validate(unit, record);
    });
  }

  async submit(userId: string, review: BookingReview): Promise<string> {
    return this.storage.transaction(async (unit) => {
      const record = await this.ownedDraft(unit, userId, review.draftId);
      if (record.payload.status === 'submitted' && typeof record.payload.consultationId === 'string') return record.payload.consultationId;
      this.assertEditable(record, review.version);
      const current = await this.validate(unit, record);
      if (current.total !== review.total || JSON.stringify(current.input) !== JSON.stringify(review.input)) throw new DomainError('VERSION_CONFLICT', 'Tarif atau detail booking berubah. Tinjau biaya kembali.');
      const id = this.ids.create();
      const quoteId = this.ids.create();
      const consultation = this.entity('consultation', id, userId, {
        operationKey: `booking:${record.id}`, displayCode: `VL-${current.input.service === 'visit' ? 'V' : 'C'}-${id.toUpperCase()}`,
        farmerId: userId, vetId: record.payload.vetId, animalId: current.input.animalId, type: current.input.service,
        status: 'awaiting_payment', complaint: current.input.complaint, attachmentIds: current.input.attachmentIds,
        startsAt: current.input.startsAt, endsAt: current.input.endsAt, feeSnapshot: current.total,
        // Local fixture policy only; production commission has not been chosen.
        commissionSnapshot: Math.floor(current.total / 10), quoteId, paymentId: null,
        ...(current.input.service === 'visit' ? { visitAddressSnapshot: current.input.visitAddress } : {}),
      });
      await unit.repository.create(consultation, [
        { sourceId: id, targetId: userId, relationship: 'farmer' },
        { sourceId: id, targetId: String(record.payload.vetId), relationship: 'veterinarian' },
        { sourceId: id, targetId: current.input.animalId, relationship: 'animal' },
        ...current.input.attachmentIds.map((targetId) => ({ sourceId: id, targetId, relationship: 'attachment' })),
      ]);
      await unit.repository.create(this.entity('quote', quoteId, userId, { context: 'consultation', consultationId: id, lines: [{ label: current.input.service === 'chat' ? 'Konsultasi chat' : 'Kunjungan dokter', amount: current.total }], shippingAmount: 0, totalAmount: current.total }, id), [{ sourceId: quoteId, targetId: id, relationship: 'consultation' }]);
      await unit.repository.update({ ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, status: 'submitted', consultationId: id } }, record.version);
      return id;
    });
  }

  private async validate(unit: BookingUnit, record: DomainEntity): Promise<BookingReview> {
    const input = validateBookingInput(toDraft(record).input);
    const { livestock, directory } = this.services(unit);
    const vet = await directory.get(String(record.payload.vetId));
    if (!vet.verified) throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi dan belum dapat menerima layanan.');
    if (!vet.accepting || !vet.services.includes(input.service)) throw new DomainError('INVALID_STATE', 'Dokter belum tersedia untuk layanan ini.');
    const animal = await livestock.get(record.ownerId!, input.animalId);
    if (!vet.species.includes(animal.species)) throw new DomainError('VALIDATION_FAILED', 'Jenis ternak belum dilayani dokter ini.');
    const schedule = await directory.slots(vet.id, input.service);
    if (!schedule.slots.some((slot) => slot.startsAt === input.startsAt && slot.endsAt === input.endsAt)) throw new DomainError('INVALID_STATE', 'Waktu sudah tidak tersedia. Pilih jadwal lain.');
    await this.validateAttachments(unit, record, input.attachmentIds);
    const rate = vet.rates.find((item) => item.service === input.service);
    if (!rate) throw new DomainError('INVALID_STATE', 'Tarif layanan belum tersedia.');
    return { draftId: record.id, version: record.version, total: rate.amount, vetName: vet.name, animalName: animal.name, timezone: schedule.timezone, input };
  }

  private async validateAttachments(unit: BookingUnit, draft: DomainEntity, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new DomainError('VALIDATION_FAILED', 'Lampiran tidak boleh berulang.');
    for (const id of ids) {
      const attachment = await unit.repository.findById('attachment', id);
      if (!attachment || attachment.ownerId !== draft.ownerId || attachment.contextId !== draft.id || !['image', 'video'].includes(String(attachment.payload.kind)) || attachment.payload.uploadStatus !== 'local') throw new DomainError('FORBIDDEN', 'Lampiran bukan milik booking ini.');
    }
  }
  private async ownedDraft(unit: BookingUnit, userId: string, id: string): Promise<DomainEntity> {
    const draft = await unit.repository.findById('bookingDraft', id);
    if (!draft) throw new DomainError('NOT_FOUND', 'Draft booking tidak ditemukan.');
    if (draft.ownerId !== userId || draft.payload.status === 'discarded') throw new DomainError('FORBIDDEN', 'Draft booking tidak dapat diakses.');
    return draft;
  }
  private assertEditable(record: DomainEntity, version: number) {
    if (record.payload.status !== 'draft') throw new DomainError('INVALID_STATE', 'Draft ini sudah dikirim.');
    if (record.version !== version) throw new DomainError('VERSION_CONFLICT', 'Draft sudah berubah. Buka kembali booking sebelum mengedit.');
  }
  private entity(kind: EntityKind, id: string, ownerId: string, payload: Record<string, unknown>, contextId: string | null = null): DomainEntity {
    const timestamp = this.now().toISOString();
    return { kind, id, ownerId, contextId, payload, createdAt: timestamp, updatedAt: timestamp, version: 1 };
  }
  private async removeFile(uri: string) {
    try { await this.media.remove(uri); } catch { console.warn('[VetLink][booking] Berkas lokal belum dapat dibersihkan.'); }
  }
}
function toDraft(record: DomainEntity): BookingDraft {
  return { id: record.id, vetId: String(record.payload.vetId), version: record.version, updatedAt: record.updatedAt, input: record.payload.input as BookingInput };
}
