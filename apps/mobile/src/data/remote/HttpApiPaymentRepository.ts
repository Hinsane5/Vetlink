import type { ApiPaymentQuote, ApiPaymentRecord, ApiPaymentRepository } from '../../application/ports/ApiPaymentRepository';
import type { PaymentMethod, PayableType } from '../../application/PaymentService';
import { DomainError } from '../../domain/errors';
import { ApiClient } from './ApiClient';

export class HttpApiPaymentRepository implements ApiPaymentRepository {
  constructor(private readonly api: ApiClient) {}

  async getQuote(payableType: PayableType, payableId: string): Promise<ApiPaymentQuote> {
    const value = await this.api.request<unknown>(`/v1/payment-quotes/${payableType}/${encodeURIComponent(payableId)}`);
    return parseQuote(value);
  }

  async create(
    input: { payableType: PayableType; payableId: string; method: PaymentMethod },
    idempotencyKey: string,
  ): Promise<ApiPaymentRecord> {
    const value = await this.api.request<unknown>('/v1/payments', {
      method: 'POST',
      body: input,
      idempotencyKey,
    });
    return parsePayment(value);
  }
}

function parseQuote(value: unknown): ApiPaymentQuote {
  if (!isRecord(value)
    || (value.payableType !== 'consultation' && value.payableType !== 'order')
    || typeof value.payableId !== 'string'
    || !Number.isSafeInteger(value.amountIdr)
    || Number(value.amountIdr) <= 0
    || value.currency !== 'IDR') {
    throw new DomainError('API_RESPONSE_INVALID', 'Quote pembayaran server tidak sesuai kontrak IDR.');
  }
  return {
    payableType: value.payableType,
    payableId: value.payableId,
    amountIdr: Number(value.amountIdr),
    currency: 'IDR',
  };
}

function parsePayment(value: unknown): ApiPaymentRecord {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || (value.payableType !== 'consultation' && value.payableType !== 'order')
    || typeof value.payableId !== 'string'
    || !Number.isSafeInteger(value.amountIdr)
    || Number(value.amountIdr) <= 0
    || value.currency !== 'IDR'
    || !['pending', 'succeeded', 'failed'].includes(String(value.status))
    || !isRecord(value.attempt)
    || !(typeof value.attempt.id === 'string' || value.attempt.id === null)
    || !['pending', 'succeeded', 'failed'].includes(String(value.attempt.status))
    || !(typeof value.attempt.reference === 'string' || value.attempt.reference === null)) {
    throw new DomainError('API_RESPONSE_INVALID', 'Hasil pembayaran server tidak sesuai kontrak.');
  }
  return {
    id: value.id,
    payableType: value.payableType,
    payableId: value.payableId,
    amountIdr: Number(value.amountIdr),
    currency: 'IDR',
    status: value.status as ApiPaymentRecord['status'],
    attempt: {
      id: value.attempt.id,
      status: value.attempt.status as ApiPaymentRecord['attempt']['status'],
      reference: value.attempt.reference,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
