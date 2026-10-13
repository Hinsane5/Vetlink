import type { CheckoutAddressSnapshot } from '../../domain/commerce';

export type ShippingQuoteResult =
  | { outcome: 'succeeded'; amount: number; label: string }
  | { outcome: 'failed'; code: string; message: string; retryable: boolean };

/** Adapter boundary for a local shipping rule now and an API adapter later. */
export interface ShippingQuoteProvider {
  quote(address: CheckoutAddressSnapshot): Promise<ShippingQuoteResult>;
}
