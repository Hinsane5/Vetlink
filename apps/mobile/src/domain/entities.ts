export const entityKinds = [
  'user',
  'session',
  'farmerProfile',
  'farm',
  'address',
  'vetProfile',
  'verificationSubmission',
  'availability',
  'blockedTime',
  'serviceRate',
  'livestock',
  'healthEvent',
  'consultation',
  'scheduleProposal',
  'visit',
  'clinicalNote',
  'recommendation',
  'recommendationItem',
  'followUp',
  'reminder',
  'progressReport',
  'message',
  'attachment',
  'profileDraft',
  'product',
  'cart',
  'cartItem',
  'quote',
  'order',
  'shipment',
  'payment',
  'paymentAttempt',
  'earningTransaction',
  'ledgerEntry',
  'payoutDestination',
  'withdrawal',
  'review',
  'notification',
  'preferences',
] as const;

export type EntityKind = (typeof entityKinds)[number];

/** Persisted domain records keep mutable versioned data separate from UI state. */
export interface DomainEntity {
  id: string;
  kind: EntityKind;
  ownerId: string | null;
  contextId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  payload: Record<string, unknown>;
}

/** Explicit links provide relational integrity and owner/assignment query paths. */
export interface EntityRelation {
  sourceId: string;
  targetId: string;
  relationship: string;
}

export interface DomainEvent {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EventEffect {
  key: string;
  entity: DomainEntity;
  relations?: readonly EntityRelation[];
}

export const isEntityKind = (value: string): value is EntityKind =>
  (entityKinds as readonly string[]).includes(value);
