import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { adapterFailed, adapterSucceeded, type AdapterResult } from '../communication/adapter-result.js';

export const REMINDER_DELIVERY_ADAPTER = Symbol('REMINDER_DELIVERY_ADAPTER');

export interface ReminderDeliveryAdapter {
  deliver(input: { reminderId: string; recipientId: string; dueAt: string; attempt: number }): Promise<AdapterResult<void>>;
}

/** Local adapter; it records an in-app reminder delivery result without contacting a provider. */
@Injectable()
export class LocalReminderDeliveryAdapter implements ReminderDeliveryAdapter {
  private failNextAttempt: boolean;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.failNextAttempt = config.reminderDeliveryFailFirstAttemptForTest;
  }

  async deliver(): Promise<AdapterResult<void>> {
    if (this.failNextAttempt) {
      this.failNextAttempt = false;
      return adapterFailed('LOCAL_REMINDER_DELIVERY_UNAVAILABLE', 'Pengiriman pengingat lokal sementara gagal.', true);
    }
    return adapterSucceeded(undefined);
  }
}
