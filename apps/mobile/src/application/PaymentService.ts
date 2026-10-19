import type { IdFactory } from './ports/AuthRepository';
import type { CommerceRepository } from './ports/CommerceRepository';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';

export type PayableType = 'consultation' | 'order';
export type PaymentMethod = 'bank_transfer' | 'e_wallet';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'expired';
export interface PaymentResult { outcome: 'pending' | 'succeeded' | 'failed'; message?: string; retryable?: boolean }
export interface PaymentAdapter { submit(input: { method: PaymentMethod; amount: number; payableType: PayableType; payableId: string; operationKey: string }): Promise<PaymentResult> }
export interface PaymentSnapshot { id: string; payableType: PayableType; payableId: string; amount: number; method: PaymentMethod; status: PaymentStatus; operationKey: string; message: string }

/** Payment commands persist the adapter outcome before returning it to UI. */
export class PaymentService {
  constructor(private readonly storage: CommerceRepository, private readonly adapter: PaymentAdapter, private readonly ids: IdFactory, private readonly now: () => Date = () => new Date()) {}

  async list(userId: string, role: AccountRole): Promise<PaymentSnapshot[]> {
    this.assertFarmer(role);
    return (await this.storage.read.listByOwner('payment', userId)).map(toSnapshot).sort((a, b) => b.id.localeCompare(a.id));
  }

  async get(userId: string, role: AccountRole, paymentId: string): Promise<PaymentSnapshot> {
    this.assertFarmer(role);
    const payment = await this.storage.read.findById('payment', paymentId);
    if (!payment || payment.ownerId !== userId) throw new DomainError('NOT_FOUND', 'Pembayaran tidak ditemukan.');
    return toSnapshot(payment);
  }

  async submit(userId: string, role: AccountRole, payableType: PayableType, payableId: string, method: PaymentMethod, operationKey: string): Promise<PaymentSnapshot> {
    this.assertFarmer(role);
    if (!['consultation', 'order'].includes(payableType) || !['bank_transfer', 'e_wallet'].includes(method) || !operationKey.trim()) throw new DomainError('VALIDATION_FAILED', 'Metode dan konteks pembayaran tidak valid.');
    const payable = await this.storage.read.findById(payableType, payableId);
    if (!payable || payable.ownerId !== userId) throw new DomainError('NOT_FOUND', 'Tagihan tidak ditemukan.');
    const amount = payableType === 'consultation' ? payable.payload.feeSnapshot : payable.payload.totalSnapshot;
    if (!Number.isSafeInteger(amount) || Number(amount) <= 0) throw new DomainError('INVALID_STATE', 'Tagihan tidak valid.');
    const existing = (await this.storage.read.listByOwner('payment', userId)).find((item) => item.payload.operationKey === operationKey);
    if (existing) {
      if (existing.payload.payableType !== payableType || existing.payload.payableId !== payableId || existing.payload.method !== method || existing.payload.amount !== amount) throw new DomainError('VERSION_CONFLICT', 'Kunci operasi sudah digunakan untuk pembayaran lain.');
      return toSnapshot(existing);
    }
    if (payableType === 'consultation') {
      if (payable.payload.status !== 'awaiting_payment') throw new DomainError('INVALID_STATE', 'Konsultasi ini tidak lagi menunggu pembayaran.');
      const vetProfile = (await this.storage.read.listByOwner('vetProfile', String(payable.payload.vetId ?? '')))[0];
      if (!vetProfile || vetProfile.payload.verificationStatus !== 'verified') throw new DomainError('FORBIDDEN', 'Dokter belum terverifikasi; pembayaran belum dapat dikirim.');
    } else if (payable.payload.status !== 'awaiting_payment') {
      throw new DomainError('INVALID_STATE', 'Pesanan ini tidak lagi menunggu pembayaran.');
    }
    const pending = this.entity('payment', this.ids.create(), userId, payableId, { ownerId: userId, payableType, payableId, method, amount, status: 'pending', operationKey, serviceReference: null, attemptedAt: this.now().toISOString(), message: 'Pembayaran sedang diproses.' });
    const relation: EntityRelation = { sourceId: pending.id, targetId: payableId, relationship: 'payable' };
    const duplicate = await this.storage.transaction(async (repository) => {
      const duplicate = (await repository.listByOwner('payment', userId)).find((item) => item.payload.operationKey === operationKey);
      if (duplicate) {
        if (duplicate.payload.payableType !== payableType || duplicate.payload.payableId !== payableId || duplicate.payload.method !== method || duplicate.payload.amount !== amount) throw new DomainError('VERSION_CONFLICT', 'Kunci operasi sudah digunakan untuk pembayaran lain.');
        return duplicate;
      }
      await repository.create(pending, [relation]);
      return null;
    });
    if (duplicate) return toSnapshot(duplicate);
    let result: PaymentResult;
    try { result = await this.adapter.submit({ method, amount: Number(amount), payableType, payableId, operationKey }); }
    catch { result = { outcome: 'failed', message: 'Layanan pembayaran belum dapat memproses transaksi.', retryable: true }; }
    const current = await this.storage.read.findById('payment', pending.id);
    if (!current) throw new DomainError('INVALID_STATE', 'Catatan pembayaran tidak ditemukan.');
    await this.storage.transaction(async (repository) => {
      const latest = await repository.findById('payment', pending.id);
      if (!latest) throw new DomainError('INVALID_STATE', 'Catatan pembayaran tidak ditemukan.');
      if (latest.payload.status !== 'pending') return;
      const timestamp = this.now().toISOString();
      if (payableType === 'order' && result.outcome === 'succeeded') {
        const order = await repository.findById('order', payableId);
        if (order?.ownerId === userId && order.payload.status === 'awaiting_payment') await repository.update({ ...order, version: order.version + 1, updatedAt: timestamp, payload: { ...order.payload, status: 'paid', paymentId: pending.id } }, order.version);
        else result = { outcome: 'failed', message: 'Pesanan tidak lagi menunggu pembayaran.' };
      }
      if (payableType === 'consultation' && result.outcome === 'succeeded') {
        const consultation = await repository.findById('consultation', payableId);
        if (consultation?.ownerId === userId && consultation.payload.status === 'awaiting_payment') {
          const vetId = String(consultation.payload.vetId ?? '');
          const vetProfile = (await repository.listByOwner('vetProfile', vetId))[0];
          if (!vetProfile || vetProfile.payload.verificationStatus !== 'verified') result = { outcome: 'failed', message: 'Dokter belum terverifikasi; permintaan belum dapat dikirim.' };
          else await repository.update({ ...consultation, version: consultation.version + 1, updatedAt: timestamp, payload: { ...consultation.payload, status: 'requested', paymentId: pending.id } }, consultation.version);
        } else result = { outcome: 'failed', message: 'Konsultasi tidak lagi menunggu pembayaran.' };
      }
      await repository.update({ ...latest, version: latest.version + 1, updatedAt: timestamp, payload: { ...latest.payload, status: result.outcome, message: result.message ?? statusMessage(result.outcome) } }, latest.version);
    });
    const saved = await this.storage.read.findById('payment', pending.id);
    if (!saved) throw new DomainError('INVALID_STATE', 'Catatan pembayaran tidak ditemukan.');
    return toSnapshot(saved);
  }

  private assertFarmer(role: AccountRole) { if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat melakukan pembayaran.'); }
  private entity(kind: 'payment', id: string, ownerId: string, contextId: string, payload: Record<string, unknown>): DomainEntity { const timestamp = this.now().toISOString(); return { id, kind, ownerId, contextId, createdAt: timestamp, updatedAt: timestamp, version: 1, payload }; }
}

function toSnapshot(item: DomainEntity): PaymentSnapshot { return { id: item.id, payableType: item.payload.payableType as PayableType, payableId: String(item.payload.payableId), amount: Number(item.payload.amount), method: item.payload.method as PaymentMethod, status: item.payload.status as PaymentStatus, operationKey: String(item.payload.operationKey), message: String(item.payload.message ?? '') }; }
function statusMessage(status: PaymentResult['outcome']) { return status === 'pending' ? 'Pembayaran menunggu konfirmasi.' : status === 'succeeded' ? 'Pembayaran berhasil diproses.' : 'Pembayaran gagal. Anda dapat mencoba lagi.'; }
