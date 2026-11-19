import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type {
  ApiNotification, ApiNotificationCategory, ApiNotificationContext, ApiNotificationPreferences,
  ApiNotificationsRepository,
} from './ports/ApiNotificationsRepository';

export class ServerNotificationsService {
  constructor(private readonly notifications: ApiNotificationsRepository) {}

  async list(role: AccountRole): Promise<{ items: ApiNotification[]; unreadCount: number }> {
    this.requireAccountRole(role);
    const result = await this.notifications.list();
    const ids = new Set<string>();
    for (const item of result.items) {
      if (ids.has(item.id)) throw new DomainError('API_RESPONSE_INVALID', 'Kotak masuk server memuat ID notifikasi ganda.');
      ids.add(item.id);
    }
    if (result.unreadCount !== result.items.filter((item) => item.readAt === null).length)
      throw new DomainError('API_RESPONSE_INVALID', 'Jumlah notifikasi belum dibaca tidak cocok.');
    return result;
  }

  async markRead(role: AccountRole, notificationId: string): Promise<{ notification: ApiNotification; contextId: string; contextType: ApiNotificationContext }> {
    this.requireAccountRole(role);
    const result = await this.notifications.markRead(notificationId);
    if (result.notification.id !== notificationId || result.notification.readAt === null
      || result.notification.contextId !== result.contextId || result.notification.contextType !== result.contextType)
      throw new DomainError('API_RESPONSE_INVALID', 'Status baca notifikasi tidak cocok dengan konteks server.');
    return result;
  }

  async getPreferences(role: AccountRole): Promise<ApiNotificationPreferences> {
    this.requireAccountRole(role);
    return this.notifications.getPreferences();
  }

  async updatePreferences(role: AccountRole, patch: {
    enabled?: boolean;
    notifications?: Partial<Record<ApiNotificationCategory, boolean>>;
  }): Promise<ApiNotificationPreferences> {
    this.requireAccountRole(role);
    return this.notifications.patchPreferences(patch);
  }

  private requireAccountRole(role: AccountRole): void {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat mengakses notifikasi.');
  }
}
