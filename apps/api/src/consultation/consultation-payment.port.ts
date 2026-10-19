import type { PoolClient } from 'pg';

export const CONSULTATION_PAYMENT_SUCCEEDED = Symbol('CONSULTATION_PAYMENT_SUCCEEDED');

export interface ConsultationPaymentSucceededPort {
  handlePaymentSucceeded(client: PoolClient, payment: {
    id: string;
    ownerId: string;
    payableType: string;
    payableId: string;
    amountIdr: number;
    callbackEventId: string;
  }): Promise<void>;
}
