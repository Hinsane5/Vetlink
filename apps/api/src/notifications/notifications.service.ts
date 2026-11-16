import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal, UserRole } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { AdapterResult } from '../communication/adapter-result.js';
import { NOTIFICATION_DELIVERY_ADAPTER, type NotificationDeliveryAdapter } from './notification-delivery.js';
import { Inject } from '@nestjs/common';
import type { PatchPreferencesDto } from './notifications.dto.js';

export type NotificationCategory = 'consultations' | 'reminders' | 'commerce';
export type NotificationContextType = 'follow_up' | 'progress_report' | 'reminder';

export interface DomainNotificationInput {
  actorId: string;
  recipientId: string;
  type: string;
  category: NotificationCategory;
  contextType: NotificationContextType;
  contextId: string;
  eventId: string;
  aggregateVersion: number;
  title: string;
  body: string;
}

type NotificationRow = {
  id: string;
  actor_id: string;
  recipient_id: string;
  type: string;
  category: NotificationCategory;
  context_type: NotificationContextType;
  context_id: string;
  event_id: string;
  title: string;
  body: string;
  read_at: Date | string | null;
  delivery_status: 'pending' | 'sent' | 'failed' | 'suppressed';
  created_at: Date | string;
  context_accessible?: boolean;
};

type PreferenceRow = {
  user_id: string;
  enabled: boolean;
  categories: { consultations: boolean; reminders: boolean; commerce: boolean } | string;
  version: number;
  updated_at: Date | string;
};

type OutboxRow = {
  notification_id: string;
  recipient_id: string;
  event_id: string;
  type: string;
  category: NotificationCategory;
  attempt_count: number;
};

const DEFAULT_CATEGORIES = { consultations: true, reminders: true, commerce: true };
const MAX_RETRYABLE_DELIVERY_ATTEMPTS = 3;
const OUTBOX_INTERVAL_MS = 1_000;

function jsonObject<T>(value: T | string): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function notFound(): never {
  throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notifikasi atau tujuan pembaruan tidak ditemukan.' });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    return `{${Object.entries(sorted).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer: NodeJS.Timeout | undefined;
  private draining = false;

  constructor(
    private readonly database: DatabaseService,
    @Inject(NOTIFICATION_DELIVERY_ADAPTER) private readonly delivery: NotificationDeliveryAdapter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchOutbox().catch((cause: unknown) => {
        this.logger.warn(`Notification outbox dispatch failed: ${cause instanceof Error ? cause.message : 'unknown error'}`);
      });
    }, OUTBOX_INTERVAL_MS);
    this.timer.unref();
    void this.dispatchOutbox().catch((cause: unknown) => {
      this.logger.warn(`Notification outbox startup dispatch failed: ${cause instanceof Error ? cause.message : 'unknown error'}`);
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recordEvent(client: PoolClient, input: DomainNotificationInput): Promise<void> {
    const payload = { contextId: input.contextId, title: input.title, body: input.body, category: input.category };
    const event = await client.query<{ id: string }>(
      `INSERT INTO domain_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,occurred_at,aggregate_version,payload)
       VALUES($1,$2,$3,$4,$5,now(),$6,$7::jsonb)
       ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [input.eventId, input.type, input.contextType, input.contextId, input.actorId, input.aggregateVersion, JSON.stringify(payload)],
    );
    let domainEventId = event.rows[0]?.id;
    if (!domainEventId) {
      const previous = await client.query<{
        id: string; event_type: string; aggregate_type: NotificationContextType; aggregate_id: string; actor_id: string;
        aggregate_version: number; payload: Record<string, unknown> | string;
      }>(
        `SELECT id,event_type,aggregate_type,aggregate_id,actor_id,aggregate_version,payload
         FROM domain_events WHERE event_key=$1 FOR SHARE`, [input.eventId],
      );
      const row = previous.rows[0];
      if (!row || row.event_type !== input.type || row.aggregate_type !== input.contextType || row.aggregate_id !== input.contextId
        || row.actor_id !== input.actorId || row.aggregate_version !== input.aggregateVersion
        || stableJson(jsonObject(row.payload)) !== stableJson(payload)) {
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Event domain sudah digunakan oleh payload berbeda.' });
      }
      domainEventId = row.id;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO notifications(actor_id,recipient_id,type,category,context_type,context_id,event_id,domain_event_id,title,body)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(recipient_id,event_id) DO NOTHING RETURNING id`,
      [input.actorId, input.recipientId, input.type, input.category, input.contextType, input.contextId,
        input.eventId, domainEventId, input.title, input.body],
    );
    let notificationId = inserted.rows[0]?.id;
    if (!notificationId) {
      const previous = await client.query<{
        id: string; actor_id: string; type: string; category: NotificationCategory; context_type: NotificationContextType;
        context_id: string; domain_event_id: string; title: string; body: string;
      }>(
        `SELECT id,actor_id,type,category,context_type,context_id,domain_event_id,title,body
         FROM notifications WHERE recipient_id=$1 AND event_id=$2 FOR SHARE`, [input.recipientId, input.eventId],
      );
      const row = previous.rows[0];
      if (!row || row.actor_id !== input.actorId || row.type !== input.type || row.category !== input.category
        || row.context_type !== input.contextType || row.context_id !== input.contextId || row.domain_event_id !== domainEventId
        || row.title !== input.title || row.body !== input.body) {
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Event notifikasi sudah digunakan oleh payload berbeda.' });
      }
      notificationId = row.id;
    }

    await client.query(
      `INSERT INTO notification_outbox(notification_id,recipient_id,event_id)
       VALUES($1,$2,$3) ON CONFLICT(recipient_id,event_id) DO NOTHING`,
      [notificationId, input.recipientId, input.eventId],
    );
  }

  async list(principal: AuthenticatedPrincipal) {
    const rows = await this.database.query<NotificationRow>(
      `SELECT n.*,
         CASE n.context_type
           WHEN 'follow_up' THEN EXISTS(
             SELECT 1 FROM follow_ups f WHERE f.id=n.context_id
               AND (($2='farmer' AND f.farmer_id=$1) OR ($2='vet' AND f.vet_id=$1))
           )
           WHEN 'progress_report' THEN EXISTS(
             SELECT 1 FROM progress_reports r WHERE r.id=n.context_id
               AND (($2='farmer' AND r.farmer_id=$1) OR ($2='vet' AND r.vet_id=$1))
           )
           WHEN 'reminder' THEN EXISTS(
             SELECT 1 FROM reminders r WHERE r.id=n.context_id
               AND (($2='farmer' AND r.farmer_id=$1) OR ($2='vet' AND r.vet_id=$1 AND r.consultation_id IS NOT NULL))
           )
           ELSE false
         END AS context_accessible
       FROM notifications n WHERE n.recipient_id=$1
       ORDER BY n.created_at DESC,n.id DESC`,
      [principal.userId, principal.activeRole],
    );
    const unread = rows.rows.reduce((count, row) => count + (row.read_at === null ? 1 : 0), 0);
    return { items: rows.rows.map((row) => this.notificationDto(row)), unreadCount: unread };
  }

  async markRead(principal: AuthenticatedPrincipal, notificationId: string) {
    return this.database.transaction(async (client) => {
      const found = await client.query<NotificationRow>(
        'SELECT * FROM notifications WHERE id=$1 AND recipient_id=$2 FOR UPDATE', [notificationId, principal.userId],
      );
      const notification = found.rows[0];
      if (!notification) notFound();
      if (!await this.hasContextAccess(client, principal.userId, principal.activeRole, notification)) notFound();
      const updated = await client.query<NotificationRow>(
        `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND recipient_id=$2 RETURNING *`,
        [notificationId, principal.userId],
      );
      const value = updated.rows[0];
      return {
        notification: this.notificationDto({ ...value, context_accessible: true }),
        contextId: value.context_id,
        contextType: value.context_type,
      };
    });
  }

  async getPreferences(principal: AuthenticatedPrincipal) {
    return this.database.transaction(async (client) => {
      await this.ensurePreferences(client, principal.userId);
      const result = await client.query<PreferenceRow>(
        'SELECT * FROM notification_preferences WHERE user_id=$1', [principal.userId],
      );
      return this.preferencesDto(result.rows[0]);
    });
  }

  async patchPreferences(principal: AuthenticatedPrincipal, input: PatchPreferencesDto) {
    if (input.enabled === undefined && input.notifications === undefined) {
      throw new ConflictException({ code: 'EMPTY_PATCH', message: 'Pilih setidaknya satu preferensi untuk diperbarui.' });
    }
    return this.database.transaction(async (client) => {
      await this.ensurePreferences(client, principal.userId);
      const selected = await client.query<PreferenceRow>(
        'SELECT * FROM notification_preferences WHERE user_id=$1 FOR UPDATE', [principal.userId],
      );
      const current = selected.rows[0];
      const oldCategories = jsonObject<{ consultations: boolean; reminders: boolean; commerce: boolean }>(current.categories);
      const nextCategories = {
        consultations: input.notifications?.consultations ?? oldCategories.consultations,
        reminders: input.notifications?.reminders ?? oldCategories.reminders,
        commerce: input.notifications?.commerce ?? oldCategories.commerce,
      };
      const nextEnabled = input.enabled ?? current.enabled;
      const changed = nextEnabled !== current.enabled
        || Object.keys(DEFAULT_CATEGORIES).some((key) => nextCategories[key as keyof typeof DEFAULT_CATEGORIES] !== oldCategories[key as keyof typeof DEFAULT_CATEGORIES]);
      if (changed) {
        const updated = await client.query<PreferenceRow>(
          `UPDATE notification_preferences SET enabled=$2,categories=$3::jsonb,version=version+1,updated_at=now()
           WHERE user_id=$1 RETURNING *`,
          [principal.userId, nextEnabled, JSON.stringify(nextCategories)],
        );
        return this.preferencesDto(updated.rows[0]);
      }
      return this.preferencesDto(current);
    });
  }

  async dispatchOutbox(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      return await this.database.transaction(async (client) => {
        const due = await client.query<OutboxRow>(
          `SELECT o.notification_id,o.recipient_id,o.event_id,n.type,n.category,o.attempt_count
           FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id
           WHERE o.delivery_status='pending' AND o.next_attempt_at<=now()
           ORDER BY o.next_attempt_at,o.created_at,o.id
           FOR UPDATE OF o SKIP LOCKED LIMIT 25`,
        );
        for (const row of due.rows) {
          await this.dispatchOne(client, row);
        }
        return due.rowCount ?? 0;
      });
    } finally {
      this.draining = false;
    }
  }

  private async dispatchOne(client: PoolClient, row: OutboxRow): Promise<void> {
    const preferences = await client.query<PreferenceRow>(
      'SELECT * FROM notification_preferences WHERE user_id=$1 FOR SHARE', [row.recipient_id],
    );
    const preference = preferences.rows[0];
    const categories = preference
      ? jsonObject<{ consultations: boolean; reminders: boolean; commerce: boolean }>(preference.categories)
      : DEFAULT_CATEGORIES;
    if (preference && (!preference.enabled || categories[row.category] !== true)) {
      await client.query(
        `UPDATE notification_outbox SET delivery_status='suppressed',last_error=NULL,updated_at=now()
         WHERE notification_id=$1`, [row.notification_id],
      );
      await client.query(
        `UPDATE notifications SET delivery_status='suppressed' WHERE id=$1`, [row.notification_id],
      );
      return;
    }

    const attempt = row.attempt_count + 1;
    const outcome: AdapterResult<void> = await this.delivery.deliver({
      notificationId: row.notification_id,
      eventId: row.event_id,
      recipientId: row.recipient_id,
      type: row.type,
      attempt,
    });
    await client.query(
      `INSERT INTO notification_delivery_attempts(notification_id,attempt,operation_id,outcome,error,occurred_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [row.notification_id, attempt, outcome.operationId, outcome.status,
        outcome.status === 'failed' ? JSON.stringify(outcome.error) : null, outcome.occurredAt],
    );

    const retry = outcome.status === 'pending'
      || (outcome.status === 'failed' && outcome.error.retryable && attempt < MAX_RETRYABLE_DELIVERY_ATTEMPTS);
    const deliveryStatus = outcome.status === 'succeeded' ? 'sent' : outcome.status;
    await client.query(
      `UPDATE notification_outbox
       SET delivery_status=$2::notification_outbox_status,attempt_count=$3,
           next_attempt_at=CASE WHEN $4 THEN now()+interval '5 seconds' ELSE now() END,
           last_error=$5::jsonb,updated_at=now()
       WHERE notification_id=$1`,
      [row.notification_id, retry ? 'pending' : deliveryStatus, attempt, retry,
        outcome.status === 'failed' ? JSON.stringify(outcome.error) : null],
    );
    await client.query(
      'UPDATE notifications SET delivery_status=$2::notification_delivery_status WHERE id=$1',
      [row.notification_id, deliveryStatus],
    );
  }

  private async ensurePreferences(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [userId],
    );
  }

  private async hasContextAccess(
    client: PoolClient,
    userId: string,
    activeRole: UserRole,
    notification: NotificationRow,
  ): Promise<boolean> {
    const tableAndCondition: Record<NotificationContextType, string> = {
      follow_up: `SELECT 1 FROM follow_ups WHERE id=$1 AND (($2='farmer' AND farmer_id=$3) OR ($2='vet' AND vet_id=$3))`,
      progress_report: `SELECT 1 FROM progress_reports WHERE id=$1 AND (($2='farmer' AND farmer_id=$3) OR ($2='vet' AND vet_id=$3))`,
      reminder: `SELECT 1 FROM reminders WHERE id=$1 AND (($2='farmer' AND farmer_id=$3) OR ($2='vet' AND vet_id=$3 AND consultation_id IS NOT NULL))`,
    };
    const found = await client.query(tableAndCondition[notification.context_type], [notification.context_id, activeRole, userId]);
    return (found.rowCount ?? 0) > 0;
  }

  private notificationDto(row: NotificationRow) {
    const contextAccessible = row.context_accessible ?? true;
    return {
      id: row.id,
      actorId: row.actor_id,
      recipientId: row.recipient_id,
      type: row.type,
      category: row.category,
      contextType: row.context_type,
      contextId: contextAccessible ? row.context_id : null,
      eventId: row.event_id,
      title: row.title,
      body: row.body,
      readAt: iso(row.read_at),
      deliveryStatus: row.delivery_status,
      createdAt: iso(row.created_at),
    };
  }

  private preferencesDto(row: PreferenceRow) {
    return {
      userId: row.user_id,
      enabled: row.enabled,
      notifications: jsonObject(row.categories),
      version: row.version,
      updatedAt: iso(row.updated_at),
    };
  }
}
