import type { DomainEntity, EntityKind, EntityRelation } from '../../domain/entities';

export interface DomainRepository {
  listByKind(kind: EntityKind): Promise<DomainEntity[]>;
  create(entity: DomainEntity, relations?: readonly EntityRelation[]): Promise<void>;
  findById(kind: EntityKind, id: string): Promise<DomainEntity | null>;
  listByOwner(kind: EntityKind, ownerId: string): Promise<DomainEntity[]>;
  listRelated(kind: EntityKind, id: string, relationship: string): Promise<DomainEntity[]>;
  listByRelated(kind: EntityKind, relatedId: string, relationship: string): Promise<DomainEntity[]>;
  update(
    entity: DomainEntity,
    expectedVersion: number,
    relations?: readonly EntityRelation[],
  ): Promise<void>;
  delete(kind: EntityKind, id: string, expectedVersion: number): Promise<void>;
}
