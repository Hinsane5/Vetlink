import type { ReadPage } from '../../data/remote/apiReadValidation';

export interface ApiCartItem {
  productId: string;
  name: string;
  category: string;
  unitPriceIdr: number | null;
  quantity: number;
  lineTotalIdr: number | null;
  active: boolean;
}

export interface ApiCart {
  id: string | null;
  farmerId: string;
  version: number;
  currency: 'IDR';
  items: ApiCartItem[];
  subtotalIdr: number;
  itemCount: number;
  quantityCount: number;
  hasUnavailableItems: boolean;
}

export interface ApiCheckoutAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface ApiCheckoutLine {
  productId: string;
  nameSnapshot: string;
  categorySnapshot: string;
  unitPriceIdr: number;
  quantity: number;
  lineTotalIdr: number;
}

export interface ApiCheckoutQuote {
  id: string;
  cartId: string;
  cartVersion: number;
  addressId: string;
  addressSnapshot: ApiCheckoutAddress;
  items: ApiCheckoutLine[];
  subtotalIdr: number;
  shippingAmountIdr: number;
  shippingLabel: string;
  totalIdr: number;
  currency: 'IDR';
  expiresAt: string;
}

export type ApiOrderStatus = 'awaiting_payment' | 'paid' | 'processing' | 'shipped' | 'delivered';
export interface ApiOrder extends Omit<ApiCheckoutQuote, 'id' | 'cartId' | 'cartVersion' | 'expiresAt' | 'items'> {
  id: string;
  displayCode: string;
  status: ApiOrderStatus;
  checkoutQuoteId: string;
  items: (ApiCheckoutLine & { id: string })[];
  paymentId: string | null;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'expired' | null;
  createdAt: string;
  version: number;
}

export interface ApiOrderCreation {
  operationId: string;
  replayed: boolean;
  order: ApiOrder;
}

export interface ApiOrderShipment {
  orderId: string;
  orderStatus: ApiOrderStatus;
  shipment: { id: string; status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'failed'; trackingCode: string | null; version: number } | null;
  events: {
    id: string;
    eventId: string | null;
    type: 'order_created' | 'payment_succeeded' | 'shipment_adapter';
    outcome: 'pending' | 'succeeded' | 'failed';
    orderStatus: ApiOrderStatus | null;
    shipmentStatus: 'pending' | 'processing' | 'shipped' | 'delivered' | 'failed' | null;
    trackingCode: string | null;
    description: string;
    occurredAt: string;
  }[];
}

export interface ApiCommerceRepository {
  getCart(): Promise<ApiCart>;
  setCartItem(productId: string, quantity: number, expectedVersion: number): Promise<ApiCart>;
  removeCartItem(productId: string, expectedVersion: number): Promise<ApiCart>;
  createQuote(addressId: string): Promise<ApiCheckoutQuote>;
  createOrder(quoteId: string, idempotencyKey: string): Promise<ApiOrderCreation>;
  listOrders(query?: { cursor?: string; limit?: number }): Promise<ReadPage<ApiOrder>>;
  getOrder(orderId: string): Promise<ApiOrder>;
  getShipment(orderId: string): Promise<ApiOrderShipment>;
}
