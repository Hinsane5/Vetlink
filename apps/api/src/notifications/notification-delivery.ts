import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { adapterFailed, adapterSucceeded, type AdapterResult } from '../communication/adapter-result.js';

export const NOTIFICATION_DELIVERY_ADAPTER = Symbol('NOTIFICATION_DELIVERY_ADAPTER');

export interface NotificationDeliveryAdapter {
  deliver(input: {
    notificationId: string;
    eventId: string;
    recipientId: string;
    type: string;
    attempt: number;
  }): Promise<AdapterResult<void>>;
}

/** Local adapter; it never contacts an external notification provider. */
@Injectable()
export class LocalNotificationDeliveryAdapter implements NotificationDeliveryAdapter {
  private failNextAttempt: boolean;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.failNextAttempt = config.notificationDeliveryFailFirstAttemptForTest;
  }

  async deliver(): Promise<AdapterResult<void>> {
    if (this.failNextAttempt) {
      this.failNextAttempt = false;
      return adapterFailed('LOCAL_NOTIFICATION_DELIVERY_UNAVAILABLE', 'Pengiriman notifikasi lokal sementara gagal.', true);
    }
    return adapterSucceeded(undefined);
  }
}
