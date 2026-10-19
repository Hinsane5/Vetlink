import type { DomainEntity } from './entities';
import { DomainError } from './errors';

export interface CheckoutAddressInput {
  label: string;
  recipient: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface CheckoutAddressSnapshot extends CheckoutAddressInput {
  id: string;
}

export interface CartLineSnapshot {
  cartItemId: string;
  productId: string;
  nameSnapshot: string;
  categorySnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CartLine {
  cartItemId: string;
  productId: string;
  name: string;
  category: string | null;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  available: boolean;
}

export interface CartSnapshot {
  cartId: string | null;
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
  quantityCount: number;
  hasUnavailableItems: boolean;
}

export interface CheckoutQuoteSnapshot {
  id: string;
  cartId: string;
  address: CheckoutAddressSnapshot;
  lines: CartLineSnapshot[];
  subtotal: number;
  shippingAmount: number;
  shippingLabel: string;
  totalAmount: number;
  expiresAt: string;
}

export interface OrderItemSnapshot extends CartLineSnapshot {
  id: string;
}

export interface OrderSnapshot {
  id: string;
  displayCode: string;
  status: 'awaiting_payment' | 'paid' | 'processing' | 'shipped' | 'delivered';
  paymentId: string | null;
  address: CheckoutAddressSnapshot;
  items: OrderItemSnapshot[];
  subtotal: number;
  shippingAmount: number;
  totalAmount: number;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'expired' | null;
  trackingCode: string | null;
  shipmentEvents: ShipmentEventSnapshot[];
}

export interface ShipmentEventSnapshot {
  status: string;
  time: string;
  description: string;
}

export function validateCheckoutAddress(input: Partial<CheckoutAddressInput>): CheckoutAddressInput {
  const label = cleanText(input.label, 'Label alamat', 2, 80, false) || 'Alamat pengiriman';
  const recipient = cleanText(input.recipient, 'Nama penerima', 2, 80);
  const phone = String(input.phone ?? '').trim().replace(/[\s().-]/g, '');
  const address = cleanText(input.address, 'Alamat lengkap', 5, 240);
  const city = cleanText(input.city, 'Kota/kabupaten', 2, 80);
  const province = cleanText(input.province, 'Provinsi', 2, 80);
  const postalCode = String(input.postalCode ?? '').trim();
  if (!/^\+?\d{8,15}$/.test(phone)) {
    throw new DomainError('VALIDATION_FAILED', 'Nomor telepon penerima harus berisi 8 sampai 15 digit.');
  }
  if (!/^\d{5}$/.test(postalCode)) {
    throw new DomainError('VALIDATION_FAILED', 'Kode pos harus berisi 5 digit.');
  }
  return { label, recipient, phone, address, city, province, postalCode };
}

export function addressInputFromEntity(entity: DomainEntity): CheckoutAddressInput {
  if (entity.kind !== 'address') throw new DomainError('INVALID_STATE', 'Data alamat tidak valid.');
  return {
    label: value(entity.payload.label),
    recipient: value(entity.payload.recipient),
    phone: value(entity.payload.phone),
    address: value(entity.payload.address),
    city: value(entity.payload.city),
    province: value(entity.payload.province),
    postalCode: value(entity.payload.postalCode),
  };
}

export function addressSnapshotFromEntity(entity: DomainEntity): CheckoutAddressSnapshot {
  return { id: entity.id, ...validateCheckoutAddress(addressInputFromEntity(entity)) };
}

export function toCartLineSnapshots(lines: readonly CartLine[]): CartLineSnapshot[] {
  if (lines.some((line) => !line.available || line.unitPrice === null || line.lineTotal === null || !line.category)) {
    throw new DomainError('INVALID_STATE', 'Hapus produk yang tidak tersedia sebelum melanjutkan checkout.');
  }
  return lines.map((line) => ({
    cartItemId: line.cartItemId,
    productId: line.productId,
    nameSnapshot: line.name,
    categorySnapshot: line.category!,
    unitPrice: line.unitPrice!,
    quantity: line.quantity,
    lineTotal: line.lineTotal!,
  }));
}

export function calculateSubtotal(lines: readonly CartLineSnapshot[]): number {
  let subtotal = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0
      || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new DomainError('VALIDATION_FAILED', 'Jumlah dan harga produk harus berupa bilangan rupiah yang valid.');
    }
    const lineTotal = line.unitPrice * line.quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal !== line.lineTotal) {
      throw new DomainError('VALIDATION_FAILED', 'Total item melebihi batas hitung atau tidak sesuai.');
    }
    subtotal += lineTotal;
    if (!Number.isSafeInteger(subtotal)) {
      throw new DomainError('VALIDATION_FAILED', 'Subtotal melebihi batas hitung.');
    }
  }
  return subtotal;
}

function cleanText(input: unknown, label: string, min: number, max: number, optional = false): string {
  const normalized = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (optional && !normalized) return '';
  if (normalized.length < min || normalized.length > max) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berisi ${min} sampai ${max} karakter.`);
  }
  return normalized;
}

function value(input: unknown): string {
  return typeof input === 'string' ? input : '';
}
