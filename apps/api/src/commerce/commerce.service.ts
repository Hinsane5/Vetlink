import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import type { AdapterResult } from '../communication/adapter-result.js';
import { DatabaseService } from '../database/database.service.js';
import { CHECKOUT_SHIPPING_ADAPTER, type CheckoutShippingAdapter, type ShippingQuoteValue } from './shipping-quote.adapter.js';
import type { CreateCheckoutQuoteDto, CreateOrderDto, DeleteCartItemQueryDto, OrderListQueryDto, SetCartItemDto } from './commerce.dto.js';
import type { OrderPaymentSucceededInput, OrderPaymentSucceededPort } from './order-payment.port.js';

const maxIdr = BigInt(Number.MAX_SAFE_INTEGER);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OrderCursor {
  createdAt: string;
  id: string;
}

interface CartRow {
  id: string;
  farmer_id: string;
  version: number;
}

interface ProductLineRow {
  product_id: string;
  product_name: string;
  category: string;
  unit_price_idr: string;
  quantity: number;
  active: boolean;
}

interface AddressRow {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
  version: number;
}

interface QuoteRow {
  id: string;
  farmer_id: string;
  cart_id: string;
  cart_version: number;
  address_id: string;
  address_version: number;
  address_snapshot: AddressSnapshot;
  line_snapshots: LineSnapshot[];
  subtotal_snapshot_idr: string;
  shipping_snapshot_idr: string;
  shipping_label: string;
  shipping_adapter_operation_id: string;
  total_snapshot_idr: string;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface AddressSnapshot {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface LineSnapshot {
  productId: string;
  nameSnapshot: string;
  categorySnapshot: string;
  unitPriceIdr: number;
  quantity: number;
  lineTotalIdr: number;
}

type SuccessfulShippingResult = Extract<AdapterResult<ShippingQuoteValue>, { status: 'succeeded' }>;

function errorBody(code: string, message: string, fieldErrors?: Record<string, string[]>) {
  return { code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function validation(field: string, message: string): never {
  throw new BadRequestException(errorBody('VALIDATION_FAILED', 'Request validation failed', { [field]: [message] }));
}

function safeIdr(value: string | number | bigint, field: string): number {
  let parsed: bigint;
  try {
    parsed = typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', `Data rupiah ${field} tidak dapat dibaca.`));
  }
  if (parsed < 0n || parsed > maxIdr) {
    throw new UnprocessableEntityException(errorBody('RULE_VIOLATION', `Nominal ${field} harus berupa rupiah integer yang aman.`));
  }
  return Number(parsed);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseOrderCursor(value?: string): OrderCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<OrderCursor>;
    if (typeof parsed.createdAt !== 'string' || parsed.createdAt.length > 64 || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.id !== 'string' || !uuidPattern.test(parsed.id)
      || Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url') !== value) {
      validation('cursor', 'Cursor pesanan tidak valid.');
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return validation('cursor', 'Cursor pesanan tidak valid.');
  }
}

function encodeOrderCursor(cursor: OrderCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function safeSum(lines: readonly LineSnapshot[], shippingAmountIdr = 0): number {
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.lineTotalIdr), 0n);
  const total = subtotal + BigInt(shippingAmountIdr);
  if (subtotal > maxIdr || total > maxIdr) {
    throw new UnprocessableEntityException(errorBody('RULE_VIOLATION', 'Total pesanan melebihi batas rupiah yang aman.'));
  }
  return Number(total);
}

@Injectable()
export class CommerceService implements OrderPaymentSucceededPort {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CHECKOUT_SHIPPING_ADAPTER) private readonly shipping: CheckoutShippingAdapter,
  ) {}

  async getCart(principal: AuthenticatedPrincipal) {
    this.farmer(principal);
    return this.db.transaction(async (client) => {
      const cart = await this.ensureCart(client, principal.userId);
      return this.cartView(client, cart);
    });
  }

  async setItem(principal: AuthenticatedPrincipal, productId: string, input: SetCartItemDto) {
    this.farmer(principal);
    return this.db.transaction(async (client) => {
      const cart = await this.ensureCart(client, principal.userId);
      const product = await client.query<{ active: boolean }>(
        'SELECT active FROM products WHERE id=$1 FOR SHARE', [productId],
      );
      if (!product.rows[0]?.active) throw this.notFound('Produk aktif tidak ditemukan.');
      const current = await client.query<{ quantity: number }>(
        'SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2 FOR UPDATE', [cart.id, productId],
      );
      if (current.rows[0]?.quantity === input.quantity) return this.cartView(client, cart);
      this.assertCartVersion(cart, input.expectedVersion);

      await client.query(
        `INSERT INTO cart_items(cart_id,product_id,quantity)
         VALUES($1,$2,$3)
         ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=now()`,
        [cart.id, productId, input.quantity],
      );
      const updatedCart = await client.query<CartRow>(
        'UPDATE carts SET updated_at=now(),version=version+1 WHERE id=$1 RETURNING id,farmer_id,version', [cart.id],
      );
      return this.cartView(client, updatedCart.rows[0]);
    });
  }

  async removeItem(principal: AuthenticatedPrincipal, productId: string, input: DeleteCartItemQueryDto) {
    this.farmer(principal);
    return this.db.transaction(async (client) => {
      const cart = await this.ensureCart(client, principal.userId);
      const current = await client.query<{ quantity: number }>(
        'SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2 FOR UPDATE', [cart.id, productId],
      );
      if (!current.rowCount) return this.cartView(client, cart);
      this.assertCartVersion(cart, input.expectedVersion);
      await client.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cart.id, productId]);
      const updatedCart = await client.query<CartRow>(
        'UPDATE carts SET updated_at=now(),version=version+1 WHERE id=$1 RETURNING id,farmer_id,version', [cart.id],
      );
      return this.cartView(client, updatedCart.rows[0]);
    });
  }

  async createQuote(principal: AuthenticatedPrincipal, input: CreateCheckoutQuoteDto) {
    this.farmer(principal);
    return this.db.transaction(async (client) => {
      const cart = await this.ensureCart(client, principal.userId);
      const lines = await this.currentLines(client, cart.id);
      this.assertCheckoutReady(lines);
      const address = await this.addressSnapshot(client, principal.userId, input.addressId);
      const shipping = await this.shippingEstimate(address);
      const subtotalIdr = safeSum(lines);
      const totalIdr = safeSum(lines, shipping.value.amountIdr);
      const id = randomUUID();
      const inserted = await client.query<QuoteRow>(
        `INSERT INTO checkout_quotes
           (id,farmer_id,cart_id,cart_version,address_id,address_version,address_snapshot,line_snapshots,
            subtotal_snapshot_idr,shipping_snapshot_idr,shipping_label,shipping_adapter_operation_id,total_snapshot_idr)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)
         RETURNING *`,
        [id, principal.userId, cart.id, cart.version, address.id, address.version,
          JSON.stringify(this.publicAddress(address)), JSON.stringify(lines), subtotalIdr,
          shipping.value.amountIdr, shipping.value.label, shipping.operationId, totalIdr],
      );
      return this.quoteView(inserted.rows[0]);
    });
  }

  async createOrder(principal: AuthenticatedPrincipal, key: string | undefined, input: CreateOrderDto) {
    this.farmer(principal);
    const idempotencyKey = this.requireKey(key);
    const scope = 'order:create';
    const requestFingerprint = fingerprint({ quoteId: input.quoteId });

    return this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO idempotency_operations(actor_id,operation_scope,idempotency_key,request_fingerprint,state)
         VALUES($1,$2,$3,$4,'in_progress') ON CONFLICT(actor_id,operation_scope,idempotency_key) DO NOTHING`,
        [principal.userId, scope, idempotencyKey, requestFingerprint],
      );
      const operation = await client.query<{ id: string; request_fingerprint: string; state: string; resource_id: string | null }>(
        `SELECT id,request_fingerprint,state,resource_id FROM idempotency_operations
         WHERE actor_id=$1 AND operation_scope=$2 AND idempotency_key=$3 FOR UPDATE`,
        [principal.userId, scope, idempotencyKey],
      );
      if (!operation.rows[0] || operation.rows[0].request_fingerprint !== requestFingerprint) this.idempotencyConflict();
      if (operation.rows[0].state === 'completed' && operation.rows[0].resource_id) {
        return {
          operationId: operation.rows[0].id,
          replayed: true,
          order: await this.orderView(client, principal.userId, operation.rows[0].resource_id),
        };
      }
      if (operation.rows[0].state !== 'in_progress') {
        throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Operasi pesanan belum dapat dipulihkan.'));
      }

      const quoteResult = await client.query<QuoteRow>(
        'SELECT * FROM checkout_quotes WHERE id=$1 AND farmer_id=$2 FOR UPDATE', [input.quoteId, principal.userId],
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw this.notFound('Quote checkout tidak ditemukan.');
      if (quote.consumed_at) throw new ConflictException(errorBody('CONFLICT', 'Quote checkout sudah dipakai.'));
      if (new Date(quote.expires_at).getTime() <= Date.now()) {
        throw new ConflictException(errorBody('CONFLICT', 'Quote checkout kedaluwarsa. Tinjau checkout kembali.'));
      }

      const cartResult = await client.query<CartRow>(
        'SELECT id,farmer_id,version FROM carts WHERE id=$1 AND farmer_id=$2 FOR UPDATE', [quote.cart_id, principal.userId],
      );
      const cart = cartResult.rows[0];
      if (!cart) throw this.notFound('Keranjang tidak ditemukan.');
      const lines = await this.currentLines(client, cart.id);
      this.assertCheckoutReady(lines);
      const address = await this.addressSnapshot(client, principal.userId, quote.address_id);
      const shipping = await this.shippingEstimate(address);
      const subtotalIdr = safeSum(lines);
      const totalIdr = safeSum(lines, shipping.value.amountIdr);
      const addressSnapshot = this.publicAddress(address);
      const quoteMatchesCurrent = quote.cart_version === cart.version
        && address.version === quote.address_version
        && stable(lines) === stable(quote.line_snapshots)
        && stable(addressSnapshot) === stable(quote.address_snapshot)
        && safeIdr(quote.subtotal_snapshot_idr, 'subtotal') === subtotalIdr
        && safeIdr(quote.shipping_snapshot_idr, 'ongkir') === shipping.value.amountIdr
        && quote.shipping_label === shipping.value.label
        && safeIdr(quote.total_snapshot_idr, 'total') === totalIdr;
      if (!quoteMatchesCurrent) {
        throw new ConflictException(errorBody('CONFLICT', 'Harga, keranjang, atau alamat berubah. Buat quote checkout baru untuk meninjau total terbaru.'));
      }

      const orderId = randomUUID();
      const displayCode = `VL-O-${orderId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      await client.query(
        `INSERT INTO orders
           (id,display_code,farmer_id,status,checkout_quote_id,address_id,address_snapshot,
            subtotal_snapshot_idr,shipping_snapshot_idr,shipping_label_snapshot,total_snapshot_idr)
         VALUES($1,$2,$3,'awaiting_payment',$4,$5,$6::jsonb,$7,$8,$9,$10)`,
        [orderId, displayCode, principal.userId, quote.id, address.id, JSON.stringify(addressSnapshot),
          subtotalIdr, shipping.value.amountIdr, shipping.value.label, totalIdr],
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items(order_id,product_id,product_name_snapshot,category_snapshot,
             unit_price_snapshot_idr,quantity,line_total_snapshot_idr)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [orderId, line.productId, line.nameSnapshot, line.categorySnapshot,
            line.unitPriceIdr, line.quantity, line.lineTotalIdr],
        );
      }
      const consumed = await client.query(
        'UPDATE checkout_quotes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL', [quote.id],
      );
      if (consumed.rowCount !== 1) throw new ConflictException(errorBody('CONFLICT', 'Quote checkout sudah dipakai.'));
      await client.query('DELETE FROM cart_items WHERE cart_id=$1', [cart.id]);
      await client.query('UPDATE carts SET updated_at=now(),version=version+1 WHERE id=$1', [cart.id]);
      await client.query(
        `UPDATE idempotency_operations SET state='completed',resource_type='order',resource_id=$4,
           http_status=201,completed_at=now()
         WHERE actor_id=$1 AND operation_scope=$2 AND idempotency_key=$3`,
        [principal.userId, scope, idempotencyKey, orderId],
      );
      return { operationId: operation.rows[0].id, replayed: false, order: await this.orderView(client, principal.userId, orderId) };
    });
  }

  async listOrders(principal: AuthenticatedPrincipal, query: OrderListQueryDto) {
    this.farmer(principal);
    const cursor = parseOrderCursor(query.cursor);
    const limit = query.limit ?? 20;
    return this.db.transaction(async (client) => {
      const rows = await client.query<{ id: string; created_at: string }>(
        `SELECT id,created_at::text AS created_at FROM orders
         WHERE farmer_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
         ORDER BY created_at DESC,id DESC LIMIT $4`, [principal.userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      );
      const hasMore = rows.rows.length > limit;
      const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
      const items = [];
      for (const row of page) items.push(await this.orderView(client, principal.userId, row.id));
      const last = page.at(-1);
      return {
        items,
        nextCursor: hasMore && last ? encodeOrderCursor({ createdAt: last.created_at, id: last.id }) : null,
        hasMore,
      };
    });
  }

  async getOrder(principal: AuthenticatedPrincipal, orderId: string) {
    this.farmer(principal);
    return this.db.transaction((client) => this.orderView(client, principal.userId, orderId));
  }

  async handleOrderPaymentSucceeded(client: PoolClient, payment: OrderPaymentSucceededInput): Promise<void> {
    if (payment.payableType !== 'order') return;
    const result = await client.query<{ id: string; status: string; payment_id: string | null; total_snapshot_idr: string }>(
      `SELECT id,status,payment_id,total_snapshot_idr FROM orders
       WHERE id=$1 AND farmer_id=$2 FOR UPDATE`, [payment.payableId, payment.ownerId],
    );
    const order = result.rows[0];
    if (!order || safeIdr(order.total_snapshot_idr, 'total') !== payment.amountIdr) {
      throw new ConflictException(errorBody('CONFLICT', 'Pembayaran tidak cocok dengan snapshot pesanan.'));
    }
    if (order.status === 'paid' && order.payment_id === payment.id) return;
    if (order.status !== 'awaiting_payment' || (order.payment_id && order.payment_id !== payment.id)) {
      throw new ConflictException(errorBody('CONFLICT', 'Pesanan tidak lagi menunggu pembayaran ini.'));
    }
    const updated = await client.query(
      `UPDATE orders SET status='paid',payment_id=$2,paid_at=now(),updated_at=now(),version=version+1
       WHERE id=$1 AND status='awaiting_payment'`, [order.id, payment.id],
    );
    if (updated.rowCount !== 1) throw new ConflictException(errorBody('CONFLICT', 'Status pesanan berubah saat pembayaran diproses.'));
  }

  private farmer(principal: AuthenticatedPrincipal): void {
    if (principal.activeRole !== 'farmer') {
      throw new ForbiddenException(errorBody('FORBIDDEN', 'Keranjang, checkout, dan pesanan hanya tersedia bagi Peternak.'));
    }
  }

  private async ensureCart(client: PoolClient, farmerId: string): Promise<CartRow> {
    await client.query('INSERT INTO carts(farmer_id) VALUES($1) ON CONFLICT(farmer_id) DO NOTHING', [farmerId]);
    const result = await client.query<CartRow>(
      'SELECT id,farmer_id,version FROM carts WHERE farmer_id=$1 FOR UPDATE', [farmerId],
    );
    if (!result.rows[0]) throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Keranjang belum dapat dibaca.'));
    return result.rows[0];
  }

  private async cartView(client: PoolClient, cart: CartRow) {
    const result = await client.query<ProductLineRow>(
      `SELECT ci.product_id,p.name AS product_name,p.category,p.unit_price_idr::text AS unit_price_idr,
              ci.quantity,p.active
       FROM cart_items ci JOIN products p ON p.id=ci.product_id
       WHERE ci.cart_id=$1 ORDER BY ci.created_at,ci.product_id`, [cart.id],
    );
    let subtotal = 0n;
    let quantityCount = 0;
    let hasUnavailableItems = false;
    const items = result.rows.map((row) => {
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) {
        throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Jumlah item keranjang tidak valid.'));
      }
      quantityCount += row.quantity;
      const price = row.active ? safeIdr(row.unit_price_idr, 'harga produk') : null;
      const lineTotal = price === null ? null : BigInt(price) * BigInt(row.quantity);
      if (lineTotal === null) hasUnavailableItems = true;
      else subtotal += lineTotal;
      return {
        productId: row.product_id,
        name: row.product_name,
        category: row.category,
        unitPriceIdr: price,
        quantity: row.quantity,
        lineTotalIdr: lineTotal === null ? null : safeIdr(lineTotal, 'subtotal item'),
        active: row.active,
      };
    });
    return {
      id: cart.id,
      farmerId: cart.farmer_id,
      version: cart.version,
      currency: 'IDR' as const,
      items,
      subtotalIdr: safeIdr(subtotal, 'subtotal keranjang'),
      itemCount: items.length,
      quantityCount,
      hasUnavailableItems,
    };
  }

  private async currentLines(client: PoolClient, cartId: string): Promise<LineSnapshot[]> {
    const result = await client.query<ProductLineRow>(
      `SELECT ci.product_id,p.name AS product_name,p.category,p.unit_price_idr::text AS unit_price_idr,
              ci.quantity,p.active
       FROM cart_items ci JOIN products p ON p.id=ci.product_id
       WHERE ci.cart_id=$1 ORDER BY ci.created_at,ci.product_id FOR SHARE OF p`, [cartId],
    );
    return result.rows.map((row) => {
      if (!row.active) throw new UnprocessableEntityException(errorBody('RULE_VIOLATION', 'Produk di keranjang sudah tidak aktif. Hapus item tersebut sebelum checkout.'));
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) {
        throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Jumlah item keranjang tidak valid.'));
      }
      const unitPriceIdr = safeIdr(row.unit_price_idr, 'harga produk');
      if (unitPriceIdr < 1) throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Harga produk tidak valid.'));
      const lineTotal = BigInt(unitPriceIdr) * BigInt(row.quantity);
      return {
        productId: row.product_id,
        nameSnapshot: row.product_name,
        categorySnapshot: row.category,
        unitPriceIdr,
        quantity: row.quantity,
        lineTotalIdr: safeIdr(lineTotal, 'total item'),
      };
    });
  }

  private assertCheckoutReady(lines: readonly LineSnapshot[]): void {
    if (lines.length === 0) throw new UnprocessableEntityException(errorBody('RULE_VIOLATION', 'Keranjang belum memiliki produk.'));
    safeSum(lines);
  }

  private async addressSnapshot(client: PoolClient, farmerId: string, addressId: string): Promise<AddressRow> {
    const result = await client.query<AddressRow>(
      `SELECT a.id,a.label,a.recipient_name AS "recipientName",a.phone,a.address_line AS "addressLine",
              a.city,a.province,a.postal_code AS "postalCode",a.version
       FROM addresses a
       WHERE a.id=$1 AND a.owner_id=$2
         AND EXISTS (SELECT 1 FROM farms f WHERE f.owner_id=$2 AND f.visit_address_id=a.id)
       FOR SHARE OF a`, [addressId, farmerId],
    );
    if (!result.rows[0]) throw this.notFound('Alamat pengiriman tidak ditemukan pada peternakan milik Peternak.');
    return result.rows[0];
  }

  private publicAddress(address: AddressRow): AddressSnapshot {
    return {
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine: address.addressLine,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
    };
  }

  private async shippingEstimate(address: AddressRow): Promise<SuccessfulShippingResult> {
    let result: AdapterResult<ShippingQuoteValue>;
    try {
      result = await this.shipping.estimate({ city: address.city, province: address.province });
    } catch {
      throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Hasil estimasi ongkir belum tersedia. Coba lagi nanti.'));
    }
    if (result.status === 'failed') {
      if (result.error.code === 'SHIPPING_AREA_UNAVAILABLE') {
        throw new UnprocessableEntityException(errorBody('RULE_VIOLATION', result.error.message));
      }
      throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Hasil estimasi ongkir belum tersedia. Coba lagi nanti.'));
    }
    if (result.status !== 'succeeded') {
      throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Estimasi ongkir belum selesai; checkout belum dapat dibuat.'));
    }
    const amountIdr = safeIdr(result.value.amountIdr, 'ongkir');
    if (!result.value.label.trim() || result.value.label.length > 120) {
      throw new ServiceUnavailableException(errorBody('SERVICE_UNAVAILABLE', 'Adapter estimasi ongkir mengembalikan hasil tidak valid.'));
    }
    return {
      operationId: result.operationId,
      occurredAt: result.occurredAt,
      status: 'succeeded',
      value: { amountIdr, label: result.value.label.trim() },
    };
  }

  private quoteView(row: QuoteRow) {
    return {
      id: row.id,
      cartId: row.cart_id,
      cartVersion: row.cart_version,
      addressId: row.address_id,
      addressSnapshot: row.address_snapshot,
      items: row.line_snapshots,
      subtotalIdr: safeIdr(row.subtotal_snapshot_idr, 'subtotal'),
      shippingAmountIdr: safeIdr(row.shipping_snapshot_idr, 'ongkir'),
      shippingLabel: row.shipping_label,
      totalIdr: safeIdr(row.total_snapshot_idr, 'total'),
      currency: 'IDR' as const,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  private async orderView(client: PoolClient, farmerId: string, orderId: string) {
    const result = await client.query<{
      id: string; display_code: string; status: string; checkout_quote_id: string; address_id: string;
      address_snapshot: AddressSnapshot; subtotal_snapshot_idr: string; shipping_snapshot_idr: string;
      shipping_label_snapshot: string; total_snapshot_idr: string; payment_id: string | null;
      payment_status: string | null; created_at: Date; version: number;
    }>(
      `SELECT o.id,o.display_code,o.status,o.checkout_quote_id,o.address_id,o.address_snapshot,
              o.subtotal_snapshot_idr::text,o.shipping_snapshot_idr::text,o.shipping_label_snapshot,
              o.total_snapshot_idr::text,o.payment_id,p.status AS payment_status,o.created_at,o.version
       FROM orders o LEFT JOIN payments p ON p.id=o.payment_id
       WHERE o.id=$1 AND o.farmer_id=$2`, [orderId, farmerId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound('Pesanan tidak ditemukan.');
    const itemResult = await client.query<{
      id: string; product_id: string; product_name_snapshot: string; category_snapshot: string;
      unit_price_snapshot_idr: string; quantity: number; line_total_snapshot_idr: string;
    }>(
      `SELECT id,product_id,product_name_snapshot,category_snapshot,unit_price_snapshot_idr::text,
              quantity,line_total_snapshot_idr::text
       FROM order_items WHERE order_id=$1 ORDER BY created_at,id`, [row.id],
    );
    return {
      id: row.id,
      displayCode: row.display_code,
      status: row.status,
      checkoutQuoteId: row.checkout_quote_id,
      addressId: row.address_id,
      addressSnapshot: row.address_snapshot,
      items: itemResult.rows.map((item) => ({
        id: item.id,
        productId: item.product_id,
        nameSnapshot: item.product_name_snapshot,
        categorySnapshot: item.category_snapshot,
        unitPriceIdr: safeIdr(item.unit_price_snapshot_idr, 'harga snapshot'),
        quantity: item.quantity,
        lineTotalIdr: safeIdr(item.line_total_snapshot_idr, 'total item snapshot'),
      })),
      subtotalIdr: safeIdr(row.subtotal_snapshot_idr, 'subtotal snapshot'),
      shippingAmountIdr: safeIdr(row.shipping_snapshot_idr, 'ongkir snapshot'),
      shippingLabel: row.shipping_label_snapshot,
      totalIdr: safeIdr(row.total_snapshot_idr, 'total snapshot'),
      currency: 'IDR' as const,
      paymentId: row.payment_id,
      paymentStatus: row.payment_status,
      createdAt: new Date(row.created_at).toISOString(),
      version: row.version,
    };
  }

  private assertCartVersion(cart: CartRow, expectedVersion: number): void {
    if (cart.version !== expectedVersion) {
      throw new ConflictException(errorBody('CONFLICT', 'Keranjang berubah sejak dibaca. Muat ulang sebelum mengubah item.'));
    }
  }

  private requireKey(value: string | undefined): string {
    if (!value || value.length < 8 || value.length > 128) {
      validation('Idempotency-Key', 'Idempotency-Key wajib berisi 8–128 karakter.');
    }
    return value;
  }

  private idempotencyConflict(): never {
    throw new ConflictException(errorBody('CONFLICT', 'Idempotency-Key telah dipakai dengan payload berbeda.'));
  }

  private notFound(message = 'Resource tidak ditemukan.'): NotFoundException {
    return new NotFoundException(errorBody('NOT_FOUND', message));
  }
}
