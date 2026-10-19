import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CONSULTATION_COMPLETION_EARNINGS } from './earnings-completion.port.js';
import { EarningsController } from './earnings.controller.js';
import {
  EARNING_SETTLEMENT_ADAPTER,
  LocalEarningSettlementAdapter,
  LocalWithdrawalSubmissionAdapter,
  WITHDRAWAL_SUBMISSION_ADAPTER,
} from './earnings.adapter.js';
import { EarningsService } from './earnings.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EarningsController],
  providers: [
    EarningsService,
    { provide: EARNING_SETTLEMENT_ADAPTER, useFactory: () => new LocalEarningSettlementAdapter() },
    { provide: WITHDRAWAL_SUBMISSION_ADAPTER, useFactory: () => new LocalWithdrawalSubmissionAdapter() },
    { provide: CONSULTATION_COMPLETION_EARNINGS, useExisting: EarningsService },
  ],
  exports: [CONSULTATION_COMPLETION_EARNINGS, EarningsService],
})
export class EarningsModule {}
