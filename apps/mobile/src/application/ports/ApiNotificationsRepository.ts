export type ApiNotificationCategory = 'consultations' | 'reminders' | 'commerce';
export type ApiNotificationContext = 'follow_up' | 'progress_report' | 'reminder';

export interface ApiNotification {
  id: string;
  actorId: string;
  recipientId: string;
  type: string;
  category: ApiNotificationCategory;
  contextType: ApiNotificationContext;
  contextId: string | null;
  eventId: string;
  title: string;
  body: string;
  readAt: string | null;
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'suppressed';
  createdAt: string;
}

export interface ApiNotificationPreferences {
  userId: string;
  enabled: boolean;
  notifications: Record<ApiNotificationCategory, boolean>;
  version: number;
  updatedAt: string;
}

export interface ApiNotificationsRepository {
  list(): Promise<{ items: ApiNotification[]; unreadCount: number }>;
  markRead(notificationId: string): Promise<{ notification: ApiNotification; contextId: string; contextType: ApiNotificationContext }>;
  getPreferences(): Promise<ApiNotificationPreferences>;
  patchPreferences(patch: { enabled?: boolean; notifications?: Partial<Record<ApiNotificationCategory, boolean>> }): Promise<ApiNotificationPreferences>;
}
