import type { PaymentMethod, PayableType } from '../PaymentService';

export interface ApiPaymentOperationInput {
  payableType: PayableType;
  payableId: string;
  method: PaymentMethod;
}

/** Stores only the retry key and attempt number, never a local payment outcome or balance. */
export interface ApiPaymentOperationStore {
  getOrCreate(input: ApiPaymentOperationInput, attemptNumber: number): Promise<string>;
}

/** Storage boundary for the retry journal; it contains no payment authority. */
export interface ApiPaymentOperationPersistence {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
