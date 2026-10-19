import type { DomainRepository } from './ports/DomainRepository';
import type { ProfileCreate, ProfileRepository, ProfileUpdate } from './ports/ProfileRepository';
import type { IdFactory } from './ports/AuthRepository';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { formatFarmAddress, validateFarmInput, type FarmInput, type FarmSnapshot } from '../domain/farms';
import { livestockSpecies, type LivestockSpecies } from '../domain/profiles';

export class FarmService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly profiles: ProfileRepository,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(userId: string): Promise<FarmSnapshot[]> {
    const aggregate = await this.farmerProfile(userId);
    const selectedId = typeof aggregate.profile.payload.farmId === 'string' ? aggregate.profile.payload.farmId : null;
    const records = await this.repository.listByOwner('farm', userId);
    const farms: FarmSnapshot[] = [];
    for (const farm of records) {
      if (farm.kind !== 'farm' || farm.ownerId !== userId) continue;
      await this.assertFarmOwnerLink(farm, userId);
      farms.push(await this.toSnapshot(farm, userId, selectedId === farm.id));
    }
    if (selectedId && !farms.some((farm) => farm.id === selectedId)) {
      throw new DomainError('FORBIDDEN', 'Peternakan terpilih bukan milik akun ini.');
    }
    return farms.sort((left, right) => left.name.localeCompare(right.name, 'id-ID') || left.id.localeCompare(right.id));
  }

  async get(userId: string, farmId: string): Promise<FarmSnapshot> {
    const aggregate = await this.farmerProfile(userId);
    const farm = await this.ownedFarm(userId, farmId);
    return this.toSnapshot(farm, userId, aggregate.profile.payload.farmId === farm.id);
  }

  async create(userId: string, input: FarmInput): Promise<FarmSnapshot> {
    const values = validateFarmInput(input);
    const aggregate = await this.farmerProfile(userId);
    const id = this.ids.create();
    const addressId = this.ids.create();
    const timestamp = this.now().toISOString();
    const farm = entity('farm', id, userId, {
      name: values.name,
      species: values.species,
      location: values.location,
      visitAddressId: addressId,
    }, timestamp, aggregate.profile.id);
    const address = entity('address', addressId, userId, addressPayload(values), timestamp, id);
    const profile = revised(aggregate.profile, { ...aggregate.profile.payload, farmId: id }, timestamp);
    const changes = {
      creates: [
        { entity: farm, relations: farmRelations(id, userId, addressId) },
        { entity: address },
      ] satisfies ProfileCreate[],
      updates: [profileUpdate(profile, aggregate.profile, profileRelations(aggregate.profileRelations, profile.id, userId, id, addressId))],
    };
    await this.profiles.commit(changes);
    return this.toSnapshot(farm, userId, true, address);
  }

  async update(userId: string, farmId: string, input: FarmInput): Promise<FarmSnapshot> {
    const values = validateFarmInput(input);
    const [aggregate, farm] = await Promise.all([this.farmerProfile(userId), this.ownedFarm(userId, farmId)]);
    const address = await this.addressForFarm(farm, userId, aggregate.profile.id);
    const addressId = address?.id ?? this.ids.create();
    const timestamp = this.now().toISOString();
    const nextFarm = revised(farm, {
      name: values.name,
      species: values.species,
      location: values.location,
      visitAddressId: addressId,
    }, timestamp);
    const nextAddress = address
      ? { ...revised(address, addressPayload(values), timestamp), contextId: farm.id }
      : entity('address', addressId, userId, addressPayload(values), timestamp, farm.id);
    const updates: ProfileUpdate[] = [profileUpdate(nextFarm, farm, farmRelations(farm.id, userId, addressId))];
    const creates: ProfileCreate[] = [];
    if (address) updates.push(profileUpdate(nextAddress, address));
    else creates.push({ entity: nextAddress });
    const isSelected = aggregate.profile.payload.farmId === farm.id;
    if (isSelected) {
      const profile = revised(aggregate.profile, { ...aggregate.profile.payload, farmId: farm.id }, timestamp);
      updates.push(profileUpdate(profile, aggregate.profile, profileRelations(aggregate.profileRelations, profile.id, userId, farm.id, addressId)));
    }
    await this.profiles.commit({ creates, updates });
    return this.toSnapshot(nextFarm, userId, isSelected, nextAddress);
  }

  async select(userId: string, farmId: string): Promise<FarmSnapshot> {
    const [aggregate, farm] = await Promise.all([this.farmerProfile(userId), this.ownedFarm(userId, farmId)]);
    const address = await this.addressForFarm(farm, userId, aggregate.profile.id);
    if (!address) throw new DomainError('INVALID_STATE', 'Tambahkan alamat kunjungan pada peternakan ini sebelum memilihnya.');
    if (aggregate.profile.payload.farmId !== farm.id) {
      const timestamp = this.now().toISOString();
      const profile = revised(aggregate.profile, { ...aggregate.profile.payload, farmId: farm.id }, timestamp);
      await this.profiles.commit({ updates: [profileUpdate(profile, aggregate.profile, profileRelations(aggregate.profileRelations, profile.id, userId, farm.id, address.id))] });
    }
    return this.toSnapshot(farm, userId, true, address);
  }

  async addressForOwnedFarm(userId: string, farmId: string) {
    const farm = await this.ownedFarm(userId, farmId);
    const aggregate = await this.farmerProfile(userId);
    const address = await this.addressForFarm(farm, userId, aggregate.profile.id);
    if (!address) throw new DomainError('INVALID_STATE', 'Alamat kunjungan peternakan belum tersedia.');
    return { farm, address, visitAddress: formatFarmAddress(address.payload as Pick<FarmInput, 'address' | 'city' | 'province' | 'postalCode'>) };
  }

  private async farmerProfile(userId: string) {
    const aggregate = await this.profiles.loadProfile(userId, 'farmer');
    if (aggregate.user.kind !== 'user' || aggregate.user.id !== userId || aggregate.profile.kind !== 'farmerProfile' || aggregate.profile.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Peternakan hanya dapat dikelola oleh pemilik profil Peternak.');
    }
    return aggregate;
  }

  private async ownedFarm(userId: string, farmId: string): Promise<DomainEntity> {
    if (!farmId) throw new DomainError('VALIDATION_FAILED', 'Pilih peternakan terlebih dahulu.');
    const farm = await this.repository.findById('farm', farmId);
    if (!farm) throw new DomainError('NOT_FOUND', 'Peternakan tidak ditemukan.');
    if (farm.kind !== 'farm' || farm.ownerId !== userId) throw new DomainError('FORBIDDEN', 'Peternakan ini bukan milik akun Peternak yang sedang aktif.');
    await this.assertFarmOwnerLink(farm, userId);
    return farm;
  }

  private async assertFarmOwnerLink(farm: DomainEntity, userId: string): Promise<void> {
    const owners = await this.repository.listRelated('farm', farm.id, 'owner');
    if (!owners.some((item) => item.kind === 'user' && item.id === userId && item.ownerId === null)) {
      throw new DomainError('FORBIDDEN', 'Relasi kepemilikan peternakan tidak valid.');
    }
  }

  private async addressForFarm(farm: DomainEntity, userId: string, legacyProfileId?: string): Promise<DomainEntity | null> {
    const links = await this.repository.listRelated('farm', farm.id, 'visitAddress');
    const addressId = (typeof farm.payload.visitAddressId === 'string' ? farm.payload.visitAddressId : null)
      ?? links.find((item) => item.kind === 'address')?.id
      ?? null;
    if (!addressId) return null;
    const address = await this.repository.findById('address', addressId);
    if (!address || address.kind !== 'address' || address.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Alamat peternakan bukan milik akun Peternak ini.');
    }
    const linked = links.some((item) => item.id === addressId);
    if (!linked || (address.contextId !== farm.id && address.contextId !== legacyProfileId)) {
      throw new DomainError('FORBIDDEN', 'Alamat tidak terhubung pada konteks peternakan ini.');
    }
    return address;
  }

  private async toSnapshot(farm: DomainEntity, userId: string, selected: boolean, knownAddress?: DomainEntity | null): Promise<FarmSnapshot> {
    const address = knownAddress === undefined ? await this.addressForFarm(farm, userId) : knownAddress;
    if (!address) throw new DomainError('INVALID_STATE', 'Alamat kunjungan peternakan belum tersedia.');
    const payload = farm.payload;
    const species = Array.isArray(payload.species)
      ? payload.species.filter((value): value is LivestockSpecies => typeof value === 'string' && livestockSpecies.includes(value as LivestockSpecies))
      : [];
    const addressPayloadValue = address.payload;
    const values: FarmInput = {
      name: stringValue(payload.name),
      species,
      location: stringValue(payload.location),
      addressLabel: stringValue(addressPayloadValue.label),
      recipient: stringValue(addressPayloadValue.recipient),
      phone: stringValue(addressPayloadValue.phone),
      address: stringValue(addressPayloadValue.address),
      city: stringValue(addressPayloadValue.city),
      province: stringValue(addressPayloadValue.province),
      postalCode: stringValue(addressPayloadValue.postalCode),
    };
    return { id: farm.id, ...values, selected, visitAddress: formatFarmAddress(values), version: farm.version };
  }
}

function addressPayload(input: FarmInput): Record<string, unknown> {
  return { label: input.addressLabel, recipient: input.recipient, phone: input.phone, address: input.address, city: input.city, province: input.province, postalCode: input.postalCode };
}

function farmRelations(farmId: string, userId: string, addressId: string): EntityRelation[] {
  return [
    { sourceId: farmId, relationship: 'owner', targetId: userId },
    { sourceId: farmId, relationship: 'visitAddress', targetId: addressId },
  ];
}

function profileRelations(current: readonly EntityRelation[], profileId: string, userId: string, farmId: string, addressId: string): EntityRelation[] {
  return [
    ...current.filter((relation) => !['user', 'farm', 'address'].includes(relation.relationship)),
    { sourceId: profileId, relationship: 'user', targetId: userId },
    { sourceId: profileId, relationship: 'farm', targetId: farmId },
    { sourceId: profileId, relationship: 'address', targetId: addressId },
  ];
}

function entity(kind: DomainEntity['kind'], id: string, ownerId: string, payload: Record<string, unknown>, timestamp: string, contextId: string): DomainEntity {
  return { kind, id, ownerId, contextId, payload, createdAt: timestamp, updatedAt: timestamp, version: 1 };
}

function revised(current: DomainEntity, payload: Record<string, unknown>, timestamp: string): DomainEntity {
  return { ...current, payload, updatedAt: timestamp, version: current.version + 1 };
}

function profileUpdate(entityValue: DomainEntity, current: DomainEntity, relations?: readonly EntityRelation[]): ProfileUpdate {
  return { entity: entityValue, expectedVersion: current.version, ...(relations ? { relations } : {}) };
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
