import type { IdFactory } from './ports/AuthRepository';
import type { CommerceRepository } from './ports/CommerceRepository';
import type { ProfileRepository } from './ports/ProfileRepository';
import type { ShippingQuoteProvider } from './ports/ShippingQuoteProvider';
import type { ShipmentStatusProvider } from './ports/ShipmentStatusProvider';
import { toCatalogProduct } from '../domain/catalog';
import {
  addressSnapshotFromEntity,
  calculateSubtotal,
  validateCheckoutAddress,
  type CartLine,
  type CartLineSnapshot,
  type CartSnapshot,
  type CheckoutAddressInput,
  type CheckoutAddressSnapshot,
  type CheckoutQuoteSnapshot,
  type OrderItemSnapshot,
  type OrderSnapshot,
} from '../domain/commerce';
import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityKind, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';

const quoteLifetimeMs = 15 * 60 * 1000;

export interface CreateCheckoutQuoteInput {
  addressId?: string | null;
  address?: Partial<CheckoutAddressInput>;
}

export class CommerceService {
  constructor(
    private readonly storage: CommerceRepository,
    private readonly profiles: ProfileRepository,
    private readonly shipping: ShippingQuoteProvider,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
    private readonly shipmentStatus?: ShipmentStatusProvider,
  ) {}

  async listOrders(userId: string, role: AccountRole): Promise<OrderSnapshot[]> {
    await this.assertFarmer(userId, role);
    const orders = await this.storage.read.listByOwner('order', userId);
    const snapshots = await Promise.all(orders.map((order) => this.orderSnapshot(this.storage.read, userId, order)));
    return snapshots.sort((left, right) => right.id.localeCompare(left.id));
  }

  async getOrder(userId: string, role: AccountRole, orderId: string): Promise<OrderSnapshot> {
    await this.assertFarmer(userId, role);
    const order = await this.storage.read.findById('order', orderId);
    if (!order || order.ownerId !== userId || order.payload.farmerId !== userId) throw new DomainError('NOT_FOUND', 'Pesanan tidak ditemukan.');
    return this.orderSnapshot(this.storage.read, userId, order);
  }

  async getCart(userId: string, role: AccountRole): Promise<CartSnapshot> {
    await this.assertFarmer(userId, role);
    return this.loadCart(this.storage.read, userId);
  }

  async addItem(userId: string, role: AccountRole, productId: string): Promise<CartSnapshot> {
    await this.assertFarmer(userId, role);
    return this.storage.transaction(async (repository) => {
      const product = await this.activeProduct(repository, productId);
      const { cart, snapshot } = await this.cartForWrite(repository, userId);
      const existing = snapshot.lines.find((line) => line.productId === product.id);
      const quantity = (existing?.quantity ?? 0) + 1;
      this.assertPositiveQuantity(quantity);
      if (existing) {
        const item = await repository.findById('cartItem', existing.cartItemId);
        if (!item || item.ownerId !== userId || item.payload.cartId !== cart.id) {
          throw new DomainError('FORBIDDEN', 'Item keranjang tidak dapat diakses.');
        }
        await repository.update({
          ...item,
          version: item.version + 1,
          updatedAt: this.timestamp(),
          payload: { ...item.payload, quantity },
        }, item.version);
      } else {
        const item = this.entity('cartItem', this.ids.create(), userId, cart.id, {
          cartId: cart.id,
          productId: product.id,
          quantity,
        });
        await repository.create(item, cartItemRelations(item.id, cart.id, product.id));
      }
      await this.updateCartCount(repository, cart, snapshot.itemCount + Number(!existing));
      return this.loadCart(repository, userId);
    });
  }

  async setQuantity(userId: string, role: AccountRole, productId: string, quantity: number): Promise<CartSnapshot> {
    await this.assertFarmer(userId, role);
    this.assertPositiveQuantity(quantity);
    return this.storage.transaction(async (repository) => {
      const product = await this.activeProduct(repository, productId);
      const { cart, snapshot } = await this.cartForWrite(repository, userId);
      const current = snapshot.lines.find((line) => line.productId === product.id);
      if (!current) throw new DomainError('NOT_FOUND', 'Produk tidak ada di keranjang.');
      if (current.quantity === quantity) return snapshot;
      const item = await repository.findById('cartItem', current.cartItemId);
      if (!item || item.ownerId !== userId || item.payload.cartId !== cart.id) {
        throw new DomainError('FORBIDDEN', 'Item keranjang tidak dapat diakses.');
      }
      await repository.update({
        ...item,
        version: item.version + 1,
        updatedAt: this.timestamp(),
        payload: { ...item.payload, quantity },
      }, item.version);
      return this.loadCart(repository, userId);
    });
  }

  async removeItem(userId: string, role: AccountRole, productId: string): Promise<CartSnapshot> {
    await this.assertFarmer(userId, role);
    return this.storage.transaction(async (repository) => {
      const { cart, snapshot } = await this.cartForWrite(repository, userId);
      if (!cart) throw new DomainError('NOT_FOUND', 'Keranjang belum memiliki item.');
      const line = snapshot.lines.find((item) => item.productId === productId);
      if (!line) throw new DomainError('NOT_FOUND', 'Produk tidak ada di keranjang.');
      await repository.delete('cartItem', line.cartItemId, (await repository.findById('cartItem', line.cartItemId))?.version ?? 0);
      await this.updateCartCount(repository, cart, Math.max(0, snapshot.itemCount - 1));
      return this.loadCart(repository, userId);
    });
  }

  async listAddresses(userId: string, role: AccountRole): Promise<CheckoutAddressSnapshot[]> {
    await this.assertFarmer(userId, role);
    const records = await this.storage.read.listByOwner('address', userId);
    const result: CheckoutAddressSnapshot[] = [];
    for (const record of records) {
      try {
        result.push(addressSnapshotFromEntity(record));
      } catch {
        // Incomplete profile addresses remain editable through the checkout form.
      }
    }
    return result.sort((left, right) => left.label.localeCompare(right.label, 'id-ID') || left.id.localeCompare(right.id));
  }

  async createQuote(userId: string, role: AccountRole, input: CreateCheckoutQuoteInput): Promise<CheckoutQuoteSnapshot> {
    await this.assertFarmer(userId, role);
    const initialCart = await this.loadCart(this.storage.read, userId);
    this.assertCheckoutReady(initialCart);
    const initialLines = cartLineSnapshots(initialCart.lines);
    const subtotal = calculateSubtotal(initialLines);
    const savedAddress = input.addressId ? await this.ownedAddress(this.storage.read, userId, input.addressId) : null;
    const newAddress = savedAddress ? null : validateCheckoutAddress(input.address ?? {});
    const addressId = savedAddress?.id ?? this.ids.create();
    const addressValues = savedAddress ? addressSnapshotFromEntity(savedAddress) : { id: addressId, ...newAddress! };
    const shipping = await this.shipping.quote(addressValues);
    if (shipping.outcome === 'failed') {
      throw new DomainError('INVALID_STATE', shipping.message);
    }
    if (!Number.isSafeInteger(shipping.amount) || shipping.amount < 0 || !shipping.label.trim()) {
      throw new DomainError('INVALID_STATE', 'Estimasi ongkir mengembalikan nilai yang tidak valid.');
    }
    const totalAmount = subtotal + shipping.amount;
    if (!Number.isSafeInteger(totalAmount)) throw new DomainError('VALIDATION_FAILED', 'Total pesanan melebihi batas hitung.');

    const quoteId = this.ids.create();
    const timestamp = this.now();
    const expiresAt = new Date(timestamp.getTime() + quoteLifetimeMs).toISOString();
    await this.storage.transaction(async (repository) => {
      const currentCart = await this.loadCart(repository, userId);
      this.assertSameCart(initialCart, currentCart);
      let addressVersion = 1;
      if (savedAddress) {
        const currentAddress = await this.ownedAddress(repository, userId, addressId);
        if (currentAddress.version !== savedAddress.version
          || !same(addressSnapshotFromEntity(currentAddress), addressValues)) {
          throw new DomainError('VERSION_CONFLICT', 'Alamat berubah. Tinjau alamat dan ongkir kembali.');
        }
        addressVersion = currentAddress.version;
      } else {
        const address = this.entity('address', addressId, userId, null, addressPayload(newAddress!));
        await repository.create(address);
      }
      const quote = this.entity('quote', quoteId, userId, initialCart.cartId, {
        context: 'cart',
        cartId: initialCart.cartId,
        addressId,
        addressVersion,
        addressSnapshot: addressValues,
        lines: initialLines,
        subtotal,
        shippingAmount: shipping.amount,
        shippingLabel: shipping.label.trim(),
        totalAmount,
        expiresAt,
      });
      await repository.create(quote, [{ sourceId: quote.id, targetId: addressId, relationship: 'address' }]);
    });
    return {
      id: quoteId,
      cartId: initialCart.cartId!,
      address: addressValues,
      lines: initialLines,
      subtotal,
      shippingAmount: shipping.amount,
      shippingLabel: shipping.label.trim(),
      totalAmount,
      expiresAt,
    };
  }

  async submitOrder(userId: string, role: AccountRole, quoteId: string): Promise<OrderSnapshot> {
    await this.assertFarmer(userId, role);
    return this.storage.transaction(async (repository) => {
      const operationKey = `checkout:${quoteId}`;
      const existing = (await repository.listByOwner('order', userId))
        .find((order) => order.payload.operationKey === operationKey);
      if (existing) return this.orderSnapshot(repository, userId, existing);

      const quote = await repository.findById('quote', quoteId);
      if (!quote) throw new DomainError('NOT_FOUND', 'Ringkasan checkout tidak ditemukan.');
      if (quote.ownerId !== userId || quote.payload.context !== 'cart') {
        throw new DomainError('FORBIDDEN', 'Ringkasan checkout bukan milik akun ini.');
      }
      const expiresAt = Date.parse(String(quote.payload.expiresAt ?? ''));
      if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
        throw new DomainError('INVALID_STATE', 'Ringkasan checkout kedaluwarsa. Buat ringkasan baru.');
      }
      const quotedLines = parseQuoteLines(quote.payload.lines);
      const quotedSubtotal = calculateSubtotal(quotedLines);
      const shippingAmount = quote.payload.shippingAmount;
      const totalAmount = quote.payload.totalAmount;
      if (typeof shippingAmount !== 'number' || !Number.isSafeInteger(shippingAmount) || shippingAmount < 0
        || typeof totalAmount !== 'number' || !Number.isSafeInteger(totalAmount) || totalAmount !== quotedSubtotal + shippingAmount) {
        throw new DomainError('INVALID_STATE', 'Ringkasan checkout tidak valid. Buat ringkasan baru.');
      }

      const cart = await this.loadCart(repository, userId);
      this.assertSameCartLines(quotedLines, cartLineSnapshots(cart.lines));
      const addressId = stringValue(quote.payload.addressId);
      const addressRecord = await this.ownedAddress(repository, userId, addressId);
      if (addressRecord.version !== quote.payload.addressVersion) {
        throw new DomainError('VERSION_CONFLICT', 'Alamat berubah setelah ringkasan dibuat. Tinjau alamat dan ongkir kembali.');
      }
      const address = addressSnapshotFromEntity(addressRecord);
      const savedAddressSnapshot = quote.payload.addressSnapshot as CheckoutAddressSnapshot | undefined;
      if (!savedAddressSnapshot || !same(address, savedAddressSnapshot)) {
        throw new DomainError('VERSION_CONFLICT', 'Alamat berubah setelah ringkasan dibuat. Tinjau alamat dan ongkir kembali.');
      }

      const orderId = this.ids.create();
      const order = this.entity('order', orderId, userId, quoteId, {
        operationKey,
        displayCode: `VL-O-${orderId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`,
        farmerId: userId,
        status: 'awaiting_payment',
        paymentId: null,
        quoteId,
        addressId,
        addressSnapshot: address,
        subtotalSnapshot: quotedSubtotal,
        shippingSnapshot: shippingAmount,
        totalSnapshot: totalAmount,
        currency: 'IDR',
      });
      await repository.create(order, [{ sourceId: order.id, targetId: addressId, relationship: 'address' }]);
      for (const line of quotedLines) {
        const itemId = this.ids.create();
        const item = this.entity('orderItem', itemId, userId, orderId, {
          orderId,
          cartItemId: line.cartItemId,
          productId: line.productId,
          nameSnapshot: line.nameSnapshot,
          categorySnapshot: line.categorySnapshot,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        });
        await repository.create(item, [
          { sourceId: item.id, targetId: orderId, relationship: 'order' },
          { sourceId: item.id, targetId: line.productId, relationship: 'product' },
        ]);
      }
      const cartRecords = cart.cartId ? await repository.listByRelated('cartItem', cart.cartId, 'cart') : [];
      for (const item of cartRecords) {
        if (item.ownerId !== userId || item.payload.cartId !== cart.cartId) {
          throw new DomainError('FORBIDDEN', 'Item keranjang tidak dapat dihapus.');
        }
        await repository.delete('cartItem', item.id, item.version);
      }
      const cartRecord = cart.cartId ? await repository.findById('cart', cart.cartId) : null;
      if (cartRecord) await this.updateCartCount(repository, cartRecord, 0);
      return this.orderSnapshot(repository, userId, order);
    });
  }

  private async assertFarmer(userId: string, role: AccountRole): Promise<void> {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Keranjang dan checkout hanya dapat diakses Peternak.');
    await this.profiles.loadProfile(userId, 'farmer');
  }

  private async activeProduct(repository: CommerceRepository['read'], productId: string): Promise<CatalogProductRecord> {
    const entity = await repository.findById('product', productId);
    if (!entity) throw new DomainError('NOT_FOUND', 'Produk tidak ditemukan di katalog.');
    const product = toCatalogProduct(entity);
    return { id: entity.id, name: product.name, category: product.category, unitPrice: product.unitPrice };
  }

  private async loadCart(repository: CommerceRepository['read'], userId: string): Promise<CartSnapshot> {
    const carts = await repository.listByOwner('cart', userId);
    if (carts.length > 1) throw new DomainError('INVALID_STATE', 'Akun memiliki lebih dari satu keranjang aktif.');
    const cart = carts[0] ?? null;
    if (!cart) return emptyCart();
    if (cart.ownerId !== userId || cart.payload.farmerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Keranjang bukan milik akun ini.');
    }
    const storedItems = await repository.listByRelated('cartItem', cart.id, 'cart');
    const lines: CartLine[] = [];
    let subtotal = 0;
    let quantityCount = 0;
    for (const item of storedItems) {
      if (item.ownerId !== userId || item.payload.cartId !== cart.id) {
        throw new DomainError('FORBIDDEN', 'Item keranjang bukan milik akun ini.');
      }
      const productId = stringValue(item.payload.productId);
      const quantity = item.payload.quantity;
      this.assertPositiveQuantity(quantity);
      const product = productId ? await repository.findById('product', productId) : null;
      if (!product || product.payload.active !== true) {
        lines.push({
          cartItemId: item.id,
          productId,
          name: product ? stringValue(product.payload.name) || 'Produk tidak tersedia' : 'Produk tidak tersedia',
          category: null,
          unitPrice: null,
          quantity,
          lineTotal: null,
          available: false,
        });
        quantityCount += quantity;
        continue;
      }
      const catalogProduct = toCatalogProduct(product);
      const lineTotal = catalogProduct.unitPrice * quantity;
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
        throw new DomainError('INVALID_STATE', 'Total keranjang melebihi batas hitung.');
      }
      subtotal += lineTotal;
      quantityCount += quantity;
      lines.push({
        cartItemId: item.id,
        productId,
        name: catalogProduct.name,
        category: catalogProduct.category,
        unitPrice: catalogProduct.unitPrice,
        quantity,
        lineTotal,
        available: true,
      });
    }
    return {
      cartId: cart.id,
      lines,
      subtotal,
      itemCount: lines.length,
      quantityCount,
      hasUnavailableItems: lines.some((line) => !line.available),
    };
  }

  private async cartForWrite(repository: CommerceRepository['read'], userId: string): Promise<{ cart: DomainEntity; snapshot: CartSnapshot }> {
    const carts = await repository.listByOwner('cart', userId);
    if (carts.length > 1) throw new DomainError('INVALID_STATE', 'Akun memiliki lebih dari satu keranjang aktif.');
    let cart = carts[0];
    if (!cart) {
      cart = this.entity('cart', this.ids.create(), userId, null, { farmerId: userId, itemCount: 0 });
      await repository.create(cart);
    }
    if (cart.ownerId !== userId || cart.payload.farmerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Keranjang bukan milik akun ini.');
    }
    return { cart, snapshot: await this.loadCart(repository, userId) };
  }

  private async updateCartCount(repository: CommerceRepository['read'], cart: DomainEntity, itemCount: number): Promise<void> {
    if (Number(cart.payload.itemCount) === itemCount) return;
    await repository.update({
      ...cart,
      version: cart.version + 1,
      updatedAt: this.timestamp(),
      payload: { ...cart.payload, itemCount },
    }, cart.version);
  }

  private async ownedAddress(repository: CommerceRepository['read'], userId: string, addressId: string): Promise<DomainEntity> {
    const address = await repository.findById('address', addressId);
    if (!address) throw new DomainError('NOT_FOUND', 'Alamat pengiriman tidak ditemukan.');
    if (address.ownerId !== userId) throw new DomainError('FORBIDDEN', 'Alamat pengiriman bukan milik akun ini.');
    return address;
  }

  private async orderSnapshot(repository: CommerceRepository['read'], userId: string, order: DomainEntity): Promise<OrderSnapshot> {
    if (order.kind !== 'order' || order.ownerId !== userId || order.payload.farmerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Pesanan bukan milik akun ini.');
    }
    const address = order.payload.addressSnapshot as CheckoutAddressSnapshot | undefined;
    if (!address) throw new DomainError('INVALID_STATE', 'Snapshot alamat pesanan tidak tersedia.');
    const itemEntities = await repository.listByRelated('orderItem', order.id, 'order');
    const items: OrderItemSnapshot[] = itemEntities.map((item) => {
      if (item.ownerId !== userId || item.payload.orderId !== order.id) {
        throw new DomainError('FORBIDDEN', 'Item pesanan bukan milik akun ini.');
      }
      return {
        id: item.id,
        cartItemId: stringValue(item.payload.cartItemId),
        productId: stringValue(item.payload.productId),
        nameSnapshot: stringValue(item.payload.nameSnapshot),
        categorySnapshot: stringValue(item.payload.categorySnapshot),
        unitPrice: numberValue(item.payload.unitPrice),
        quantity: numberValue(item.payload.quantity),
        lineTotal: numberValue(item.payload.lineTotal),
      };
    });
    const storedStatus = order.payload.status;
    if (!['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'].includes(String(storedStatus))) {
      throw new DomainError('INVALID_STATE', 'Status pesanan tidak valid.');
    }
    const paymentId = typeof order.payload.paymentId === 'string' ? order.payload.paymentId : null;
    const payment = paymentId ? await repository.findById('payment', paymentId) : null;
    const paymentStatus = payment && payment.ownerId === userId && payment.payload.payableType === 'order'
      && payment.payload.payableId === order.id && payment.payload.amount === order.payload.totalSnapshot
      ? payment.payload.status : null;
    if (storedStatus !== 'awaiting_payment' && paymentStatus !== 'succeeded') {
      throw new DomainError('INVALID_STATE', 'Status berbayar memerlukan pembayaran sukses yang tertaut.');
    }
    if (storedStatus === 'awaiting_payment' && paymentStatus === 'succeeded') {
      throw new DomainError('INVALID_STATE', 'Pembayaran sukses belum tercermin pada status pesanan.');
    }
    const shipment = this.shipmentStatus ? await this.shipmentStatus.getForOrder(userId, order.id) : null;
    const status = storedStatus === 'awaiting_payment' ? 'awaiting_payment'
      : shipment && shipment.status !== 'failed' ? shipment.status : 'paid';
    return {
      id: order.id,
      displayCode: stringValue(order.payload.displayCode),
      status,
      paymentId,
      address,
      items,
      subtotal: numberValue(order.payload.subtotalSnapshot),
      shippingAmount: numberValue(order.payload.shippingSnapshot),
      totalAmount: numberValue(order.payload.totalSnapshot),
      paymentStatus: paymentStatus as OrderSnapshot['paymentStatus'],
      trackingCode: shipment?.trackingCode ?? null,
      shipmentEvents: shipment?.events ?? [],
    };
  }

  private assertCheckoutReady(cart: CartSnapshot): void {
    if (!cart.lines.length) throw new DomainError('INVALID_STATE', 'Keranjang masih kosong.');
    if (cart.hasUnavailableItems) throw new DomainError('INVALID_STATE', 'Hapus produk yang tidak tersedia sebelum melanjutkan checkout.');
  }

  private assertSameCart(initial: CartSnapshot, current: CartSnapshot): void {
    if (initial.cartId !== current.cartId) throw new DomainError('VERSION_CONFLICT', 'Keranjang berubah. Periksa kembali sebelum checkout.');
    this.assertSameCartLines(cartLineSnapshots(initial.lines), cartLineSnapshots(current.lines));
  }

  private assertSameCartLines(initial: readonly CartLineSnapshot[], current: readonly CartLineSnapshot[]): void {
    if (!same(initial, current)) {
      throw new DomainError('VERSION_CONFLICT', 'Harga atau isi keranjang berubah. Buat ringkasan checkout baru.');
    }
  }

  private assertPositiveQuantity(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new DomainError('VALIDATION_FAILED', 'Jumlah produk harus berupa bilangan bulat positif.');
    }
  }

  private entity(kind: EntityKind, id: string, ownerId: string | null, contextId: string | null, payload: Record<string, unknown>): DomainEntity {
    const timestamp = this.timestamp();
    return { id, kind, ownerId, contextId, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

interface CatalogProductRecord {
  id: string;
  name: string;
  category: string;
  unitPrice: number;
}

function cartLineSnapshots(lines: readonly CartLine[]): CartLineSnapshot[] {
  return lines.map((line) => {
    if (!line.available || line.unitPrice === null || line.lineTotal === null || !line.category) {
      throw new DomainError('INVALID_STATE', 'Hapus produk yang tidak tersedia sebelum checkout.');
    }
    return {
      cartItemId: line.cartItemId,
      productId: line.productId,
      nameSnapshot: line.name,
      categorySnapshot: line.category,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    };
  });
}

function parseQuoteLines(value: unknown): CartLineSnapshot[] {
  if (!Array.isArray(value)) throw new DomainError('INVALID_STATE', 'Item pada ringkasan checkout tidak valid.');
  return value.map((line) => {
    if (!line || typeof line !== 'object') throw new DomainError('INVALID_STATE', 'Item pada ringkasan checkout tidak valid.');
    const raw = line as Record<string, unknown>;
    const snapshot: CartLineSnapshot = {
      cartItemId: stringValue(raw.cartItemId),
      productId: stringValue(raw.productId),
      nameSnapshot: stringValue(raw.nameSnapshot),
      categorySnapshot: stringValue(raw.categorySnapshot),
      unitPrice: numberValue(raw.unitPrice),
      quantity: numberValue(raw.quantity),
      lineTotal: numberValue(raw.lineTotal),
    };
    if (!snapshot.cartItemId || !snapshot.productId || !snapshot.nameSnapshot || !snapshot.categorySnapshot) {
      throw new DomainError('INVALID_STATE', 'Item pada ringkasan checkout tidak valid.');
    }
    return snapshot;
  });
}

function cartItemRelations(itemId: string, cartId: string, productId: string): EntityRelation[] {
  return [
    { sourceId: itemId, targetId: cartId, relationship: 'cart' },
    { sourceId: itemId, targetId: productId, relationship: 'product' },
  ];
}

function addressPayload(address: CheckoutAddressInput): Record<string, unknown> {
  return { ...address };
}

function emptyCart(): CartSnapshot {
  return { cartId: null, lines: [], subtotal: 0, itemCount: 0, quantityCount: 0, hasUnavailableItems: false };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}
