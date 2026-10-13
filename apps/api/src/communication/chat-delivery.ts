import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { adapterFailed, adapterPending, type AdapterResult } from './adapter-result.js';

export const CHAT_DELIVERY_ADAPTER = Symbol('CHAT_DELIVERY_ADAPTER');

export interface ChatDeliveryAdapter {
  deliver(messageId: string, attempt: number): Promise<AdapterResult<void>>;
}

/** A PostgreSQL-backed polling inbox; realtime and external messaging providers are not required. */
@Injectable()
export class LocalPollingChatDeliveryAdapter implements ChatDeliveryAdapter {
  private failNextAttempt: boolean;

  constructor(private readonly database: DatabaseService, @Inject(APP_CONFIG) config: AppConfig) {
    this.failNextAttempt = config.chatDeliveryFailFirstAttemptForTest;
  }

  async deliver(messageId: string, attempt: number): Promise<AdapterResult<void>> {
    if (this.failNextAttempt) {
      this.failNextAttempt = false;
      return adapterFailed('LOCAL_DELIVERY_UNAVAILABLE', 'Pengiriman pesan sementara gagal.', true);
    }

    const operationId = randomUUID();
    const occurredAt = new Date().toISOString();
    try {
      const result = await this.database.query(
        `UPDATE consultation_messages
         SET delivery_status = 'sent', sent_at = now(), updated_at = now()
         WHERE id = $1 AND delivery_attempt = $2 AND delivery_status = 'pending'
         RETURNING id`,
        [messageId, attempt],
      );
      if (result.rowCount === 1) return { operationId, status: 'succeeded', occurredAt, value: undefined };

      const current = await this.database.query<{ delivery_status: 'pending' | 'sent' | 'failed'; delivery_attempt: number }>(
        'SELECT delivery_status, delivery_attempt FROM consultation_messages WHERE id = $1',
        [messageId],
      );
      const row = current.rows[0];
      if (row?.delivery_status === 'sent') return { operationId, status: 'succeeded', occurredAt, value: undefined };
      if (row?.delivery_attempt !== attempt || row?.delivery_status === 'pending') return adapterPending(undefined);
      return adapterFailed('LOCAL_DELIVERY_UNAVAILABLE', 'Pengiriman pesan sementara gagal.', true);
    } catch {
      return adapterFailed('LOCAL_DELIVERY_UNAVAILABLE', 'Pengiriman pesan sementara gagal.', true);
    }
  }
}
