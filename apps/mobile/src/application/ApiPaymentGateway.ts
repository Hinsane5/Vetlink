import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiPaymentAttempt, ApiPaymentQuote, ApiPaymentRecord, ApiPaymentRepository, ApiPaymentStatus } from './ports/ApiPaymentRepository';
import type { ApiPaymentOperationStore } from './ports/ApiPaymentOperationStore';
import type { PaymentMethod, PayableType } from './PaymentService';

export interface ApiPaymentSnapshot {
  id: string;
  payableType: PayableType;
  payableId: string;
  amount: number;
  currency: 'IDR';
  method: PaymentMethod;
  status: ApiPaymentStatus;
  attemptId: string | null;
  attemptStatus: ApiPaymentStatus | null;
  reference: string | null;
  operationKey: string | null;
}

/** Remote-only payment commands and reads. It never writes or falls back to the SQLite payment ledger. */
export class ApiPaymentGateway {
  constructor(
    private readonly repository: ApiPaymentRepository,
    private readonly operations: ApiPaymentOperationStore,
  ) {}

  async getQuote(payableType: PayableType, payableId: string): Promise<ApiPaymentQuote> {
    const quote = await this.repository.getQuote(payableType, payableId);
    validateQuote(quote, payableType, payableId);
    return quote;
  }

  async getPaymentForPayable(payableType: PayableType, payableId: string): Promise<ApiPaymentSnapshot | null> {
    const payment = await this.repository.getForPayable(payableType, payableId);
    return payment ? toSnapshot(payment, null) : null;
  }

  async getPayment(paymentId: string): Promise<ApiPaymentSnapshot> {
    return toSnapshot(await this.repository.getById(paymentId), null);
  }

  getAttempts(paymentId: string): Promise<ApiPaymentAttempt[]> {
    return this.repository.getAttempts(paymentId);
  }

  async submit(
    role: AccountRole,
    payableType: PayableType,
    payableId: string,
    method: PaymentMethod,
  ): Promise<ApiPaymentSnapshot> {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat melakukan pembayaran.');
    if (!payableId.trim()
      || !['consultation', 'order'].includes(payableType)
      || !['bank_transfer', 'e_wallet'].includes(method)) {
      throw new DomainError('VALIDATION_FAILED', 'Metode atau tagihan pembayaran tidak valid.');
    }

    // Status is the recovery authority across sessions/devices. Never create a
    // second attempt while the server says pending or succeeded.
    const previous = await this.repository.getForPayable(payableType, payableId);
    if (previous && (previous.status === 'pending' || previous.status === 'succeeded')) {
      return toSnapshot(previous, null);
    }

    // The server quote is authoritative. Amount is deliberately absent from
    // the create body and local SQLite remains a separate write authority.
    const quote = await this.repository.getQuote(payableType, payableId);
    validateQuote(quote, payableType, payableId);

    let attemptNumber = 1;
    if (previous) {
      if (previous.payableType !== payableType || previous.payableId !== payableId
        || previous.amountIdr !== quote.amountIdr || previous.currency !== 'IDR') {
        throw new DomainError('API_RESPONSE_INVALID', 'Status pembayaran tidak cocok dengan quote server. Periksa status sebelum mencoba lagi.');
      }
      if (previous.method !== method) {
        throw new DomainError('INVALID_STATE', 'Retry harus memakai metode pembayaran yang sama dengan Attempt sebelumnya.');
      }
      const latestAttempt = previous.attempts.at(-1);
      if (!latestAttempt || latestAttempt.status !== previous.status) {
        throw new DomainError('API_RESPONSE_INVALID', 'Riwayat Attempt terbaru tidak cocok dengan status pembayaran server.');
      }
      attemptNumber = latestAttempt.attemptNumber + 1;
    }

    const input = { payableType, payableId, method };
    // The key is durably saved before the remote mutation. It is derived from
    // the server attempt history so a fresh device does not reuse an old key.
    const operationKey = await this.operations.getOrCreate(input, attemptNumber);
    const payment = await this.repository.create(input, operationKey);
    if (payment.payableType !== payableType || payment.payableId !== payableId
      || payment.method !== method || payment.amountIdr !== quote.amountIdr
      || payment.currency !== 'IDR' || !payment.attempt
      || payment.attempt.status !== payment.status) {
      throw new DomainError('API_RESPONSE_INVALID', 'Hasil pembayaran tidak cocok dengan quote server. Periksa status sebelum mencoba lagi.');
    }

    return toSnapshot(payment, operationKey);
  }
}

function validateQuote(
  quote: { payableType: PayableType; payableId: string; amountIdr: number; currency: 'IDR' },
  payableType: PayableType,
  payableId: string,
): void {
  if (quote.payableType !== payableType || quote.payableId !== payableId
    || quote.currency !== 'IDR' || !Number.isSafeInteger(quote.amountIdr) || quote.amountIdr <= 0) {
    throw new DomainError('API_RESPONSE_INVALID', 'Quote pembayaran tidak cocok dengan tagihan server.');
  }
}

function toSnapshot(payment: ApiPaymentRecord, operationKey: string | null): ApiPaymentSnapshot {
  return {
    id: payment.id,
    payableType: payment.payableType,
    payableId: payment.payableId,
    amount: payment.amountIdr,
    currency: 'IDR',
    method: payment.method,
    status: payment.status,
    attemptId: payment.attempt?.id ?? null,
    attemptStatus: payment.attempt?.status ?? null,
    reference: payment.attempt?.reference ?? null,
    operationKey,
  };
}
