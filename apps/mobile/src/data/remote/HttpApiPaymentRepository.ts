import type { ApiPaymentAttempt, ApiPaymentQuote, ApiPaymentRecord, ApiPaymentRepository, ApiPaymentStatus } from '../../application/ports/ApiPaymentRepository';
import type { PaymentMethod, PayableType } from '../../application/PaymentService';
import { DomainError } from '../../domain/errors';
import { ApiClient } from './ApiClient';

export class HttpApiPaymentRepository implements ApiPaymentRepository {
  constructor(private readonly api: ApiClient) {}

  async getQuote(payableType: PayableType, payableId: string): Promise<ApiPaymentQuote> {
    const value = await this.api.request<unknown>(`/v1/payment-quotes/${payableType}/${encodeURIComponent(payableId)}`);
    return parseQuote(value);
  }

  async getForPayable(payableType: PayableType, payableId: string): Promise<ApiPaymentRecord | null> {
    const query = `payableType=${encodeURIComponent(payableType)}&payableId=${encodeURIComponent(payableId)}`;
    try {
      const value = await this.api.request<unknown>(`/v1/payments?${query}`);
      return parsePayment(value, true);
    } catch (error) {
      // The quote is checked before an initial create. A 404 on this lookup means
      // no Payment record exists for that payable; every other error stays visible.
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  async getById(paymentId: string): Promise<ApiPaymentRecord> {
    const value = await this.api.request<unknown>(`/v1/payments/${encodeURIComponent(paymentId)}`);
    return parsePayment(value, true);
  }

  async getAttempts(paymentId: string): Promise<ApiPaymentAttempt[]> {
    const value = await this.api.request<unknown>(`/v1/payments/${encodeURIComponent(paymentId)}/attempts`);
    if (!isRecord(value) || !Array.isArray(value.items)) {
      throw new DomainError('API_RESPONSE_INVALID', 'Riwayat Attempt pembayaran tidak sesuai kontrak.');
    }
    return parseAttemptList(value.items);
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

function parsePayment(value: unknown, requireHistory = false): ApiPaymentRecord {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || (value.payableType !== 'consultation' && value.payableType !== 'order')
    || typeof value.payableId !== 'string'
    || !Number.isSafeInteger(value.amountIdr)
    || Number(value.amountIdr) <= 0
    || value.currency !== 'IDR'
    || (value.method !== 'bank_transfer' && value.method !== 'e_wallet')
    || !isPaymentStatus(value.status)
    || !(value.attempt === null || isAttemptSummary(value.attempt))
    || (requireHistory && !Array.isArray(value.attempts))
    || (value.attempts !== undefined && !Array.isArray(value.attempts))) {
    throw new DomainError('API_RESPONSE_INVALID', 'Hasil pembayaran server tidak sesuai kontrak.');
  }
  const attempts = value.attempts === undefined ? [] : parseAttemptList(value.attempts);
  if (requireHistory) {
    const latest = attempts.at(-1);
    if ((latest === undefined && value.attempt !== null)
      || (latest !== undefined && (!value.attempt || latest.id !== value.attempt.id
        || latest.status !== value.attempt.status || latest.reference !== value.attempt.reference))) {
      throw new DomainError('API_RESPONSE_INVALID', 'Status Payment dan Attempt terbaru tidak cocok.');
    }
  }
  return {
    id: value.id,
    payableType: value.payableType,
    payableId: value.payableId,
    amountIdr: Number(value.amountIdr),
    currency: 'IDR',
    method: value.method,
    status: value.status,
    attempt: value.attempt === null ? null : {
      id: value.attempt.id,
      status: value.attempt.status,
      reference: value.attempt.reference,
    },
    attempts,
  };
}

function parseAttemptList(values: unknown[]): ApiPaymentAttempt[] {
  const attempts = values.map(parseAttempt);
  for (let index = 1; index < attempts.length; index += 1) {
    if (attempts[index - 1].attemptNumber >= attempts[index].attemptNumber) {
      throw new DomainError('API_RESPONSE_INVALID', 'Urutan Attempt pembayaran server tidak valid.');
    }
  }
  return attempts;
}

function parseAttempt(value: unknown): ApiPaymentAttempt {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !Number.isSafeInteger(value.attemptNumber)
    || Number(value.attemptNumber) < 1
    || !isPaymentStatus(value.status)
    || !(typeof value.reference === 'string' || value.reference === null)
    || typeof value.attemptedAt !== 'string'
    || !Number.isFinite(Date.parse(value.attemptedAt))) {
    throw new DomainError('API_RESPONSE_INVALID', 'Attempt pembayaran server tidak sesuai kontrak.');
  }
  return {
    id: value.id,
    attemptNumber: Number(value.attemptNumber),
    status: value.status,
    reference: value.reference,
    attemptedAt: value.attemptedAt,
  };
}

function isAttemptSummary(value: unknown): value is { id: string; status: ApiPaymentStatus; reference: string | null } {
  return isRecord(value)
    && typeof value.id === 'string'
    && isPaymentStatus(value.status)
    && (typeof value.reference === 'string' || value.reference === null);
}

function isPaymentStatus(value: unknown): value is ApiPaymentStatus {
  return value === 'pending' || value === 'succeeded' || value === 'failed' || value === 'expired';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
