import { DomainError } from '../domain/errors';
import type { DomainEvent, EventEffect } from '../domain/entities';
import type { EventStore } from './ports/EventStore';

/** Persists an event and all of its projections atomically; retries are no-ops. */
export async function publishLocalEvent(
  store: EventStore,
  event: DomainEvent,
  effects: readonly EventEffect[],
): Promise<'published' | 'duplicate'> {
  return store.transaction(async (transaction) => {
    const inserted = await transaction.insertEventIfAbsent(event);
    if (!inserted) {
      const existing = await transaction.findEvent(event.id);
      if (!existing || canonicalJson(existing) !== canonicalJson(event)) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'ID event sudah dipakai untuk isi berbeda.');
      }
      return 'duplicate';
    }
    for (const effect of effects) {
      await transaction.insertEffect(effect, event.id);
    }
    return 'published';
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
