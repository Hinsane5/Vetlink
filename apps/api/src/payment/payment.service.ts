import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { adapterFailed } from '../communication/adapter-result.js';
import { DatabaseService } from '../database/database.service.js';
import { CONSULTATION_PAYMENT_SUCCEEDED, type ConsultationPaymentSucceededPort } from '../consultation/consultation-payment.port.js';
import { ORDER_PAYMENT_SUCCEEDED, type OrderPaymentSucceededPort } from '../commerce/order-payment.port.js';
import { ORDER_SHIPMENT_START, type OrderShipmentStartPort } from '../commerce/order-shipment.port.js';
import { PAYMENT_SERVICE, type PaymentOutcome, type PaymentService } from './payment.adapter.js';

type PayableType = 'consultation' | 'order';
type PaymentInput = { payableType: PayableType; payableId: string; method: 'bank_transfer' | 'e_wallet' };
type PaymentRow = Record<string, any>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PAYMENT_SERVICE) private readonly adapter: PaymentService,
    @Inject(CONSULTATION_PAYMENT_SUCCEEDED) private readonly consultationPayment: ConsultationPaymentSucceededPort,
    @Inject(ORDER_PAYMENT_SUCCEEDED) private readonly orderPayment: OrderPaymentSucceededPort,
    @Inject(ORDER_SHIPMENT_START) private readonly shipmentStart: OrderShipmentStartPort,
  ) {}

  async quote(p: AuthenticatedPrincipal, payableType: PayableType, payableId: string) {
    this.farmer(p);
    if (payableType === 'order') {
      const q = await this.db.query<{ id: string; total_snapshot_idr: string; status: string }>(
        'SELECT id,total_snapshot_idr::text,status FROM orders WHERE id=$1 AND farmer_id=$2', [payableId, p.userId]);
      const row = q.rows[0];
      if (!row || row.status !== 'awaiting_payment') throw this.payableMissing();
      const amountIdr = Number(row.total_snapshot_idr);
      if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message: 'Tagihan pesanan tidak memiliki nominal rupiah yang valid.' });
      return { payableType, payableId: row.id, amountIdr, currency: 'IDR' as const };
    }
    const q = await this.db.query<{ id: string; fee_snapshot_idr: string; status: string }>(
      'SELECT id,fee_snapshot_idr,status FROM consultations WHERE id=$1 AND farmer_id=$2', [payableId, p.userId]);
    const row = q.rows[0];
    if (!row || row.status !== 'awaiting_payment') throw this.payableMissing();
    const amountIdr = Number(row.fee_snapshot_idr);
    if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message: 'Tagihan tidak memiliki nominal rupiah yang valid.' });
    return { payableType, payableId: row.id, amountIdr, currency: 'IDR' as const };
  }

  async create(p: AuthenticatedPrincipal, key: string, input: PaymentInput) {
    this.farmer(p);
    if (!key || key.length < 8 || key.length > 128) throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: 'Idempotency-Key harus sepanjang 8–128 karakter.' });
    const fingerprint = createHash('sha256').update(JSON.stringify({ payableType: input.payableType, payableId: input.payableId, method: input.method })).digest('hex');
    const prepared = await this.db.transaction(async (c) => {
      const payable = input.payableType === 'order'
        ? await c.query<{ fee_snapshot_idr: string; status: string }>(
          `SELECT total_snapshot_idr::text AS fee_snapshot_idr,status FROM orders
           WHERE id=$1 AND farmer_id=$2 FOR UPDATE`, [input.payableId, p.userId])
        : await c.query<{ fee_snapshot_idr: string; status: string }>(
          'SELECT fee_snapshot_idr::text AS fee_snapshot_idr,status FROM consultations WHERE id=$1 AND farmer_id=$2 FOR UPDATE', [input.payableId, p.userId]);
      if (!payable.rows[0]) throw this.payableMissing();
      const prior = await c.query<PaymentRow>(`SELECT p.*,a.id AS attempt_id,a.status AS attempt_status,a.adapter_reference AS attempt_reference,
        a.request_fingerprint AS attempt_fingerprint FROM payment_attempts a JOIN payments p ON p.id=a.payment_id
        WHERE p.owner_id=$1 AND p.payable_type=$2 AND p.payable_id=$3 AND a.operation_key=$4 FOR UPDATE`,
      [p.userId, input.payableType, input.payableId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].attempt_fingerprint !== fingerprint) throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency-Key telah dipakai dengan payload berbeda.' });
        return { row: prior.rows[0], shouldStart: false };
      }
      if (payable.rows[0].status !== 'awaiting_payment') throw this.payableMissing();
      const amountIdr = Number(payable.rows[0].fee_snapshot_idr);
      if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new UnprocessableEntityException({ code: 'RULE_VIOLATION', message: 'Tagihan tidak memiliki nominal rupiah yang valid.' });
      const existing = await c.query<PaymentRow>('SELECT * FROM payments WHERE owner_id=$1 AND payable_type=$2 AND payable_id=$3 FOR UPDATE',
        [p.userId, input.payableType, input.payableId]);
      let payment = existing.rows[0];
      if (payment) {
        if (payment.status !== 'failed' && payment.status !== 'expired') throw new ConflictException({ code: 'PAYMENT_STATE_CONFLICT', message: 'Pembayaran sebelumnya masih aktif atau sudah berhasil.' });
        if (payment.method !== input.method || Number(payment.amount_idr) !== amountIdr) throw new ConflictException({ code: 'PAYMENT_RETRY_CONFLICT', message: 'Retry harus memakai metode dan nominal tagihan yang sama.' });
        payment = (await c.query<PaymentRow>("UPDATE payments SET status='pending',adapter_reference=NULL,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *", [payment.id])).rows[0];
      } else {
        payment = (await c.query<PaymentRow>(`INSERT INTO payments(owner_id,payable_type,payable_id,method,amount_idr,status,operation_key,request_fingerprint)
          VALUES($1,$2,$3,$4,$5,'pending',$6,$7) RETURNING *`,
        [p.userId, input.payableType, input.payableId, input.method, amountIdr, key, fingerprint])).rows[0];
      }
      const next = await c.query<{ next_number: number }>('SELECT COALESCE(max(attempt_number),0)+1 AS next_number FROM payment_attempts WHERE payment_id=$1', [payment.id]);
      const attempt = (await c.query<PaymentRow>(`INSERT INTO payment_attempts(payment_id,attempt_number,status,operation_key,request_fingerprint)
        VALUES($1,$2,'pending',$3,$4) RETURNING *`, [payment.id, next.rows[0].next_number, key, fingerprint])).rows[0];
      if (input.payableType === 'order') {
        const linked = await c.query(
          `UPDATE orders SET payment_id=$3,updated_at=now(),version=version+1
           WHERE id=$1 AND farmer_id=$2 AND status='awaiting_payment' AND (payment_id IS NULL OR payment_id=$3)`,
          [input.payableId, p.userId, payment.id],
        );
        if (linked.rowCount !== 1) throw new ConflictException({ code: 'PAYMENT_STATE_CONFLICT', message: 'Pesanan tidak lagi menunggu pembayaran.' });
      }
      return { row: { ...payment, attempt_id: attempt.id, attempt_status: attempt.status, attempt_reference: null }, shouldStart: true };
    });
    if (!prepared.shouldStart) {
      if (prepared.row.payable_type === 'order' && prepared.row.status === 'succeeded') {
        await this.shipmentStart.ensureStarted(prepared.row.payable_id, prepared.row.owner_id);
      }
      return this.paymentView(prepared.row);
    }
    const row = prepared.row;
    let result;
    try { result = await this.adapter.start(row.id, row.attempt_id, Number(row.amount_idr), row.method); }
    catch { result = adapterFailed<{ reference: string }>('SERVICE_UNAVAILABLE', 'Adapter pembayaran lokal gagal.', true); }
    const reference = result.status === 'failed' ? null : result.value.reference;
    try {
      await this.db.transaction(async (c) => {
        await c.query('UPDATE payment_attempts SET status=$2,adapter_reference=$3 WHERE id=$1 AND status=$4', [row.attempt_id, result.status, reference, 'pending']);
        await c.query('UPDATE payments SET status=$2,adapter_reference=$3,updated_at=now(),version=version+1 WHERE id=$1 AND status=$4',
          [row.id, result.status, reference, 'pending']);
        if (result.status === 'succeeded') {
          const payment = {
            id: row.id,
            ownerId: p.userId,
            payableType: row.payable_type,
            payableId: row.payable_id,
            amountIdr: Number(row.amount_idr),
            callbackEventId: `adapter:${row.attempt_id}`,
          };
          if (row.payable_type === 'order') await this.orderPayment.handleOrderPaymentSucceeded(c, payment);
          else await this.consultationPayment.handlePaymentSucceeded(c, payment);
        }
      });
    } catch { throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Hasil layanan pembayaran belum tersimpan; periksa status sebelum mencoba lagi.' }); }
    const saved = await this.paymentByAttempt(row.attempt_id);
    if (saved.payable_type === 'order' && saved.status === 'succeeded') {
      await this.shipmentStart.ensureStarted(saved.payable_id, saved.owner_id);
    }
    return this.paymentView(saved);
  }

  async localCallback(input: { paymentId: string; attemptId: string; eventId: string; reference: string; outcome: PaymentOutcome; amountIdr: string }) {
    const amount = Number(input.amountIdr);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !/^\d+$/.test(input.amountIdr) || typeof input.eventId !== 'string' || input.eventId.length < 8 || input.eventId.length > 128 || !['pending', 'succeeded', 'failed'].includes(input.outcome)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_ERROR', message: 'Event atau nominal callback lokal tidak valid.' });
    }
    const result = await this.db.transaction(async (c: PoolClient) => {
      const result = await c.query<PaymentRow>(`SELECT p.*,a.id AS attempt_id,a.status AS attempt_status,a.adapter_reference AS attempt_reference
        FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE p.id=$1 AND a.id=$2 FOR UPDATE`, [input.paymentId, input.attemptId]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' });
      if (Number(row.amount_idr) !== amount || row.adapter_reference !== input.reference || row.attempt_reference !== input.reference) {
        throw new ConflictException({ code: 'PAYMENT_CALLBACK_MISMATCH', message: 'Referensi atau nominal callback tidak cocok.' });
      }
      const seen = await c.query<PaymentRow>('SELECT payment_id,event_id,outcome FROM payment_callback_events WHERE event_id=$1', [input.eventId]);
      if (seen.rows[0]) {
        if (seen.rows[0].payment_id !== row.id || seen.rows[0].outcome !== input.outcome) throw new ConflictException({ code: 'CALLBACK_CONFLICT', message: 'Event callback telah digunakan untuk hasil lain.' });
        return { payment: this.paymentView(row), payableType: row.payable_type, payableId: row.payable_id, ownerId: row.owner_id, status: row.status };
      }
      if (row.status !== 'pending' || row.attempt_status !== 'pending') throw new ConflictException({ code: 'PAYMENT_STATE_CONFLICT', message: 'Attempt tidak lagi menunggu hasil.' });
      await c.query('INSERT INTO payment_callback_events(payment_id,event_id,outcome) VALUES($1,$2,$3)', [row.id, input.eventId, input.outcome]);
      if (input.outcome !== 'pending') {
        await c.query('UPDATE payment_attempts SET status=$2 WHERE id=$1', [row.attempt_id, input.outcome]);
        await c.query('UPDATE payments SET status=$2,updated_at=now(),version=version+1 WHERE id=$1', [row.id, input.outcome]);
        if (input.outcome === 'succeeded') {
          const payment = {
            id: row.id,
            ownerId: row.owner_id,
            payableType: row.payable_type,
            payableId: row.payable_id,
            amountIdr: Number(row.amount_idr),
            callbackEventId: input.eventId,
          };
          if (row.payable_type === 'order') await this.orderPayment.handleOrderPaymentSucceeded(c, payment);
          else await this.consultationPayment.handlePaymentSucceeded(c, payment);
        }
      }
      return {
        payment: { ...this.paymentView(row), status: input.outcome, attempt: { ...this.paymentView(row).attempt, status: input.outcome } },
        payableType: row.payable_type,
        payableId: row.payable_id,
        ownerId: row.owner_id,
        status: input.outcome,
      };
    });
    if (result.payableType === 'order' && result.status === 'succeeded') {
      await this.shipmentStart.ensureStarted(result.payableId, result.ownerId);
    }
    return result.payment;
  }

  private async paymentByAttempt(attemptId: string) {
    const result = await this.db.query<PaymentRow>(`SELECT p.*,a.id AS attempt_id,a.status AS attempt_status,a.adapter_reference AS attempt_reference
      FROM payments p JOIN payment_attempts a ON a.payment_id=p.id WHERE a.id=$1`, [attemptId]);
    if (!result.rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' });
    return result.rows[0];
  }
  private paymentView(row: PaymentRow) {
    return { id: row.id, payableType: row.payable_type, payableId: row.payable_id, amountIdr: Number(row.amount_idr), currency: 'IDR',
      status: row.status, attempt: { id: row.attempt_id ?? null, status: row.attempt_status ?? row.status, reference: row.attempt_reference ?? null } };
  }
  private payableMissing() { return new NotFoundException({ code: 'NOT_FOUND', message: 'Kewajiban pembayaran tidak ditemukan.' }); }
  private farmer(p: AuthenticatedPrincipal) { if (p.activeRole !== 'farmer') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Hanya Peternak dapat membayar.' }); }
}
