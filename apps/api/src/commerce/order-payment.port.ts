import type { PoolClient } from 'pg';

export const ORDER_PAYMENT_SUCCEEDED = Symbol('ORDER_PAYMENT_SUCCEEDED');

export interface OrderPaymentSucceededInput {
  id: string;
  ownerId: string;
  payableType: string;
  payableId: string;
  amountIdr: number;
  callbackEventId: string;
}

export interface OrderPaymentSucceededPort {
  handleOrderPaymentSucceeded(client: PoolClient, payment: OrderPaymentSucceededInput): Promise<void>;
}
