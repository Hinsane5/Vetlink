import { DomainError } from '../../../domain/errors';
import type { DomainEntity, DomainEvent, EventEffect } from '../../../domain/entities';
import { fixtureIds } from '../../../testing/fixtures';
import { publishLocalEvent } from '../../../application/publishLocalEvent';
import type { LocalStore } from './LocalStore';

export interface PersistenceProbeResult {
  status: 'awaiting-restart' | 'passed';
  seedStatus: string;
  schemaVersion: number;
  entityCount: number;
  relationCount: number;
  draftStatus: string;
  draftVersion: number;
  eventProbe: 'created' | 'duplicate-on-restart';
}

/** Development-only probe. It edits a fixture preference, checks it after a cold restart, then restores it. */
export async function runFE02PersistenceProbe(store: LocalStore): Promise<PersistenceProbeResult> {
  const [preference, draft] = await Promise.all([
    store.repositories.findById('preferences', fixtureIds.preferences),
    store.repositories.findById('clinicalNote', fixtureIds.draftNote),
  ]);
  if (!preference || !draft || draft.payload.status !== 'draft') {
    throw new DomainError('INVALID_FIXTURE', 'Fixture preferensi atau catatan draft tidak tersedia.');
  }

  const marker = preference.payload.fe02PersistenceProbe as
    | { state: 'awaiting-restart'; originalCommerce: boolean }
    | undefined;
  let status: PersistenceProbeResult['status'];
  let eventProbe: PersistenceProbeResult['eventProbe'];
  let nextPayload: Record<string, unknown>;

  if (marker?.state === 'awaiting-restart') {
    const notifications = preference.payload.notifications as Record<string, unknown>;
    if (notifications.commerce !== true || store.seedResult.status !== 'already-seeded') {
      throw new DomainError('INVALID_STATE', 'Perubahan fixture atau status seed tidak bertahan setelah restart.');
    }
    const eventResult = await publishLocalEvent(store.events, eventProbeRecord, eventProbeEffects);
    const [notificationCount, healthEventCount] = await Promise.all([
      store.events.notificationCountForEvent(eventProbeRecord.id, fixtureIds.budi),
      store.events.healthEventCountForSource('fe02-persistence-health-probe'),
    ]);
    if (eventResult !== 'duplicate' || notificationCount !== 1 || healthEventCount !== 1) {
      throw new DomainError('INVALID_STATE', 'Event SQLite membuat proyeksi kesehatan atau notifikasi duplikat.');
    }
    status = 'passed';
    eventProbe = 'duplicate-on-restart';
    nextPayload = { ...preference.payload };
    delete nextPayload.fe02PersistenceProbe;
    nextPayload.notifications = { ...notifications, commerce: marker.originalCommerce };
  } else {
    const notifications = preference.payload.notifications as Record<string, unknown>;
    const eventResult = await publishLocalEvent(store.events, eventProbeRecord, eventProbeEffects);
    const [notificationCount, healthEventCount] = await Promise.all([
      store.events.notificationCountForEvent(eventProbeRecord.id, fixtureIds.budi),
      store.events.healthEventCountForSource('fe02-persistence-health-probe'),
    ]);
    if (!['published', 'duplicate'].includes(eventResult) || notificationCount !== 1 || healthEventCount !== 1) {
      throw new DomainError('INVALID_STATE', 'Event SQLite tidak menyimpan satu proyeksi notifikasi dan kesehatan.');
    }
    eventProbe = 'created';
    nextPayload = {
      ...preference.payload,
      fe02PersistenceProbe: {
        state: 'awaiting-restart',
        originalCommerce: notifications.commerce === true,
      },
      notifications: { ...notifications, commerce: true },
    };
    status = 'awaiting-restart';
  }

  await store.repositories.update(
    { ...preference, payload: nextPayload, updatedAt: new Date().toISOString(), version: preference.version + 1 },
    preference.version,
  );

  if (status === 'passed') await cleanupEventProbe(store);

  const [entityCount, relationCount] = await Promise.all([
    store.repositories.countAll(),
    store.repositories.relationCount(),
  ]);
  const result: PersistenceProbeResult = {
    status,
    seedStatus: store.seedResult.status,
    schemaVersion: store.schemaVersion,
    entityCount,
    relationCount,
    draftStatus: String(draft.payload.status),
    draftVersion: draft.version,
    eventProbe,
  };
  console.info(
    `[VetLink][FE02-CHECK] status=${result.status} seed=${result.seedStatus} ` +
      `schema=${result.schemaVersion} entities=${result.entityCount} relations=${result.relationCount} ` +
      `draft=${result.draftStatus}@v${result.draftVersion} event=${result.eventProbe}`,
  );
  return result;
}

const eventProbeRecord: DomainEvent = {
  id: 'fe02-sqlite-idempotency-probe',
  type: 'fe02.storage_probe',
  aggregateId: fixtureIds.completed,
  occurredAt: '2026-10-05T00:00:00.000Z',
  payload: { diagnostic: true, purpose: 'SQLite idempotency check' },
};

const eventProbeNotification: DomainEntity = {
  id: '00000000-0000-4000-8000-000000000090',
  kind: 'notification',
  ownerId: fixtureIds.budi,
  contextId: fixtureIds.completed,
  createdAt: eventProbeRecord.occurredAt,
  updatedAt: eventProbeRecord.occurredAt,
  version: 1,
  payload: {
    recipientId: fixtureIds.budi,
    eventId: eventProbeRecord.id,
    type: eventProbeRecord.type,
    title: 'Pemeriksaan penyimpanan',
    body: 'Notifikasi diagnostik sementara.',
    deliveryStatus: 'sent',
  },
};

const eventProbeHealthEvent: DomainEntity = {
  id: '00000000-0000-4000-8000-000000000091',
  kind: 'healthEvent',
  ownerId: fixtureIds.budi,
  contextId: fixtureIds.goat,
  createdAt: eventProbeRecord.occurredAt,
  updatedAt: eventProbeRecord.occurredAt,
  version: 1,
  payload: {
    animalId: fixtureIds.goat,
    kind: 'examination',
    occurredAt: eventProbeRecord.occurredAt,
    description: 'Proyeksi pemeriksaan diagnostik sementara.',
    sourceKey: 'fe02-persistence-health-probe',
  },
};

const eventProbeEffects: EventEffect[] = [
  {
    key: 'notification:budi',
    entity: eventProbeNotification,
    relations: [
      { sourceId: eventProbeNotification.id, targetId: fixtureIds.budi, relationship: 'recipient' },
      { sourceId: eventProbeNotification.id, targetId: fixtureIds.completed, relationship: 'context' },
    ],
  },
  {
    key: 'health-event:goat',
    entity: eventProbeHealthEvent,
    relations: [
      { sourceId: eventProbeHealthEvent.id, targetId: fixtureIds.goat, relationship: 'animal' },
    ],
  },
];

async function cleanupEventProbe(store: LocalStore): Promise<void> {
  await store.database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM event_effects WHERE event_id = ?', eventProbeRecord.id);
    for (const entityId of [eventProbeNotification.id, eventProbeHealthEvent.id]) {
      await transaction.runAsync(
        'DELETE FROM entity_relations WHERE source_id = ? OR target_id = ?',
        entityId,
        entityId,
      );
      await transaction.runAsync('DELETE FROM entities WHERE id = ?', entityId);
    }
    await transaction.runAsync('DELETE FROM domain_events WHERE id = ?', eventProbeRecord.id);
  });
}
