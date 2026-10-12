import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import {
  assertRecommendationSendable,
  normalizeRecommendationItems,
  type RecommendationItemInput,
  type RecommendationItemSnapshot,
  type RecommendationProduct,
  type RecommendationSnapshot,
} from '../domain/recommendations';
import type { BookingRepository, BookingUnit } from './ports/BookingRepository';
import type { IdFactory } from './ports/AuthRepository';

type ConsultationAccess = {
  consultation: DomainEntity;
  farmerId: string;
  vetId: string;
  animalId: string;
};

/** Recommendation commands use the same local transaction queue as booking and clinical notes. */
export class RecommendationService {
  constructor(
    private readonly storage: BookingRepository,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole, consultationId: string): Promise<RecommendationSnapshot | null> {
    const access = await this.access(this.storage.read, userId, role, consultationId);
    const recommendation = await this.recommendationFor(this.storage.read, access);
    if (!recommendation || (role === 'farmer' && recommendation.payload.status !== 'sent')) return null;
    return this.snapshot(this.storage.read, recommendation, access.vetId);
  }

  async listProducts(userId: string, consultationId: string): Promise<RecommendationProduct[]> {
    await this.access(this.storage.read, userId, 'vet', consultationId);
    const products = await this.storage.read.repository.listByKind('product');
    return products
      .filter((product) => product.payload.active === true && Number.isSafeInteger(product.payload.unitPrice)
        && (product.payload.unitPrice as number) >= 0 && (product.payload.currency === undefined || product.payload.currency === 'IDR'))
      .map(toProduct)
      .sort((left, right) => left.name.localeCompare(right.name, 'id'));
  }

  async saveDraft(
    userId: string,
    consultationId: string,
    expectedVersion: number | null,
    input: readonly RecommendationItemInput[],
  ): Promise<RecommendationSnapshot> {
    const normalized = normalizeRecommendationItems(input);
    return this.storage.transaction(async (unit) => {
      const access = await this.access(unit, userId, 'vet', consultationId);
      await this.assertEditableContext(unit, userId, access);
      const current = await this.recommendationFor(unit, access);
      if (current?.payload.status === 'sent') throw new DomainError('IMMUTABLE_RECORD', 'Rekomendasi yang sudah terkirim hanya dapat dibaca.');
      if (current && (expectedVersion === null || current.version !== expectedVersion)) {
        throw new DomainError('VERSION_CONFLICT', 'Draft rekomendasi sudah berubah. Muat ulang sebelum menyimpan.');
      }
      if (!current && expectedVersion !== null) {
        throw new DomainError('VERSION_CONFLICT', 'Draft rekomendasi sudah tidak tersedia. Muat ulang sebelum menyimpan.');
      }

      const record = current ?? this.entity('recommendation', access.vetId, consultationId, {
        consultationId,
        vetId: access.vetId,
        status: 'draft',
        sentAt: null,
      });
      if (!current) {
        await unit.repository.create(record, [{ sourceId: consultationId, targetId: record.id, relationship: 'recommendation' }]);
      }

      const existingItems = current ? await this.itemsFor(unit, current, access.vetId) : [];
      const existingById = new Map(existingItems.map((item) => [item.id, item]));
      const retainedIds = new Set<string>();
      let changed = !current;
      for (const [position, item] of normalized.entries()) {
        const product = item.productId ? await this.activeProduct(unit, item.productId) : null;
        const fields = {
          recommendationId: record.id,
          productId: product?.id ?? null,
          titleSnapshot: item.titleSnapshot || product?.name || '',
          instructions: item.instructions,
          note: item.note,
          position,
        };
        const existing = item.id ? existingById.get(item.id) : undefined;
        if (item.id && !existing) throw new DomainError('FORBIDDEN', 'Item rekomendasi bukan bagian dari draft ini.');
        if (existing) {
          retainedIds.add(existing.id);
          if (sameItem(existing.record, fields)) continue;
          const updated = this.updated(existing.record, fields);
          await unit.repository.update(updated, existing.record.version, itemRelations(updated));
          changed = true;
        } else {
          const created = this.entity('recommendationItem', access.vetId, record.id, fields);
          await unit.repository.create(created, itemRelations(created));
          changed = true;
        }
      }
      for (const item of existingItems) {
        if (!retainedIds.has(item.id)) {
          await unit.repository.delete('recommendationItem', item.id, item.record.version);
          changed = true;
        }
      }

      let saved = record;
      if (current && changed) {
        saved = this.updated(record, { status: 'draft', sentAt: null });
        await unit.repository.update(saved, record.version);
      }
      return this.snapshot(unit, saved, access.vetId);
    });
  }

  async send(userId: string, command: {
    consultationId: string;
    expectedVersion: number;
    operationKey: string;
  }): Promise<RecommendationSnapshot> {
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new DomainError('VALIDATION_FAILED', 'Versi rekomendasi tidak valid.');
    }
    if (!command.operationKey.trim() || command.operationKey.length > 200) {
      throw new DomainError('VALIDATION_FAILED', 'Identitas pengiriman rekomendasi tidak valid.');
    }
    return this.storage.transaction(async (unit) => {
      const access = await this.access(unit, userId, 'vet', command.consultationId);
      const recommendation = await this.recommendationFor(unit, access);
      if (!recommendation) throw new DomainError('INVALID_STATE', 'Simpan draft rekomendasi sebelum mengirimnya.');
      const fingerprint = JSON.stringify({
        consultationId: command.consultationId,
        recommendationId: recommendation.id,
        expectedVersion: command.expectedVersion,
        action: 'send_recommendation',
      });
      const prior = await this.actionFor(unit, command.operationKey);
      if (prior) {
        if (prior.ownerId !== userId || prior.contextId !== command.consultationId || prior.payload.fingerprint !== fingerprint
          || prior.payload.role !== 'vet' || prior.payload.action !== 'send_recommendation') {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Identitas pengiriman sudah dipakai untuk perubahan lain.');
        }
        const sent = await unit.repository.findById('recommendation', recommendation.id);
        if (!sent || sent.payload.status !== 'sent') throw new DomainError('INVALID_STATE', 'Hasil pengiriman rekomendasi tidak ditemukan.');
        return this.snapshot(unit, sent, access.vetId);
      }
      if (recommendation.payload.status === 'sent') throw new DomainError('IMMUTABLE_RECORD', 'Rekomendasi yang sudah terkirim hanya dapat dibaca.');
      if (recommendation.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT', 'Draft berubah setelah ditinjau. Periksa ulang sebelum mengirim.');
      await this.assertEditableContext(unit, userId, access);
      const items = await this.itemsFor(unit, recommendation, access.vetId);
      assertRecommendationSendable(items.map((item) => ({
        id: item.id,
        productId: item.productId,
        titleSnapshot: item.titleSnapshot,
        instructions: item.instructions,
        note: item.note,
      })));

      const sentAt = this.now().toISOString();
      const sent = this.updated(recommendation, { status: 'sent', sentAt });
      await unit.repository.update(sent, recommendation.version);
      const action = this.entity('consultationAction', userId, command.consultationId, {
        operationKey: command.operationKey,
        fingerprint,
        role: 'vet',
        action: 'send_recommendation',
        fromStatus: 'draft',
        toStatus: 'sent',
        recommendationId: sent.id,
        recommendationVersion: sent.version,
      });
      await unit.repository.create(action, [{ sourceId: action.id, targetId: command.consultationId, relationship: 'consultation' }]);
      return this.snapshot(unit, sent, access.vetId);
    });
  }

  private async access(unit: BookingUnit, userId: string, role: AccountRole, consultationId: string): Promise<ConsultationAccess> {
    const aggregate = await unit.profiles.loadProfile(userId, role);
    if (aggregate.profile.ownerId !== userId || aggregate.profile.kind !== (role === 'vet' ? 'vetProfile' : 'farmerProfile')) {
      throw new DomainError('FORBIDDEN', 'Profil tidak sesuai dengan peran aktif.');
    }
    const consultation = await unit.repository.findById('consultation', consultationId);
    if (!consultation || consultation.kind !== 'consultation') throw new DomainError('NOT_FOUND', 'Layanan tidak ditemukan.');
    const farmerId = stringValue(consultation.payload.farmerId);
    const vetId = stringValue(consultation.payload.vetId);
    const animalId = stringValue(consultation.payload.animalId);
    if (!farmerId || !vetId || !animalId || (role === 'farmer'
      ? userId !== farmerId || consultation.ownerId !== userId
      : userId !== vetId || consultation.ownerId !== farmerId)) {
      throw new DomainError('FORBIDDEN', 'Rekomendasi ini bukan milik atau penugasan akun ini.');
    }
    const [farmers, vets, animals, animal] = await Promise.all([
      unit.repository.listRelated('consultation', consultationId, 'farmer'),
      unit.repository.listRelated('consultation', consultationId, 'veterinarian'),
      unit.repository.listRelated('consultation', consultationId, 'animal'),
      unit.repository.findById('livestock', animalId),
    ]);
    if (!farmers.some((item) => item.id === farmerId) || !vets.some((item) => item.id === vetId)
      || !animals.some((item) => item.id === animalId) || animal?.ownerId !== farmerId) {
      throw new DomainError('FORBIDDEN', 'Relasi pasien dan layanan tidak valid.');
    }
    return { consultation, farmerId, vetId, animalId };
  }

  private async assertEditableContext(unit: BookingUnit, userId: string, access: ConsultationAccess): Promise<void> {
    if (access.consultation.payload.vetId !== userId || access.consultation.payload.status !== 'in_progress') {
      throw new DomainError('INVALID_STATE', 'Rekomendasi hanya dapat dikirim saat layanan berlangsung.');
    }
    const aggregate = await unit.profiles.loadProfile(userId, 'vet');
    if (aggregate.profile.payload.verificationStatus !== 'verified') {
      throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi untuk mengelola rekomendasi.');
    }
    const payments = await unit.repository.listByRelated('payment', access.consultation.id, 'payable');
    const fee = access.consultation.payload.feeSnapshot;
    const paid = payments.some((payment) => payment.ownerId === access.farmerId
      && payment.payload.payableType === 'consultation' && payment.payload.payableId === access.consultation.id
      && payment.payload.status === 'succeeded' && Number.isSafeInteger(payment.payload.amount) && payment.payload.amount === fee);
    if (!paid) throw new DomainError('INVALID_STATE', 'Pembayaran layanan belum berhasil.');
    const notes = (await unit.repository.listByRelated('clinicalNote', access.consultation.id, 'consultation'))
      .filter((item) => item.kind === 'clinicalNote');
    if (notes.length !== 1 || notes[0].ownerId !== access.vetId || notes[0].payload.status !== 'final'
      || notes[0].payload.consultationId !== access.consultation.id || notes[0].payload.vetId !== access.vetId
      || notes[0].payload.animalId !== access.animalId) {
      throw new DomainError('INVALID_STATE', 'Catatan pemeriksaan final diperlukan sebelum mengelola rekomendasi.');
    }
    const [consultations, animals, vets] = await Promise.all([
      unit.repository.listRelated('clinicalNote', notes[0].id, 'consultation'),
      unit.repository.listRelated('clinicalNote', notes[0].id, 'animal'),
      unit.repository.listRelated('clinicalNote', notes[0].id, 'veterinarian'),
    ]);
    if (!consultations.some((item) => item.id === access.consultation.id)
      || !animals.some((item) => item.id === access.animalId) || !vets.some((item) => item.id === access.vetId)) {
      throw new DomainError('FORBIDDEN', 'Relasi catatan final tidak sesuai dengan layanan.');
    }
  }

  private async recommendationFor(unit: BookingUnit, access: ConsultationAccess): Promise<DomainEntity | null> {
    const recommendations = await unit.repository.listRelated('consultation', access.consultation.id, 'recommendation');
    if (recommendations.length > 1) throw new DomainError('INVALID_STATE', 'Layanan memiliki lebih dari satu rekomendasi.');
    if (!recommendations.length) return null;
    const record = recommendations[0];
    if (record.kind !== 'recommendation' || record.ownerId !== access.vetId || record.contextId !== access.consultation.id
      || record.payload.consultationId !== access.consultation.id || record.payload.vetId !== access.vetId
      || !['draft', 'sent'].includes(String(record.payload.status))) {
      throw new DomainError('FORBIDDEN', 'Rekomendasi tidak sesuai dengan layanan atau dokter.');
    }
    return record;
  }

  private async itemsFor(unit: BookingUnit, recommendation: DomainEntity, vetId: string): Promise<RecommendationItemSnapshot[]> {
    const records = await unit.repository.listByRelated('recommendationItem', recommendation.id, 'recommendation');
    const items: RecommendationItemSnapshot[] = [];
    for (const item of records) {
      if (item.kind !== 'recommendationItem' || item.ownerId !== vetId || item.contextId !== recommendation.id
        || item.payload.recommendationId !== recommendation.id) {
        throw new DomainError('FORBIDDEN', 'Item tidak sesuai dengan rekomendasi dokter.');
      }
      const parentLinks = await unit.repository.listRelated('recommendationItem', item.id, 'recommendation');
      if (parentLinks.length !== 1 || parentLinks[0].id !== recommendation.id) throw new DomainError('FORBIDDEN', 'Relasi item ke rekomendasi tidak valid.');
      const productId = nullableString(item.payload.productId);
      const productLinks = await unit.repository.listRelated('recommendationItem', item.id, 'product');
      let productName: string | null = null;
      let productUnitPrice: number | null = null;
      if (productId) {
        if (productLinks.length !== 1 || productLinks[0].id !== productId || productLinks[0].kind !== 'product') {
          throw new DomainError('FORBIDDEN', 'Relasi produk pada item rekomendasi tidak valid.');
        }
        productName = stringValue(productLinks[0].payload.name) || null;
        productUnitPrice = Number.isSafeInteger(productLinks[0].payload.unitPrice) ? productLinks[0].payload.unitPrice as number : null;
      } else if (productLinks.length) {
        throw new DomainError('FORBIDDEN', 'Item rekomendasi memiliki relasi produk tanpa productId.');
      }
      items.push({
        id: item.id,
        record: item,
        productId,
        titleSnapshot: stringValue(item.payload.titleSnapshot),
        instructions: stringValue(item.payload.instructions),
        note: stringValue(item.payload.note),
        productName,
        productUnitPrice,
        position: Number.isSafeInteger(item.payload.position) ? item.payload.position as number : 0,
      });
    }
    return items.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  }

  private async snapshot(unit: BookingUnit, record: DomainEntity, vetId: string): Promise<RecommendationSnapshot> {
    return {
      record,
      status: record.payload.status as 'draft' | 'sent',
      sentAt: nullableString(record.payload.sentAt),
      items: await this.itemsFor(unit, record, vetId),
    };
  }

  private async activeProduct(unit: BookingUnit, id: string): Promise<RecommendationProduct> {
    const entity = await unit.repository.findById('product', id);
    if (!entity || entity.kind !== 'product' || entity.payload.active !== true || !Number.isSafeInteger(entity.payload.unitPrice)
      || (entity.payload.unitPrice as number) < 0 || (entity.payload.currency !== undefined && entity.payload.currency !== 'IDR')) {
      throw new DomainError('NOT_FOUND', 'Produk katalog tidak tersedia untuk rekomendasi.');
    }
    return toProduct(entity);
  }

  private async actionFor(unit: BookingUnit, operationKey: string): Promise<DomainEntity | null> {
    return (await unit.repository.listByKind('consultationAction')).find((item) => item.payload.operationKey === operationKey) ?? null;
  }

  private entity(kind: DomainEntity['kind'], ownerId: string | null, contextId: string | null, payload: Record<string, unknown>): DomainEntity {
    const timestamp = this.now().toISOString();
    return { id: this.ids.create(), kind, ownerId, contextId, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
  }

  private updated(record: DomainEntity, patch: Record<string, unknown>): DomainEntity {
    return { ...record, updatedAt: this.now().toISOString(), version: record.version + 1, payload: { ...record.payload, ...patch } };
  }
}

function itemRelations(item: DomainEntity): EntityRelation[] {
  const relations: EntityRelation[] = [
    { sourceId: item.id, targetId: String(item.payload.recommendationId), relationship: 'recommendation' },
  ];
  if (typeof item.payload.productId === 'string' && item.payload.productId) {
    relations.push({ sourceId: item.id, targetId: item.payload.productId, relationship: 'product' });
  }
  return relations;
}

function sameItem(record: DomainEntity, fields: Record<string, unknown>): boolean {
  return ['productId', 'titleSnapshot', 'instructions', 'note', 'position'].every((key) => record.payload[key] === fields[key]);
}

function toProduct(entity: DomainEntity): RecommendationProduct {
  return {
    id: entity.id,
    name: stringValue(entity.payload.name),
    category: stringValue(entity.payload.category),
    description: stringValue(entity.payload.description),
    unitPrice: entity.payload.unitPrice as number,
  };
}

function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function nullableString(value: unknown): string | null { const result = stringValue(value); return result || null; }
