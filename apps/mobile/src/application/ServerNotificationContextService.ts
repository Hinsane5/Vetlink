import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiCareCoordinationRepository, ApiFollowUp, ApiProgressReport, ApiReminder } from './ports/ApiCareCoordinationRepository';
import type { ApiNotificationContext } from './ports/ApiNotificationsRepository';

export type ServerNotificationContext =
  | { type: 'follow_up'; resource: ApiFollowUp }
  | { type: 'progress_report'; resource: ApiProgressReport }
  | { type: 'reminder'; resource: ApiReminder };

/** Reads only the notification's server-authorized resource ID through BE-09. */
export class ServerNotificationContextService {
  constructor(private readonly care: ApiCareCoordinationRepository) {}

  async get(role: AccountRole, type: ApiNotificationContext, id: string): Promise<ServerNotificationContext> {
    if (role !== 'farmer' && role !== 'vet') throw new DomainError('FORBIDDEN', 'Peran akun tidak dapat membuka konteks notifikasi.');
    if (!id) throw new DomainError('VALIDATION_FAILED', 'ID konteks notifikasi tidak tersedia.');
    if (type === 'follow_up') {
      const resource = await this.care.getFollowUp(id);
      if (resource.id !== id) throw new DomainError('API_RESPONSE_INVALID', 'Tindak lanjut server tidak cocok dengan notifikasi.');
      return { type, resource };
    }
    if (type === 'progress_report') {
      const resource = await this.care.getProgressReport(id);
      if (resource.id !== id) throw new DomainError('API_RESPONSE_INVALID', 'Laporan server tidak cocok dengan notifikasi.');
      return { type, resource };
    }
    if (type === 'reminder') {
      const resource = await this.care.getReminder(id);
      if (resource.id !== id) throw new DomainError('API_RESPONSE_INVALID', 'Pengingat server tidak cocok dengan notifikasi.');
      return { type, resource };
    }
    throw new DomainError('API_RESPONSE_INVALID', 'Jenis konteks notifikasi tidak dikenal.');
  }
}
