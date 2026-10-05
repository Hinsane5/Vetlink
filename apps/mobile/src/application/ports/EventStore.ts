import type { DomainEvent, EventEffect } from '../../domain/entities';

export interface EventTransaction {
  insertEventIfAbsent(event: DomainEvent): Promise<boolean>;
  findEvent(id: string): Promise<DomainEvent | null>;
  insertEffect(effect: EventEffect, eventId: string): Promise<void>;
}

export interface EventStore {
  transaction<T>(work: (transaction: EventTransaction) => Promise<T>): Promise<T>;
}
