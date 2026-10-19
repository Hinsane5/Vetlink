import type { PoolClient } from 'pg';

export const CONSULTATION_COMPLETION_EARNINGS = Symbol('CONSULTATION_COMPLETION_EARNINGS');

export interface ConsultationCompletionEarningsPort {
  createForCompletedConsultation(client: PoolClient, consultationId: string): Promise<string>;
  settleEarning(earningId: string): Promise<void>;
}
