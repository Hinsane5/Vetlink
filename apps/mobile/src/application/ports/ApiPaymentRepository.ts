import type { PaymentMethod, PayableType } from '../PaymentService';

export interface ApiPaymentQuote {
  payableType: PayableType;
  payableId: string;
  amountIdr: number;
  currency: 'IDR';
}

export type ApiPaymentStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface ApiPaymentAttempt {
  id: string;
  attemptNumber: number;
  status: ApiPaymentStatus;
  reference: string | null;
  attemptedAt: string;
}

export interface ApiPaymentRecord {
  id: string;
  payableType: PayableType;
  payableId: string;
  amountIdr: number;
  currency: 'IDR';
  method: PaymentMethod;
  status: ApiPaymentStatus;
  attempt: {
    id: string | null;
    status: ApiPaymentStatus;
    reference: string | null;
  } | null;
  attempts: ApiPaymentAttempt[];
}

export interface ApiPaymentRepository {
  getQuote(payableType: PayableType, payableId: string): Promise<ApiPaymentQuote>;
  getForPayable(payableType: PayableType, payableId: string): Promise<ApiPaymentRecord | null>;
  getById(paymentId: string): Promise<ApiPaymentRecord>;
  getAttempts(paymentId: string): Promise<ApiPaymentAttempt[]>;
  create(input: { payableType: PayableType; payableId: string; method: PaymentMethod }, idempotencyKey: string): Promise<ApiPaymentRecord>;
}
