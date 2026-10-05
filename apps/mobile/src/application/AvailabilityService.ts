import type { BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { AttachmentMedia } from './ports/ProfileRepository';
import type { IdFactory } from './ports/AuthRepository';
import type { DomainEntity, EntityKind } from '../domain/entities';
import type { DirectoryServiceType } from '../domain/directory';
import { DomainError } from '../domain/errors';
import { localDisplay, overlaps, validateAvailability, type AvailabilityInput, type CalendarEntry } from '../domain/availability';
import { ProfileService } from './ProfileService';
import { ConsultationService } from './ConsultationService';
export type AvailabilitySnapshot = { token: string; input: AvailabilityInput; supported: DirectoryServiceType[]; verified: boolean; draft: DomainEntity | null };

export class AvailabilityService {
  constructor(private readonly storage: BookingRepository, private readonly media: AttachmentMedia, private readonly ids: IdFactory, private readonly now: () => Date = () => new Date()) {}
  private profile(unit: BookingUnit, userId: string) { return new ProfileService(unit.profiles, this.media, this.ids, this.now).load(userId, 'vet'); }
  async load(userId: string): Promise<AvailabilitySnapshot> { return this.snapshot(this.storage.read, userId); }
  private async records(unit: BookingUnit, userId: string) {
    const [profile, availability, rates, blocks, drafts] = await Promise.all([this.profile(unit, userId), unit.repository.listByOwner('availability', userId), unit.repository.listByOwner('serviceRate', userId), unit.repository.listByOwner('blockedTime', userId), unit.repository.listByOwner('availabilityDraft', userId)]);
    if (availability.some((item) => item.payload.vetId !== userId) || rates.some((item) => item.payload.vetId !== userId)) throw new DomainError('FORBIDDEN', 'Pengaturan tidak terkait dengan akun dokter ini.');
    availability.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version);
    return { profile, current: availability[0], rates, blocks: blocks.filter((item) => item.payload.status !== 'cancelled'), drafts };
  }
  private async snapshot(unit: BookingUnit, userId: string): Promise<AvailabilitySnapshot> {
    const data = await this.records(unit, userId);
    const payload = data.current?.payload ?? {};
    const supported = data.profile.vet?.services ?? [];
    const timezone = typeof payload.timezone === 'string' ? payload.timezone : 'Asia/Jakarta';
    const rate = (type: string) => latestRate(data.rates, type, this.now())?.payload.amount ?? 0;
    const token = JSON.stringify([data.current?.id ?? null, data.current?.version ?? 0, supported, data.profile.verificationStatus, data.rates.map((item) => [item.id, item.version]).sort(), data.blocks.map((item) => [item.id, item.version]).sort()]);
    return {
      token, supported, verified: data.profile.verificationStatus === 'verified', draft: data.drafts.find((item) => item.payload.status === 'draft') ?? null,
      input: { accepting: payload.acceptingNewRequests === true, timezone, services: Array.isArray(payload.services) ? payload.services.filter((value): value is DirectoryServiceType => supported.includes(value as DirectoryServiceType)) : [], rules: Array.isArray(payload.weekdayRules) ? payload.weekdayRules as AvailabilityInput['rules'] : [], chatDuration: String(payload.chatDurationMinutes ?? 30), visitDuration: String(payload.visitDurationMinutes ?? 60), chatFee: String(rate('chat')), visitFee: String(rate('visit')), blocks: data.blocks.sort((a, b) => String(a.payload.startsAt).localeCompare(String(b.payload.startsAt))).map((item) => ({ id: item.id, version: item.version, start: localDisplay(String(item.payload.startsAt), timezone), end: localDisplay(String(item.payload.endsAt), timezone), reason: String(item.payload.reason ?? '') })) },
    };
  }
  async saveDraft(userId: string, token: string, input: AvailabilityInput, draft: DomainEntity | null): Promise<DomainEntity> {
    if (JSON.stringify(input).length > 30_000) throw new DomainError('VALIDATION_FAILED', 'Pengaturan terlalu panjang untuk disimpan.');
    return this.storage.transaction(async (unit) => {
      const snapshot = await this.snapshot(unit, userId);
      if (snapshot.token !== token) throw new DomainError('VERSION_CONFLICT', 'Pengaturan berubah. Muat ulang sebelum menyimpan draft.');
      if (snapshot.draft && (snapshot.draft.id !== draft?.id || snapshot.draft.version !== draft.version)) throw new DomainError('VERSION_CONFLICT', 'Draft berubah. Buka kembali pengaturan.');
      if (!snapshot.draft && draft) throw new DomainError('VERSION_CONFLICT', 'Draft sudah tidak aktif.');
      const next = snapshot.draft ? this.update(snapshot.draft, { input, token }) : this.entity('availabilityDraft', userId, { status: 'draft', input, token });
      if (snapshot.draft) await unit.repository.update(next, snapshot.draft.version); else await unit.repository.create(next);
      return next;
    });
  }
  async discardDraft(userId: string, draft: DomainEntity | null) {
    await this.storage.transaction(async (unit) => {
      await this.profile(unit, userId);
      if (!draft) return;
      const current = await unit.repository.findById('availabilityDraft', draft.id);
      if (!current || current.ownerId !== userId) throw new DomainError('FORBIDDEN', 'Draft bukan milik akun ini.');
      if (current.version !== draft.version) throw new DomainError('VERSION_CONFLICT', 'Draft berubah. Muat ulang.');
      await unit.repository.update(this.update(current, { status: 'discarded' }), current.version);
    });
  }
  async save(userId: string, token: string, input: AvailabilityInput): Promise<AvailabilitySnapshot> {
    return this.storage.transaction(async (unit) => {
      const snapshot = await this.snapshot(unit, userId);
      const normalized = validateAvailability(input, snapshot.supported);
      if (normalized.acceptingNewRequests && !snapshot.verified) throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi untuk menerima permintaan baru.');
      if (snapshot.token !== token) throw new DomainError('VERSION_CONFLICT', 'Pengaturan sudah berubah. Muat pengaturan terbaru sebelum menyimpan.');
      const data = await this.records(unit, userId);
      const commitments = await this.commitments(unit, userId);
      for (const block of normalized.blocks) {
        const current = block.id ? data.blocks.find((item) => item.id === block.id && item.version === block.version) : null;
        if (block.id && !current) throw new DomainError('FORBIDDEN', 'Blok waktu bukan milik pengaturan ini.');
        const unchanged = current && current.payload.startsAt === block.startsAt && current.payload.endsAt === block.endsAt && current.payload.reason === block.reason;
        if (unchanged) continue;
        if (Date.parse(block.startsAt) <= this.now().getTime()) throw new DomainError('VALIDATION_FAILED', 'Blok waktu baru harus dimulai pada waktu mendatang.');
        if (commitments.some((item) => overlaps(block, { startsAt: String(item.payload.startsAt), endsAt: String(item.payload.endsAt) }))) throw new DomainError('INVALID_STATE', 'Blok waktu bertabrakan dengan booking, janji atau tindak lanjut. Janji tetap dipertahankan.');
      }
      const { chatFee, visitFee, blocks, ...configuration } = normalized;
      const currentPayload = data.current?.payload;
      const sameConfiguration = currentPayload && Object.entries(configuration).every(([key, value]) => key === 'services' ? JSON.stringify(value) === JSON.stringify([...(currentPayload.services as string[] ?? [])].sort()) : key === 'weekdayRules' ? JSON.stringify(value) === JSON.stringify([...(currentPayload.weekdayRules as AvailabilityInput['rules'] ?? [])].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))) : JSON.stringify(value) === JSON.stringify(currentPayload[key]));
      const changedRates = snapshot.supported.filter((type) => latestRate(data.rates, type, this.now())?.payload.amount !== (type === 'chat' ? chatFee : visitFee));
      const changedBlocks = blocks.some((block) => !block.id || !data.blocks.some((item) => item.id === block.id && item.payload.startsAt === block.startsAt && item.payload.endsAt === block.endsAt && item.payload.reason === block.reason)) || data.blocks.some((item) => !blocks.some((block) => block.id === item.id));
      if (!sameConfiguration || changedRates.length || changedBlocks) {
        const availability = data.current ? this.update(data.current, configuration) : this.entity('availability', userId, { vetId: userId, ...configuration });
        if (data.current) await unit.repository.update(availability, data.current.version);
        else {
          const profiles = await unit.repository.listByOwner('vetProfile', userId);
          if (!profiles[0]) throw new DomainError('FORBIDDEN', 'Profil dokter tidak tersedia.');
          await unit.repository.create(availability, [{ sourceId: profiles[0].id, targetId: availability.id, relationship: 'availability' }]);
        }
        for (const type of changedRates) {
          const rate = this.entity('serviceRate', userId, { vetId: userId, serviceType: type, amount: type === 'chat' ? chatFee : visitFee, currency: 'IDR', effectiveAt: this.now().toISOString(), configurationVersion: data.current?.version ?? 1 });
          await unit.repository.create(rate);
        }
        for (const block of blocks) {
          const current = data.blocks.find((item) => item.id === block.id);
          const payload = { vetId: userId, startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason, status: 'active' };
          if (!current) await unit.repository.create(this.entity('blockedTime', userId, payload));
          else if (current.payload.startsAt !== block.startsAt || current.payload.endsAt !== block.endsAt || current.payload.reason !== block.reason) await unit.repository.update(this.update(current, payload), current.version);
        }
        for (const block of data.blocks.filter((item) => !blocks.some((candidate) => candidate.id === item.id))) await unit.repository.update(this.update(block, { status: 'cancelled' }), block.version);
      }
      if (snapshot.draft) await unit.repository.update(this.update(snapshot.draft, { status: 'applied' }), snapshot.draft.version);
      return this.snapshot(unit, userId);
    });
  }
  private async commitments(unit: BookingUnit, userId: string) {
    const [consultations, followUps] = await Promise.all([unit.repository.listByRelated('consultation', userId, 'veterinarian'), unit.repository.listByKind('followUp')]);
    return [...consultations.filter((item) => item.payload.vetId === userId && ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress'].includes(String(item.payload.status))), ...followUps.filter((item) => item.payload.vetId === userId && item.payload.status === 'scheduled')];
  }
  async calendar(userId: string): Promise<{ timezone: string; entries: CalendarEntry[] }> {
    const snapshot = await this.load(userId);
    const [consultations, followUps, blocks] = await Promise.all([new ConsultationService(this.storage, this.media, this.ids, this.now).list(userId, 'vet'), this.storage.read.repository.listByKind('followUp'), this.storage.read.repository.listByOwner('blockedTime', userId)]);
    const entries: CalendarEntry[] = consultations.filter((item) => ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(String(item.record.payload.status)) || (item.record.payload.status === 'reschedule_pending' && item.record.payload.previousStatus === 'scheduled')).map((item) => ({ id: item.record.id, kind: 'consultation', title: `${item.record.payload.type === 'visit' ? 'Kunjungan' : 'Chat'} · ${item.animalName}`, description: `${item.otherPartyName} · ${String(item.record.payload.displayCode)}`, startsAt: String(item.record.payload.startsAt), endsAt: String(item.record.payload.endsAt), status: String(item.record.payload.status), consultationId: item.record.id, animalId: String(item.record.payload.animalId) }));
    for (const followUp of followUps) {
      const consultation = consultations.find((item) => item.record.id === followUp.payload.consultationId);
      if (!consultation || followUp.payload.vetId !== userId || followUp.payload.status !== 'scheduled' || followUp.ownerId !== consultation.record.ownerId || followUp.payload.animalId !== consultation.record.payload.animalId) continue;
      const links = await this.storage.read.repository.listRelated('followUp', followUp.id, 'consultation');
      if (!links.some((item) => item.id === consultation.record.id)) continue;
      entries.push({ id: followUp.id, kind: 'followUp', title: `Pemeriksaan ulang · ${consultation.animalName}`, description: consultation.otherPartyName, startsAt: String(followUp.payload.startsAt), endsAt: String(followUp.payload.endsAt), status: 'scheduled', consultationId: consultation.record.id, animalId: String(followUp.payload.animalId) });
    }
    for (const block of blocks.filter((item) => item.payload.status !== 'cancelled')) entries.push({ id: block.id, kind: 'blockedTime', title: 'Waktu diblokir', description: String(block.payload.reason), status: 'active', startsAt: String(block.payload.startsAt), endsAt: String(block.payload.endsAt) });
    return { timezone: snapshot.input.timezone, entries: entries.filter((entry) => Number.isFinite(Date.parse(entry.startsAt)) && Date.parse(entry.endsAt) > Date.parse(entry.startsAt)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
  }
  private update(record: DomainEntity, changes: Record<string, unknown>): DomainEntity { return { ...record, version: record.version + 1, updatedAt: this.now().toISOString(), payload: { ...record.payload, ...changes } }; }
  private entity(kind: EntityKind, ownerId: string, payload: Record<string, unknown>): DomainEntity { const timestamp = this.now().toISOString(); return { id: this.ids.create(), kind, ownerId, contextId: null, payload, version: 1, createdAt: timestamp, updatedAt: timestamp }; }
}
function latestRate(rates: DomainEntity[], type: string, now: Date) { return rates.filter((item) => item.payload.serviceType === type && Date.parse(String(item.payload.effectiveAt)) <= now.getTime()).sort((a, b) => String(b.payload.effectiveAt).localeCompare(String(a.payload.effectiveAt)) || Number(b.payload.configurationVersion ?? 0) - Number(a.payload.configurationVersion ?? 0) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0]; }
