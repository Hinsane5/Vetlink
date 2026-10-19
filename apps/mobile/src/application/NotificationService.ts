import type { DomainEntity } from '../domain/entities';
import { DomainError } from '../domain/errors';
import type { DomainRepository } from './ports/DomainRepository';

export interface NotificationSnapshot {
  id: string;
  recipientId: string;
  eventId: string;
  type: string;
  contextId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  deliveryStatus: string;
  createdAt: string;
}

/** Recipient-scoped inbox projection; preferences never remove persisted inbox records. */
export class NotificationService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listForRecipient(recipientId: string): Promise<NotificationSnapshot[]> {
    await this.requireUser(recipientId);
    const notifications = await this.repository.listByOwner('notification', recipientId);
    return notifications
      .filter((notification) => belongsToRecipient(notification, recipientId))
      .map(toSnapshot)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async markRead(recipientId: string, notificationId: string): Promise<NotificationSnapshot> {
    await this.requireUser(recipientId);
    const current = await this.repository.findById('notification', notificationId);
    if (!current || !belongsToRecipient(current, recipientId)) {
      throw new DomainError('NOT_FOUND', 'Notifikasi tidak ditemukan.');
    }
    if (typeof current.payload.readAt === 'string') return toSnapshot(current);

    const readAt = this.now().toISOString();
    const updated: DomainEntity = {
      ...current,
      payload: { ...current.payload, readAt },
      updatedAt: readAt,
      version: current.version + 1,
    };
    try {
      await this.repository.update(updated, current.version);
      return toSnapshot(updated);
    } catch (cause) {
      if (!(cause instanceof DomainError) || cause.code !== 'VERSION_CONFLICT') throw cause;
      const latest = await this.repository.findById('notification', notificationId);
      if (latest && belongsToRecipient(latest, recipientId) && typeof latest.payload.readAt === 'string') {
        return toSnapshot(latest);
      }
      throw cause;
    }
  }

  private async requireUser(recipientId: string): Promise<void> {
    const user = await this.repository.findById('user', recipientId);
    if (!user) throw new DomainError('NOT_FOUND', 'Akun tidak ditemukan.');
  }
}

function belongsToRecipient(notification: DomainEntity, recipientId: string): boolean {
  return notification.kind === 'notification'
    && notification.ownerId === recipientId
    && notification.payload.recipientId === recipientId;
}

function toSnapshot(notification: DomainEntity): NotificationSnapshot {
  const payload = notification.payload;
  const contextId = notification.contextId ?? stringValue(payload.contextId);
  return {
    id: notification.id,
    recipientId: stringValue(payload.recipientId) ?? notification.ownerId ?? '',
    eventId: stringValue(payload.eventId) ?? '',
    type: stringValue(payload.type) ?? 'informasi',
    contextId,
    title: stringValue(payload.title) ?? 'Pembaruan VetLink',
    body: stringValue(payload.body) ?? '',
    readAt: stringValue(payload.readAt),
    deliveryStatus: stringValue(payload.deliveryStatus) ?? 'sent',
    createdAt: notification.createdAt,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}
