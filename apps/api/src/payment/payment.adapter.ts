import { Injectable } from '@nestjs/common';
import { adapterPending, type AdapterResult } from '../communication/adapter-result.js';

export const PAYMENT_SERVICE = Symbol('PAYMENT_SERVICE');
export type PaymentOutcome = 'pending' | 'succeeded' | 'failed';
export interface PaymentService {
  start(paymentId: string, attemptId: string, amountIdr: number, method: string): Promise<AdapterResult<{ reference: string }>>;
}

/** Local-only adapter: it creates a reference but never claims that money moved. */
@Injectable()
export class LocalPaymentService implements PaymentService {
  async start(paymentId: string, attemptId: string, _amountIdr: number, _method: string) {
    return adapterPending({ reference: `local:${paymentId}:${attemptId}` });
  }
}
