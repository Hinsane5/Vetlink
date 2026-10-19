import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EarningsModule } from '../earnings/earnings.module.js';
import { CONSULTATION_ACTION_ADAPTER, PostgresConsultationActionAdapter } from './consultation-action.adapter.js';
import { ConsultationController } from './consultation.controller.js';
import { ConsultationService } from './consultation.service.js';
import { CONSULTATION_PAYMENT_SUCCEEDED } from './consultation-payment.port.js';

@Module({
  imports: [AuthModule, EarningsModule],
  controllers: [ConsultationController],
  providers: [
    ConsultationService,
    { provide: CONSULTATION_ACTION_ADAPTER, useClass: PostgresConsultationActionAdapter },
    { provide: CONSULTATION_PAYMENT_SUCCEEDED, useExisting: ConsultationService },
  ],
  exports: [CONSULTATION_PAYMENT_SUCCEEDED, ConsultationService],
})
export class ConsultationModule {}
