import type { DomainRepository } from '../application/ports/DomainRepository';
import type { AttachmentMedia, ProfileCreate, ProfileRepository, ProfileUpdate } from '../application/ports/ProfileRepository';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import {
  selectLivestock,
  validateLivestockInput,
  type LivestockFilters,
  type LivestockInput,
  type LivestockPhoto,
  type LivestockSnapshot,
} from '../domain/livestock';
import { livestockSpecies, type AttachmentSelection, type SelectedAsset } from '../domain/profiles';
import type { IdFactory } from './ports/AuthRepository';

export class LivestockService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly profiles: ProfileRepository,
    private readonly media: AttachmentMedia,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  pickPhoto(): Promise<SelectedAsset | null> {
    return this.media.pickPhoto();
  }

  async list(userId: string, filters: LivestockFilters = {}): Promise<LivestockSnapshot[]> {
    const { farm } = await this.loadFarmerContext(userId);
    const records = await this.repository.listByRelated('livestock', farm.id, 'farm');
    const owned: LivestockSnapshot[] = [];
    for (const record of records) {
      if (record.kind !== 'livestock' || record.ownerId !== userId) continue;
      if (!(await this.hasFarmerAndFarmRelations(record.id, userId, farm.id))) continue;
      owned.push(await this.toSnapshot(record, farm.id));
    }
    return selectLivestock(owned, filters);
  }

  async get(userId: string, livestockId: string): Promise<LivestockSnapshot> {
    const { farm } = await this.loadFarmerContext(userId);
    const animal = await this.repository.findById('livestock', livestockId);
    if (!animal) throw new DomainError('NOT_FOUND', 'Data ternak tidak ditemukan.');
    await this.assertOwnedByFarm(animal, userId, farm.id);
    return this.toSnapshot(animal, farm.id);
  }

  async create(userId: string, input: LivestockInput, photo?: AttachmentSelection): Promise<LivestockSnapshot> {
    const { farm, supportedSpecies } = await this.loadFarmerContext(userId);
    const values = this.validateForFarm(input, supportedSpecies);
    await this.assertUniqueCode(farm.id, values.displayCode);
    const id = this.ids.create();
    const timestamp = this.now().toISOString();
    const materialized = await this.materializePhoto(userId, id, photo);
    const animal = makeEntity('livestock', id, userId, {
      farmerId: userId,
      farmId: farm.id,
      ...values,
      photoAttachmentIds: materialized.attachment ? [materialized.attachment.id] : [],
    }, timestamp, farm.id);
    const changes = {
      creates: [
        ...(materialized.attachment ? [{ entity: materialized.attachment }] : []),
        { entity: animal, relations: livestockRelations(animal.id, userId, farm.id, materialized.attachment ? [materialized.attachment.id] : []) },
      ],
    };
    try {
      await this.profiles.commit(changes);
    } catch (error) {
      await this.removeStoredPhoto(materialized.storedUri);
      throw error;
    }
    return snapshot(animal, farm.id, materialized.attachment ? photoSummary(materialized.attachment) : null);
  }

  async update(
    userId: string,
    livestockId: string,
    input: LivestockInput,
    photo?: AttachmentSelection | null,
  ): Promise<LivestockSnapshot> {
    const { farm, supportedSpecies } = await this.loadFarmerContext(userId);
    const animal = await this.repository.findById('livestock', livestockId);
    if (!animal) throw new DomainError('NOT_FOUND', 'Data ternak tidak ditemukan.');
    const previous = await this.assertOwnedByFarm(animal, userId, farm.id);
    const values = this.validateForFarm(input, supportedSpecies);
    await this.assertUniqueCode(farm.id, values.displayCode, animal.id);

    let selectedIds = previous.photos.map((item) => item.id);
    let createdAttachment: DomainEntity | null = null;
    let storedUri: string | null = null;
    let returnedPhoto: LivestockPhoto | null = previous.photos[0] ? photoSummary(previous.photos[0]) : null;
    if (photo === null) {
      selectedIds = [];
      returnedPhoto = null;
    } else if (photo?.type === 'existing') {
      const selected = previous.photos.find((item) => item.id === photo.attachmentId);
      if (!selected) throw new DomainError('FORBIDDEN', 'Foto tidak ditemukan pada ternak ini.');
      selectedIds = [selected.id];
      returnedPhoto = photoSummary(selected);
    } else if (photo?.type === 'new') {
      const prepared = await this.materializePhoto(userId, animal.id, photo);
      createdAttachment = prepared.attachment;
      storedUri = prepared.storedUri;
      selectedIds = createdAttachment ? [createdAttachment.id] : [];
      returnedPhoto = createdAttachment ? photoSummary(createdAttachment) : null;
    }

    const timestamp = this.now().toISOString();
    const updated = reviseEntity(animal, {
      farmerId: userId,
      farmId: farm.id,
      ...values,
      photoAttachmentIds: selectedIds,
    }, timestamp, farm.id);
    const change: ProfileUpdate = {
      entity: updated,
      expectedVersion: animal.version,
      relations: livestockRelations(animal.id, userId, farm.id, selectedIds),
    };
    const creates: ProfileCreate[] = createdAttachment ? [{ entity: createdAttachment }] : [];
    try {
      await this.profiles.commit({ creates, updates: [change] });
    } catch (error) {
      await this.removeStoredPhoto(storedUri);
      throw error;
    }
    return snapshot(updated, farm.id, returnedPhoto);
  }

  private async loadFarmerContext(userId: string): Promise<{ farm: DomainEntity; supportedSpecies: readonly string[] }> {
    const profile = await this.profiles.loadProfile(userId, 'farmer');
    if (profile.user.id !== userId || profile.profile.kind !== 'farmerProfile' || profile.profile.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Fitur ternak hanya tersedia untuk profil Peternak milik akun ini.');
    }
    const farm = profile.farm;
    if (!farm || farm.kind !== 'farm' || farm.ownerId !== userId) {
      throw new DomainError('INVALID_STATE', 'Lengkapi profil peternakan sebelum menambahkan ternak.');
    }
    const supportedSpecies = Array.isArray(farm.payload.species)
      ? farm.payload.species.filter((value): value is string => typeof value === 'string' && livestockSpecies.includes(value as (typeof livestockSpecies)[number]) )
      : [];
    if (!supportedSpecies.length) throw new DomainError('INVALID_STATE', 'Pilih jenis ternak pada profil peternakan terlebih dahulu.');
    return { farm, supportedSpecies };
  }

  private validateForFarm(input: LivestockInput, supportedSpecies: readonly string[]): LivestockInput {
    const values = validateLivestockInput(input);
    if (!supportedSpecies.includes(values.species)) {
      throw new DomainError('VALIDATION_FAILED', 'Jenis ternak belum tercantum pada profil peternakan.');
    }
    return values;
  }

  private async assertUniqueCode(farmId: string, displayCode: string, excludeId?: string): Promise<void> {
    const records = await this.repository.listByRelated('livestock', farmId, 'farm');
    const normalized = displayCode.toLocaleUpperCase('id-ID');
    if (records.some((item) => item.id !== excludeId && item.kind === 'livestock' && String(item.payload.displayCode ?? '').trim().toLocaleUpperCase('id-ID') === normalized)) {
      throw new DomainError('VALIDATION_FAILED', 'ID ternak sudah digunakan di peternakan ini.');
    }
  }

  private async assertOwnedByFarm(animal: DomainEntity, userId: string, farmId: string): Promise<{ photos: DomainEntity[] }> {
    if (animal.kind !== 'livestock' || animal.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Ternak ini bukan milik akun Peternak yang sedang aktif.');
    }
    if (!(await this.hasFarmerAndFarmRelations(animal.id, userId, farmId))) {
      throw new DomainError('FORBIDDEN', 'Ternak ini tidak terhubung ke peternakan milik akun tersebut.');
    }
    const linkedPhotos = await this.repository.listRelated('livestock', animal.id, 'photo');
    return { photos: linkedPhotos.filter((item) => isLivestockPhoto(item, userId, animal.id)) };
  }

  private async hasFarmerAndFarmRelations(animalId: string, userId: string, farmId: string): Promise<boolean> {
    const [farmLinks, farmerLinks] = await Promise.all([
      this.repository.listRelated('livestock', animalId, 'farm'),
      this.repository.listRelated('livestock', animalId, 'farmer'),
    ]);
    return farmLinks.some((item) => item.id === farmId && item.ownerId === userId)
      && farmerLinks.some((item) => item.id === userId && item.kind === 'user');
  }

  private async toSnapshot(animal: DomainEntity, farmId: string): Promise<LivestockSnapshot> {
    const linked = await this.repository.listRelated('livestock', animal.id, 'photo');
    const photo = linked.find((item) => isLivestockPhoto(item, animal.ownerId ?? '', animal.id));
    return snapshot(animal, farmId, photo ? photoSummary(photo) : null);
  }

  private async materializePhoto(
    userId: string,
    livestockId: string,
    selection?: AttachmentSelection,
  ): Promise<{ attachment: DomainEntity | null; storedUri: string | null }> {
    if (!selection) return { attachment: null, storedUri: null };
    if (selection.type === 'existing') {
      throw new DomainError('FORBIDDEN', 'Foto lama tidak dapat dipasang ke ternak lain.');
    }
    const asset = selection.asset;
    if (asset.kind !== 'image' || !asset.mimeType.toLowerCase().startsWith('image/')) {
      throw new DomainError('VALIDATION_FAILED', 'Pilih file foto untuk ternak.');
    }
    const id = this.ids.create();
    const stored = await this.media.store(asset, id);
    const timestamp = this.now().toISOString();
    return {
      attachment: makeEntity('attachment', id, userId, {
        ownerId: userId,
        kind: 'image',
        mimeType: stored.mimeType,
        filename: stored.filename,
        byteSize: stored.byteSize,
        localUri: stored.localUri,
        accessContext: 'livestock',
        uploadStatus: 'local',
      }, timestamp, livestockId),
      storedUri: stored.localUri,
    };
  }

  private async removeStoredPhoto(uri: string | null): Promise<void> {
    if (uri) await Promise.allSettled([this.media.remove(uri)]);
  }
}

function livestockRelations(animalId: string, userId: string, farmId: string, photoIds: readonly string[]): EntityRelation[] {
  return [
    { sourceId: animalId, relationship: 'farmer', targetId: userId },
    { sourceId: animalId, relationship: 'farm', targetId: farmId },
    ...photoIds.map((targetId) => ({ sourceId: animalId, relationship: 'photo', targetId })),
  ];
}

function makeEntity(kind: DomainEntity['kind'], id: string, ownerId: string, payload: Record<string, unknown>, timestamp: string, contextId: string): DomainEntity {
  return { id, kind, ownerId, contextId, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
}

function reviseEntity(current: DomainEntity, payload: Record<string, unknown>, timestamp: string, contextId: string): DomainEntity {
  return { ...current, contextId, payload, updatedAt: timestamp, version: current.version + 1 };
}

function snapshot(animal: DomainEntity, farmId: string, photo: LivestockPhoto | null): LivestockSnapshot {
  const payload = animal.payload;
  return {
    id: animal.id,
    farmId,
    displayCode: String(payload.displayCode ?? ''),
    name: String(payload.name ?? ''),
    species: payload.species as LivestockInput['species'],
    breed: String(payload.breed ?? ''),
    sex: payload.sex as LivestockInput['sex'],
    estimatedAgeMonths: Number(payload.estimatedAgeMonths ?? 0),
    weightKg: Number(payload.weightKg ?? 0),
    photo,
    createdAt: animal.createdAt,
    updatedAt: animal.updatedAt,
  };
}

function isLivestockPhoto(entity: DomainEntity, userId: string, livestockId: string): boolean {
  return entity.kind === 'attachment'
    && entity.ownerId === userId
    && entity.contextId === livestockId
    && entity.payload.kind === 'image'
    && entity.payload.accessContext === 'livestock'
    && typeof entity.payload.localUri === 'string';
}

function photoSummary(entity: DomainEntity): LivestockPhoto {
  return {
    id: entity.id,
    filename: String(entity.payload.filename ?? ''),
    mimeType: String(entity.payload.mimeType ?? 'image/jpeg'),
    byteSize: Number(entity.payload.byteSize ?? 0),
    localUri: String(entity.payload.localUri ?? ''),
  };
}
