import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiPaymentRepository } from './ports/ApiPaymentRepository';
import type { ApiPaymentOperationStore } from './ports/ApiPaymentOperationStore';
import type { PaymentMethod, PayableType } from './PaymentService';

export interface ApiPaymentSnapshot {
  id: string;
  payableType: PayableType;
  payableId: string;
  amount: number;
  currency: 'IDR';
  status: 'pending' | 'succeeded' | 'failed';
  attemptId: string | null;
  attemptStatus: 'pending' | 'succeeded' | 'failed';
  reference: string | null;
  operationKey: string;
}

/** Remote-only payment command. It never writes or falls back to the SQLite payment ledger. */
export class ApiPaymentGateway {
  constructor(
    private readonly repository: ApiPaymentRepository,
    private readonly operations: ApiPaymentOperationStore,
  ) {}

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

    // The server quote is authoritative. Amount is deliberately absent from the create body.
    const quote = await this.repository.getQuote(payableType, payableId);
    if (quote.payableType !== payableType || quote.payableId !== payableId
      || quote.currency !== 'IDR' || !Number.isSafeInteger(quote.amountIdr) || quote.amountIdr <= 0) {
      throw new DomainError('API_RESPONSE_INVALID', 'Quote pembayaran tidak cocok dengan tagihan server.');
    }
    // Persist the key before the mutating call. A lost response or app restart
    // reuses this exact key and payload; reads do not consume the key.
    const operationKey = await this.operations.getOrCreate({ payableType, payableId, method });
    const payment = await this.repository.create({ payableType, payableId, method }, operationKey);
    if (payment.payableType !== payableType || payment.payableId !== payableId
      || payment.amountIdr !== quote.amountIdr || payment.currency !== 'IDR'
      || payment.attempt.status !== payment.status) {
      throw new DomainError('API_RESPONSE_INVALID', 'Hasil pembayaran tidak cocok dengan quote server. Periksa status sebelum mencoba lagi.');
    }
    await this.operations.recordOutcome(operationKey, payment.status);

    return {
      id: payment.id,
      payableType: payment.payableType,
      payableId: payment.payableId,
      amount: payment.amountIdr,
      currency: 'IDR',
      status: payment.status,
      attemptId: payment.attempt.id,
      attemptStatus: payment.attempt.status,
      reference: payment.attempt.reference,
      operationKey,
    };
  }
}
