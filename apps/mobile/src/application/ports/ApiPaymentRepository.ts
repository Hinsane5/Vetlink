import type { PaymentMethod, PayableType } from '../PaymentService';

export interface ApiPaymentQuote {
  payableType: PayableType;
  payableId: string;
  amountIdr: number;
  currency: 'IDR';
}

export interface ApiPaymentRecord {
  id: string;
  payableType: PayableType;
  payableId: string;
  amountIdr: number;
  currency: 'IDR';
  status: 'pending' | 'succeeded' | 'failed';
  attempt: {
    id: string | null;
    status: 'pending' | 'succeeded' | 'failed';
    reference: string | null;
  };
}

export interface ApiPaymentRepository {
  getQuote(payableType: PayableType, payableId: string): Promise<ApiPaymentQuote>;
  create(input: { payableType: PayableType; payableId: string; method: PaymentMethod }, idempotencyKey: string): Promise<ApiPaymentRecord>;
}
