import { DomainError } from './errors';
import type { DomainEntity, EntityKind, EntityRelation } from './entities';

const relationTargetKinds: Partial<Record<EntityKind, Record<string, EntityKind[]>>> = {
  farmerProfile: { user: ['user'], farm: ['farm'], address: ['address'] },
  farm: { owner: ['user'], visitAddress: ['address'] },
  vetProfile: {
    user: ['user'],
    verificationSubmission: ['verificationSubmission'],
    availability: ['availability'],
    serviceRate: ['serviceRate'],
  },
  livestock: { farmer: ['user'], farm: ['farm'], photo: ['attachment'] },
  consultation: { farmer: ['user'], veterinarian: ['user'], animal: ['livestock'] },
  visit: { consultation: ['consultation'] },
  scheduleProposal: { consultation: ['consultation'] },
  clinicalNote: { consultation: ['consultation'], animal: ['livestock'], veterinarian: ['user'], attachment: ['attachment'] },
  healthEvent: { animal: ['livestock'], clinicalNote: ['clinicalNote'], reminder: ['reminder'], attachment: ['attachment'] },
  followUp: { consultation: ['consultation'], animal: ['livestock'], veterinarian: ['user'] },
  reminder: { animal: ['livestock'], consultation: ['consultation'], followUp: ['followUp'] },
  cartItem: { cart: ['cart'], product: ['product'] },
  order: { address: ['address'] },
  orderItem: { order: ['order'], product: ['product'] },
  shipment: { order: ['order'] },
  payment: { payable: ['consultation', 'order'] },
  paymentAttempt: { payment: ['payment'] },
  earningTransaction: { consultation: ['consultation'] },
  ledgerEntry: { earning: ['earningTransaction'], withdrawal: ['withdrawal'] },
  withdrawal: { vet: ['user'] },
  notification: { recipient: ['user'] },
  message: { consultation: ['consultation'] },
  preferences: { user: ['user'] },
  review: { consultation: ['consultation'], veterinarian: ['user'], farmer: ['user'] },
};

export function validateFixtureGraph(
  entities: readonly DomainEntity[],
  relations: readonly EntityRelation[],
): void {
  const ids = new Set<string>();
  const byId = new Map<string, DomainEntity>();
  for (const entity of entities) {
    if (ids.has(entity.id)) {
      throw new DomainError('INVALID_FIXTURE', `ID fixture duplikat: ${entity.id}.`);
    }
    if (!Number.isInteger(entity.version) || entity.version < 1) {
      throw new DomainError('INVALID_FIXTURE', `Versi fixture tidak valid: ${entity.id}.`);
    }
    ids.add(entity.id);
    byId.set(entity.id, entity);
  }

  const relationKeys = new Set<string>();
  for (const relation of relations) {
    const source = byId.get(relation.sourceId);
    const target = byId.get(relation.targetId);
    if (!source || !target) {
      throw new DomainError(
        'INVALID_FIXTURE',
        `Relasi ${relation.relationship} mengarah ke entitas yang tidak ada.`,
      );
    }
    const expectedKinds = relationTargetKinds[source.kind]?.[relation.relationship];
    if (expectedKinds && !expectedKinds.includes(target.kind)) {
      throw new DomainError(
        'INVALID_FIXTURE',
        `Relasi ${source.kind}.${relation.relationship} tidak dapat menunjuk ke ${target.kind}.`,
      );
    }
    const key = `${relation.sourceId}:${relation.relationship}:${relation.targetId}`;
    if (relationKeys.has(key)) {
      throw new DomainError('INVALID_FIXTURE', `Relasi fixture duplikat: ${key}.`);
    }
    relationKeys.add(key);
  }

  for (const entity of entities) {
    if (entity.ownerId && byId.get(entity.ownerId)?.kind !== 'user') {
      throw new DomainError('INVALID_FIXTURE', `Pemilik ${entity.id} bukan pengguna fixture.`);
    }
    if (entity.kind === 'consultation') {
      const required = ['farmer', 'veterinarian', 'animal'];
      for (const relationship of required) {
        if (!relations.some((link) => link.sourceId === entity.id && link.relationship === relationship)) {
          throw new DomainError(
            'INVALID_FIXTURE',
            `Konsultasi ${entity.id} belum memiliki relasi ${relationship}.`,
          );
        }
      }
    }
    if (entity.kind === 'livestock') {
      const required = ['farmer', 'farm'];
      for (const relationship of required) {
        if (!relations.some((link) => link.sourceId === entity.id && link.relationship === relationship)) {
          throw new DomainError(
            'INVALID_FIXTURE',
            `Ternak ${entity.id} belum memiliki relasi ${relationship}.`,
          );
        }
      }
    }
    if (entity.kind === 'notification') {
      const recipientId = entity.payload.recipientId;
      if (typeof recipientId !== 'string' || recipientId !== entity.ownerId || !relations.some((link) => link.sourceId === entity.id && link.relationship === 'recipient' && link.targetId === recipientId)) {
        throw new DomainError('INVALID_FIXTURE', `Notifikasi ${entity.id} belum memiliki penerima yang cocok dengan pemilik.`);
      }
      if (typeof entity.payload.eventId !== 'string' || !entity.payload.eventId) {
        throw new DomainError('INVALID_FIXTURE', `Notifikasi ${entity.id} belum memiliki event ID.`);
      }
    }
    if (entity.kind === 'preferences') {
      const userId = entity.payload.userId;
      if (typeof userId !== 'string' || userId !== entity.ownerId || !relations.some((link) => link.sourceId === entity.id && link.relationship === 'user' && link.targetId === userId)) {
        throw new DomainError('INVALID_FIXTURE', `Preferensi ${entity.id} belum memiliki relasi akun yang cocok.`);
      }
    }
  }
}
