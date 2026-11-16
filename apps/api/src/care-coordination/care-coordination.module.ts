import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG, loadAppConfig } from '../config/app-config.js';
import { CareCoordinationController } from './care-coordination.controller.js';
import { CareCoordinationService } from './care-coordination.service.js';
import { LocalReminderDeliveryAdapter, REMINDER_DELIVERY_ADAPTER } from './reminder-delivery.js';

@Module({
  imports: [AuthModule],
  controllers: [CareCoordinationController],
  providers: [
    CareCoordinationService,
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    { provide: REMINDER_DELIVERY_ADAPTER, useClass: LocalReminderDeliveryAdapter },
  ],
})
export class CareCoordinationModule {}
