import type {
  ApiNotification, ApiNotificationContext, ApiNotificationPreferences, ApiNotificationsRepository,
} from '../../application/ports/ApiNotificationsRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const categories = ['consultations', 'reminders', 'commerce'] as const;
const contexts = ['follow_up', 'progress_report', 'reminder'] as const;
const deliveryStatuses = ['pending', 'sent', 'failed', 'suppressed'] as const;

/** BE-14 inbox and preferences; the backend scopes recipient and active-role links. */
export class HttpApiNotificationsRepository implements ApiNotificationsRepository {
  constructor(private readonly api: ApiClient) {}

  async list() {
    const value = await this.api.request<unknown>('/v1/me/notifications');
    if (!isRecord(value) || !Array.isArray(value.items) || !nonnegativeInt(value.unreadCount))
      throw invalidResponse('Kotak masuk tidak sesuai kontrak BE-14.');
    const items = value.items.map(parseNotification);
    if (value.unreadCount !== items.filter((item) => item.readAt === null).length)
      throw invalidResponse('Jumlah notifikasi belum dibaca tidak cocok.');
    return { items, unreadCount: value.unreadCount };
  }

  async markRead(notificationId: string) {
    if (!isUuid(notificationId)) throw invalidQuery('ID notifikasi server harus UUID.');
    const value = await this.api.request<unknown>(`/v1/me/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'POST',
    });
    if (!isRecord(value) || !isUuid(value.contextId) || !member(value.contextType, contexts))
      throw invalidResponse('Konteks notifikasi tidak dapat dibuka.');
    const notification = parseNotification(value.notification);
    if (notification.id !== notificationId || notification.readAt === null
      || notification.contextId !== value.contextId || notification.contextType !== value.contextType)
      throw invalidResponse('Status baca notifikasi tidak sesuai konteks.');
    return { notification, contextId: value.contextId, contextType: value.contextType as ApiNotificationContext };
  }

  async getPreferences(): Promise<ApiNotificationPreferences> {
    return parsePreferences(await this.api.request<unknown>('/v1/me/preferences'));
  }

  async patchPreferences(patch: { enabled?: boolean; notifications?: Partial<Record<(typeof categories)[number], boolean>> }): Promise<ApiNotificationPreferences> {
    if (!isRecord(patch) || (patch.enabled !== undefined && typeof patch.enabled !== 'boolean')
      || (patch.notifications !== undefined && !isRecord(patch.notifications)))
      throw invalidQuery('Preferensi notifikasi tidak valid.');
    const notifications: Partial<Record<(typeof categories)[number], boolean>> = {};
    if (patch.notifications) {
      for (const category of categories) {
        const value = patch.notifications[category];
        if (value !== undefined) {
          if (typeof value !== 'boolean') throw invalidQuery('Nilai kategori notifikasi harus boolean.');
          notifications[category] = value;
        }
      }
    }
    if (patch.enabled === undefined && Object.keys(notifications).length === 0)
      throw invalidQuery('Pilih setidaknya satu preferensi.');
    const body = { ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(Object.keys(notifications).length === 0 ? {} : { notifications }) };
    return parsePreferences(await this.api.request<unknown>('/v1/me/preferences', { method: 'PATCH', body }));
  }
}

function member<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === 'string' && (choices as readonly string[]).includes(value);
}
function nonnegativeInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nullableUuid(value: unknown): value is string | null { return value === null || isUuid(value); }
function nullableTimestamp(value: unknown): value is string | null { return value === null || isIsoTimestampWithTimezone(value); }

function parseNotification(value: unknown): ApiNotification {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.actorId) || !isUuid(value.recipientId)
    || !isNonEmptyText(value.type, 120) || !member(value.category, categories)
    || !member(value.contextType, contexts) || !nullableUuid(value.contextId)
    || !isNonEmptyText(value.eventId, 300) || !isNonEmptyText(value.title, 300)
    || !isNonEmptyText(value.body, 2000) || !nullableTimestamp(value.readAt)
    || !member(value.deliveryStatus, deliveryStatuses) || !isIsoTimestampWithTimezone(value.createdAt))
    throw invalidResponse('Notifikasi tidak sesuai kontrak BE-14.');
  return value as unknown as ApiNotification;
}

function parsePreferences(value: unknown): ApiNotificationPreferences {
  if (!isRecord(value) || !isUuid(value.userId) || typeof value.enabled !== 'boolean'
    || !isRecord(value.notifications) || !nonnegativeInt(value.version)
    || !isIsoTimestampWithTimezone(value.updatedAt)
    || !categories.every((category) => typeof (value.notifications as Record<string, unknown>)[category] === 'boolean'))
    throw invalidResponse('Preferensi tidak sesuai kontrak BE-14.');
  return { userId: value.userId, enabled: value.enabled,
    notifications: { consultations: value.notifications.consultations as boolean,
      reminders: value.notifications.reminders as boolean, commerce: value.notifications.commerce as boolean },
    version: value.version, updatedAt: value.updatedAt };
}
