import type {
  ApiCart, ApiCartItem, ApiCheckoutAddress, ApiCheckoutLine, ApiCheckoutQuote,
  ApiCommerceRepository, ApiOrder, ApiOrderCreation, ApiOrderShipment, ApiOrderStatus,
} from '../../application/ports/ApiCommerceRepository';
import { ApiClient } from './ApiClient';
import {
  invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid,
  parseReadPage, validateOpaqueCursor, validatePageLimit,
} from './apiReadValidation';

const orderStatuses = ['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'] as const;
const shipmentStatuses = ['pending', 'processing', 'shipped', 'delivered', 'failed'] as const;
const paymentStatuses = ['pending', 'succeeded', 'failed', 'expired'] as const;
const outcomes = ['pending', 'succeeded', 'failed'] as const;

/** BE-11/12 owner-scoped commerce adapter. The server computes all prices and shipping. */
export class HttpApiCommerceRepository implements ApiCommerceRepository {
  constructor(private readonly api: ApiClient) {}

  async getCart(): Promise<ApiCart> {
    return parseCart(await this.api.request<unknown>('/v1/me/cart'));
  }

  async setCartItem(productId: string, quantity: number, expectedVersion: number): Promise<ApiCart> {
    const id = resourceId(productId);
    if (!positiveInt(quantity) || quantity > 2147483647 || !positiveInt(expectedVersion) || expectedVersion > 2147483647)
      throw invalidQuery('Jumlah dan versi keranjang harus bilangan bulat positif.');
    const cart = parseCart(await this.api.request<unknown>(`/v1/me/cart/items/${id}`, {
      method: 'PUT', body: { quantity, expectedVersion },
    }));
    if (!cart.items.some((item) => item.productId === productId && item.quantity === quantity))
      throw invalidResponse('Produk belum tersimpan pada keranjang.');
    return cart;
  }

  async removeCartItem(productId: string, expectedVersion: number): Promise<ApiCart> {
    const id = resourceId(productId);
    if (!positiveInt(expectedVersion) || expectedVersion > 2147483647) throw invalidQuery('Versi keranjang tidak valid.');
    const cart = parseCart(await this.api.request<unknown>(`/v1/me/cart/items/${id}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }));
    if (cart.items.some((item) => item.productId === productId)) throw invalidResponse('Produk belum terhapus dari keranjang.');
    return cart;
  }

  async createQuote(addressId: string): Promise<ApiCheckoutQuote> {
    resourceId(addressId);
    const quote = parseQuote(await this.api.request<unknown>('/v1/checkout-quotes', {
      method: 'POST', body: { addressId },
    }));
    if (quote.addressId !== addressId) throw invalidResponse('Alamat quote tidak cocok.');
    return quote;
  }

  async createOrder(quoteId: string, idempotencyKey: string): Promise<ApiOrderCreation> {
    resourceId(quoteId);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(idempotencyKey)) throw invalidQuery('Idempotency-Key pesanan tidak valid.');
    const value = await this.api.request<unknown>('/v1/orders', {
      method: 'POST', idempotencyKey, body: { quoteId },
    });
    if (!isRecord(value) || !isUuid(value.operationId) || typeof value.replayed !== 'boolean')
      throw invalidResponse('Hasil pembuatan pesanan tidak sesuai kontrak BE-11.');
    const order = parseOrder(value.order);
    if (order.checkoutQuoteId !== quoteId) throw invalidResponse('Pesanan tidak cocok dengan quote.');
    if (!value.replayed && (order.status !== 'awaiting_payment' || order.paymentId !== null))
      throw invalidResponse('Pesanan baru harus menunggu pembayaran.');
    return { operationId: value.operationId, replayed: value.replayed, order };
  }

  async listOrders(query: { cursor?: string; limit?: number } = {}) {
    validateOpaqueCursor(query.cursor, 'pesanan');
    validatePageLimit(query.limit, 'pesanan');
    const params = new URLSearchParams();
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const path = `/v1/orders${params.size ? `?${params.toString()}` : ''}`;
    return parseReadPage(await this.api.request<unknown>(path), parseOrder, 'pesanan');
  }

  async getOrder(orderId: string): Promise<ApiOrder> {
    const order = parseOrder(await this.api.request<unknown>(`/v1/orders/${resourceId(orderId)}`));
    if (order.id !== orderId) throw invalidResponse('ID pesanan tidak cocok.');
    return order;
  }

  async getShipment(orderId: string): Promise<ApiOrderShipment> {
    const value = await this.api.request<unknown>(`/v1/orders/${resourceId(orderId)}/shipment`);
    if (!isRecord(value) || value.orderId !== orderId || !member(value.orderStatus, orderStatuses)
      || !Array.isArray(value.events)) throw invalidResponse('Timeline pengiriman tidak sesuai kontrak BE-12.');
    let shipment: ApiOrderShipment['shipment'] = null;
    if (value.shipment !== null) {
      const item = value.shipment;
      if (!isRecord(item) || !isUuid(item.id) || !member(item.status, shipmentStatuses)
        || !nullableText(item.trackingCode) || !positiveInt(item.version)) throw invalidResponse('Shipment tidak valid.');
      shipment = { id: item.id, status: item.status, trackingCode: item.trackingCode, version: item.version };
    }
    const events = value.events.map((raw: unknown) => {
      if (!isRecord(raw) || !isNonEmptyText(raw.id, 200) || !nullableText(raw.eventId)
        || !member(raw.type, ['order_created', 'payment_succeeded', 'shipment_adapter'] as const)
        || !member(raw.outcome, outcomes)
        || !(raw.orderStatus === null || member(raw.orderStatus, orderStatuses))
        || !(raw.shipmentStatus === null || member(raw.shipmentStatus, shipmentStatuses))
        || !nullableText(raw.trackingCode) || !isNonEmptyText(raw.description, 1000)
        || !isIsoTimestampWithTimezone(raw.occurredAt)) throw invalidResponse('Event pengiriman tidak valid.');
      return { id: raw.id, eventId: raw.eventId, type: raw.type, outcome: raw.outcome,
        orderStatus: raw.orderStatus, shipmentStatus: raw.shipmentStatus,
        trackingCode: raw.trackingCode, description: raw.description, occurredAt: raw.occurredAt };
    });
    return { orderId, orderStatus: value.orderStatus, shipment, events };
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID server harus UUID.');
  return encodeURIComponent(value);
}
function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }
function idr(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function nullableText(value: unknown): value is string | null { return value === null || isNonEmptyText(value, 200); }
function member<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === 'string' && (choices as readonly string[]).includes(value);
}
function safeSum(values: number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidResponse('Jumlah rupiah melebihi batas aman.');
  return Number(sum);
}

function parseCartItem(value: unknown): ApiCartItem {
  if (!isRecord(value) || !isUuid(value.productId) || !isNonEmptyText(value.name, 300)
    || !isNonEmptyText(value.category, 120) || !positiveInt(value.quantity)
    || typeof value.active !== 'boolean'
    || !(value.unitPriceIdr === null || (idr(value.unitPriceIdr) && value.unitPriceIdr > 0))
    || !(value.lineTotalIdr === null || idr(value.lineTotalIdr))
    || (value.active && (value.unitPriceIdr === null || value.lineTotalIdr !== value.unitPriceIdr * value.quantity))
    || (!value.active && (value.unitPriceIdr !== null || value.lineTotalIdr !== null)))
    throw invalidResponse('Item keranjang tidak valid.');
  return value as unknown as ApiCartItem;
}

function parseCart(value: unknown): ApiCart {
  if (!isRecord(value) || !(value.id === null || isUuid(value.id)) || !isUuid(value.farmerId)
    || !positiveInt(value.version) || value.currency !== 'IDR' || !Array.isArray(value.items)
    || !idr(value.subtotalIdr) || !idr(value.itemCount) || !idr(value.quantityCount)
    || typeof value.hasUnavailableItems !== 'boolean') throw invalidResponse('Keranjang tidak sesuai kontrak BE-11.');
  const items = value.items.map(parseCartItem);
  if (new Set(items.map((item) => item.productId)).size !== items.length
    || value.itemCount !== items.length
    || value.quantityCount !== safeSum(items.map((item) => item.quantity))
    || value.subtotalIdr !== safeSum(items.map((item) => item.lineTotalIdr ?? 0))
    || value.hasUnavailableItems !== items.some((item) => !item.active)) throw invalidResponse('Total keranjang tidak cocok.');
  return { id: value.id, farmerId: value.farmerId, version: value.version, currency: 'IDR', items,
    subtotalIdr: value.subtotalIdr, itemCount: value.itemCount, quantityCount: value.quantityCount,
    hasUnavailableItems: value.hasUnavailableItems };
}

function parseAddress(value: unknown): ApiCheckoutAddress {
  if (!isRecord(value) || !isUuid(value.id)
    || !isNonEmptyText(value.label, 200) || !isNonEmptyText(value.recipientName, 200)
    || !isNonEmptyText(value.phone, 100) || !isNonEmptyText(value.addressLine, 500)
    || !isNonEmptyText(value.city, 200) || !isNonEmptyText(value.province, 200)
    || !isNonEmptyText(value.postalCode, 20)) throw invalidResponse('Alamat snapshot tidak valid.');
  return value as unknown as ApiCheckoutAddress;
}

function parseLine(value: unknown): ApiCheckoutLine {
  if (!isRecord(value) || !isUuid(value.productId)
    || !isNonEmptyText(value.nameSnapshot, 300) || !isNonEmptyText(value.categorySnapshot, 120)
    || !idr(value.unitPriceIdr) || value.unitPriceIdr < 1 || !positiveInt(value.quantity)
    || !idr(value.lineTotalIdr) || value.lineTotalIdr !== value.unitPriceIdr * value.quantity)
    throw invalidResponse('Snapshot item pesanan tidak valid.');
  return value as unknown as ApiCheckoutLine;
}

function parseAmounts(value: Record<string, unknown>, items: ApiCheckoutLine[]) {
  if (!idr(value.subtotalIdr) || !idr(value.shippingAmountIdr) || !idr(value.totalIdr)
    || !isNonEmptyText(value.shippingLabel, 120) || value.currency !== 'IDR'
    || value.subtotalIdr !== safeSum(items.map((item) => item.lineTotalIdr))
    || value.totalIdr !== safeSum([value.subtotalIdr, value.shippingAmountIdr]))
    throw invalidResponse('Total rupiah pesanan tidak valid.');
  return { subtotalIdr: value.subtotalIdr, shippingAmountIdr: value.shippingAmountIdr,
    shippingLabel: value.shippingLabel, totalIdr: value.totalIdr, currency: 'IDR' as const };
}

function parseQuote(value: unknown): ApiCheckoutQuote {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.cartId)
    || !positiveInt(value.cartVersion) || !isUuid(value.addressId)
    || !Array.isArray(value.items) || !isIsoTimestampWithTimezone(value.expiresAt))
    throw invalidResponse('Quote checkout tidak sesuai kontrak BE-11.');
  const addressSnapshot = parseAddress(value.addressSnapshot);
  const items = value.items.map(parseLine);
  if (addressSnapshot.id !== value.addressId || items.length === 0) throw invalidResponse('Quote checkout tidak lengkap.');
  return { id: value.id, cartId: value.cartId, cartVersion: value.cartVersion,
    addressId: value.addressId, addressSnapshot, items, ...parseAmounts(value, items), expiresAt: value.expiresAt };
}

function parseOrder(value: unknown): ApiOrder {
  if (!isRecord(value) || !isUuid(value.id) || !isNonEmptyText(value.displayCode, 100)
    || !member(value.status, orderStatuses) || !isUuid(value.checkoutQuoteId)
    || !isUuid(value.addressId) || !Array.isArray(value.items)
    || !(value.paymentId === null || isUuid(value.paymentId))
    || !(value.paymentStatus === null || member(value.paymentStatus, paymentStatuses))
    || (value.paymentId === null) !== (value.paymentStatus === null)
    || !isIsoTimestampWithTimezone(value.createdAt) || !positiveInt(value.version))
    throw invalidResponse('Pesanan tidak sesuai kontrak BE-11.');
  const addressSnapshot = parseAddress(value.addressSnapshot);
  const items = value.items.map((raw: unknown) => {
    if (!isRecord(raw) || !isUuid(raw.id)) throw invalidResponse('ID item pesanan tidak valid.');
    return { ...parseLine(raw), id: raw.id };
  });
  if (addressSnapshot.id !== value.addressId || items.length === 0)
    throw invalidResponse('Snapshot pesanan tidak lengkap.');
  return { id: value.id, displayCode: value.displayCode, status: value.status as ApiOrderStatus,
    checkoutQuoteId: value.checkoutQuoteId, addressId: value.addressId, addressSnapshot, items,
    ...parseAmounts(value, items), paymentId: value.paymentId as string | null,
    paymentStatus: value.paymentStatus as ApiOrder['paymentStatus'], createdAt: value.createdAt,
    version: value.version };
}
