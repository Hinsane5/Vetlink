import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG, loadAppConfig } from '../config/app-config.js';
import { NotificationDeliveryAdapter, LocalNotificationDeliveryAdapter, NOTIFICATION_DELIVERY_ADAPTER } from './notification-delivery.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    { provide: NOTIFICATION_DELIVERY_ADAPTER, useClass: LocalNotificationDeliveryAdapter },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
