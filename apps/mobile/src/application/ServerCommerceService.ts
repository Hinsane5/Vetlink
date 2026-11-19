import type { AccountRole } from '../domain/auth';
import type { CatalogProduct } from '../domain/catalog';
import { DomainError } from '../domain/errors';
import type { ApiCart, ApiCheckoutQuote, ApiCommerceRepository, ApiOrder, ApiOrderShipment } from './ports/ApiCommerceRepository';
import type { CatalogReadQuery, CatalogReadRepository } from './ports/CatalogReadRepository';
import type { ApiAddressRecord, FarmReadRepository } from './ports/FarmReadRepository';

export interface PendingServerOrder {
  quoteId: string;
  idempotencyKey: string;
}

export interface PendingServerOrderStore {
  read(userId: string): Promise<PendingServerOrder | null>;
  write(userId: string, operation: PendingServerOrder): Promise<void>;
  clear(userId: string): Promise<void>;
}

/** BE-10/11/12 use cases; prices, addresses and order ownership remain server-scoped. */
export class ServerCommerceService {
  constructor(
    private readonly catalog: CatalogReadRepository,
    private readonly commerce: ApiCommerceRepository,
    private readonly farms: FarmReadRepository,
    private readonly pending: PendingServerOrderStore,
  ) {}

  listProducts(role: AccountRole, query: CatalogReadQuery = {}) {
    requireFarmer(role);
    return this.catalog.search(query);
  }

  getProduct(role: AccountRole, productId: string): Promise<CatalogProduct> {
    requireFarmer(role);
    return this.catalog.getById(productId);
  }

  async getCart(role: AccountRole, userId: string): Promise<ApiCart> {
    requireFarmer(role);
    return assertCartOwner(await this.commerce.getCart(), userId);
  }

  async setQuantity(role: AccountRole, userId: string, productId: string, quantity: number): Promise<ApiCart> {
    requireFarmer(role);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      throw new DomainError('VALIDATION_FAILED', 'Jumlah produk harus bilangan bulat positif.');
    }
    const cart = assertCartOwner(await this.commerce.getCart(), userId);
    const saved = await this.commerce.setCartItem(productId, quantity, cart.version);
    return assertCartOwner(saved, userId);
  }

  async removeItem(role: AccountRole, userId: string, productId: string): Promise<ApiCart> {
    requireFarmer(role);
    const cart = assertCartOwner(await this.commerce.getCart(), userId);
    const saved = await this.commerce.removeCartItem(productId, cart.version);
    return assertCartOwner(saved, userId);
  }

  async getAddresses(role: AccountRole): Promise<ApiAddressRecord[]> {
    requireFarmer(role);
    return this.farms.listAddresses();
  }

  async createQuote(role: AccountRole, userId: string, addressId: string): Promise<ApiCheckoutQuote> {
    requireFarmer(role);
    const [cart, address] = await Promise.all([
      this.commerce.getCart().then((value) => assertCartOwner(value, userId)),
      this.farms.getAddressById(addressId),
    ]);
    if (!cart.items.length || cart.hasUnavailableItems) throw new DomainError('INVALID_STATE', 'Keranjang kosong atau memuat produk yang tidak tersedia.');
    if (address.id !== addressId) throw new DomainError('API_RESPONSE_INVALID', 'Alamat server tidak sesuai pilihan.');
    const quote = await this.commerce.createQuote(addressId);
    if (quote.addressId !== addressId || quote.addressSnapshot.id !== addressId || quote.cartVersion !== cart.version
      || quote.items.length !== cart.items.length || quote.currency !== 'IDR'
      || quote.items.some((line) => !cart.items.some((item) => item.productId === line.productId && item.quantity === line.quantity))) {
      throw new DomainError('API_RESPONSE_INVALID', 'Quote checkout tidak cocok dengan keranjang atau alamat yang dipilih.');
    }
    return quote;
  }

  async createOrder(role: AccountRole, userId: string, quote: ApiCheckoutQuote): Promise<ApiOrder> {
    requireFarmer(role);
    if (!isUuid(quote?.id) || quote.addressId !== quote.addressSnapshot.id || quote.currency !== 'IDR'
      || !quote.items.length || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) {
      throw new DomainError('INVALID_STATE', 'Quote checkout tidak valid atau sudah kedaluwarsa. Buat quote baru untuk meninjau total.');
    }
    const existing = await this.pending.read(userId);
    if (existing && existing.quoteId !== quote.id) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Pulihkan pesanan yang belum pasti sebelum membuat pesanan baru.');
    }
    const operation = existing ?? { quoteId: quote.id, idempotencyKey: `order:${quote.id}` };
    await this.pending.write(userId, operation);
    return this.submitExact(userId, operation);
  }

  async retryPendingOrder(role: AccountRole, userId: string): Promise<ApiOrder> {
    requireFarmer(role);
    const operation = await this.pending.read(userId);
    if (!operation) throw new DomainError('NOT_FOUND', 'Tidak ada pesanan yang perlu dipulihkan.');
    return this.submitExact(userId, operation);
  }

  async getPendingOrder(role: AccountRole, userId: string): Promise<PendingServerOrder | null> {
    requireFarmer(role);
    return this.pending.read(userId);
  }

  async listOrders(role: AccountRole, query: { cursor?: string; limit?: number } = {}) {
    requireFarmer(role);
    return this.commerce.listOrders(query);
  }

  async getOrder(role: AccountRole, orderId: string): Promise<ApiOrder> {
    requireFarmer(role);
    const order = await this.commerce.getOrder(orderId);
    if (order.id !== orderId) throw new DomainError('API_RESPONSE_INVALID', 'Pesanan server tidak cocok dengan pilihan.');
    return order;
  }

  async getShipment(role: AccountRole, orderId: string): Promise<ApiOrderShipment> {
    requireFarmer(role);
    const shipment = await this.commerce.getShipment(orderId);
    if (shipment.orderId !== orderId) throw new DomainError('API_RESPONSE_INVALID', 'Timeline pengiriman server tidak cocok dengan pesanan.');
    return shipment;
  }

  private async submitExact(userId: string, operation: PendingServerOrder): Promise<ApiOrder> {
    try {
      const result = await this.commerce.createOrder(operation.quoteId, operation.idempotencyKey);
      const order = result.order;
      if (order.checkoutQuoteId !== operation.quoteId || !isUuid(order.id)
        || (!result.replayed && (order.status !== 'awaiting_payment' || order.paymentId !== null))) {
        throw new DomainError('API_RESPONSE_INVALID', 'Pesanan server tidak cocok dengan quote atau status awal.');
      }
      await this.pending.clear(userId);
      return order;
    } catch (cause) {
      if (cause instanceof DomainError && isDefinitiveRejection(cause.code)) await this.pending.clear(userId);
      throw cause;
    }
  }
}

function requireFarmer(role: AccountRole): void {
  if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Marketplace dan pesanan hanya tersedia untuk Peternak.');
}

function assertCartOwner(cart: ApiCart, userId: string): ApiCart {
  if (!cart || cart.farmerId !== userId) throw new DomainError('FORBIDDEN', 'Keranjang tidak terkait dengan Peternak aktif.');
  return cart;
}

function isDefinitiveRejection(code: DomainError['code']): boolean {
  return code === 'FORBIDDEN' || code === 'INVALID_STATE' || code === 'VALIDATION_FAILED'
    || code === 'VERSION_CONFLICT' || code === 'NOT_FOUND' || code === 'SESSION_INVALID';
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
