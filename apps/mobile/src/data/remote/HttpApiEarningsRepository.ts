import type {
  ApiEarningTransaction, ApiEarnings, ApiEarningsQuery, ApiEarningsRepository,
  ApiPayoutDestination, ApiWithdrawal, ApiWithdrawalAction, ApiWithdrawalPage, ApiWithdrawalQuery,
} from '../../application/ports/ApiEarningsRepository';
import { ApiClient } from './ApiClient';
import {
  invalidQuery, invalidResponse, isCalendarDate, isIsoTimestampWithTimezone, isNonEmptyText,
  isRecord, isUuid, parseReadPage, validateOpaqueCursor, validatePageLimit,
} from './apiReadValidation';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const WITHDRAWAL_STATUSES = ['submitting', 'submitted', 'processing', 'paid', 'rejected', 'failed'] as const;
const OUTCOMES = ['pending', 'succeeded', 'failed'] as const;

/** BE-15 read/write boundary. No local balance or payout status is fabricated. */
export class HttpApiEarningsRepository implements ApiEarningsRepository {
  constructor(private readonly api: ApiClient) {}

  async getEarnings(query: ApiEarningsQuery = {}): Promise<ApiEarnings> {
    if (!isRecord(query)) throw invalidQuery('Filter pendapatan tidak valid.');
    const input = query as ApiEarningsQuery;
    if (input.period !== undefined && (typeof input.period !== 'string' || !PERIOD.test(input.period))) throw invalidQuery('Periode harus YYYY-MM.');
    if ((input.from === undefined) !== (input.to === undefined)
      || (input.from !== undefined && (!isCalendarDate(input.from) || !isCalendarDate(input.to) || input.from > input.to!))) {
      throw invalidQuery('Rentang tanggal pendapatan tidak valid.');
    }
    if (input.period !== undefined && input.from !== undefined) throw invalidQuery('Pilih periode atau rentang tanggal.');
    validatePageLimit(input.limit, 'transaksi');
    validateOpaqueCursor(input.cursor, 'transaksi');
    const params = new URLSearchParams();
    if (input.period !== undefined) params.set('period', input.period);
    if (input.from !== undefined) { params.set('from', input.from); params.set('to', input.to!); }
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    return parseEarnings(await this.api.request<unknown>(`/v1/me/vet/earnings${params.size ? `?${params}` : ''}`));
  }

  async getTransaction(id: string): Promise<ApiEarningTransaction> {
    return parseTransaction(await this.api.request<unknown>(`/v1/me/vet/transactions/${resourceId(id)}`));
  }

  async getDestinations(): Promise<ApiPayoutDestination[]> {
    const value = await this.api.request<unknown>('/v1/me/vet/payout-destinations');
    if (!isRecord(value) || !Array.isArray(value.items)) throw invalidResponse('Tujuan pencairan server tidak sesuai kontrak.');
    return value.items.map(parseDestination);
  }

  async getWithdrawals(query: ApiWithdrawalQuery = {}): Promise<ApiWithdrawalPage> {
    if (!isRecord(query)) throw invalidQuery('Filter pencairan tidak valid.');
    const input = query as ApiWithdrawalQuery;
    validatePageLimit(input.limit, 'pencairan');
    validateOpaqueCursor(input.cursor, 'pencairan');
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.cursor !== undefined) params.set('cursor', input.cursor);
    const value = await this.api.request<unknown>(`/v1/me/vet/withdrawals${params.size ? `?${params}` : ''}`);
    return parseReadPage(value, parseWithdrawal, 'pencairan');
  }

  async getWithdrawal(id: string): Promise<ApiWithdrawal> {
    return parseWithdrawal(await this.api.request<unknown>(`/v1/me/vet/withdrawals/${resourceId(id)}`));
  }

  async createWithdrawal(operation: { idempotencyKey: string; payload: { amount: number; destinationId: string } }): Promise<ApiWithdrawalAction> {
    if (!isRecord(operation) || !isRecord(operation.payload)
      || typeof operation.idempotencyKey !== 'string' || operation.idempotencyKey.trim().length < 8
      || operation.idempotencyKey.trim().length > 128) throw invalidQuery('Pencairan memerlukan Idempotency-Key 8–128 karakter.');
    const { amount, destinationId } = operation.payload;
    if (!positiveIdr(amount) || !isUuid(destinationId)) throw invalidQuery('Jumlah rupiah atau tujuan pencairan tidak valid.');
    const value = await this.api.request<unknown>('/v1/me/vet/withdrawals', {
      method: 'POST', idempotencyKey: operation.idempotencyKey,
      body: { amount, destinationId },
    });
    if (!isRecord(value) || !isUuid(value.operationId) || typeof value.replayed !== 'boolean'
      || !oneOf(value.adapterOutcome, OUTCOMES)) throw invalidResponse('Hasil pengajuan pencairan tidak sesuai kontrak.');
    const withdrawal = parseWithdrawal(value.withdrawal);
    if (value.operationId !== withdrawal.id || value.adapterOutcome !== withdrawal.adapterOutcome
      || withdrawal.amount !== amount || withdrawal.destination.id !== destinationId) {
      throw invalidResponse('Hasil pencairan tidak cocok dengan pengajuan.');
    }
    return { operationId: value.operationId, replayed: value.replayed, adapterOutcome: value.adapterOutcome, withdrawal };
  }
}

function resourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID server harus UUID.');
  return encodeURIComponent(value);
}

function nonnegativeIdr(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function positiveIdr(value: unknown): value is number { return nonnegativeIdr(value) && value > 0; }
function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

function parseDestination(value: unknown): ApiPayoutDestination {
  if (!isRecord(value) || !isUuid(value.id) || !isNonEmptyText(value.label, 200)
    || !isNonEmptyText(value.bankLabel, 200) || !isNonEmptyText(value.accountMasked, 100)
    || !isNonEmptyText(value.accountHolder, 200)) throw invalidResponse('Tujuan pencairan server tidak valid.');
  return { id: value.id, label: value.label, bankLabel: value.bankLabel,
    accountMasked: value.accountMasked, accountHolder: value.accountHolder };
}

function parseWithdrawal(value: unknown): ApiWithdrawal {
  if (!isRecord(value) || !isUuid(value.id) || !positiveIdr(value.amount)
    || !nonnegativeIdr(value.fee) || !nonnegativeIdr(value.netAmount)
    || value.amount - value.fee !== value.netAmount
    || !oneOf(value.status, WITHDRAWAL_STATUSES)
    || !(value.submittedAt === null || isIsoTimestampWithTimezone(value.submittedAt))
    || !oneOf(value.adapterOutcome, OUTCOMES)) throw invalidResponse('Pencairan server tidak sesuai kontrak rupiah.');
  const destination = parseDestination(value.destination);
  return { id: value.id, amount: value.amount, fee: value.fee, netAmount: value.netAmount,
    status: value.status, submittedAt: value.submittedAt as string | null,
    adapterOutcome: value.adapterOutcome, destination };
}

function parseTransaction(value: unknown): ApiEarningTransaction {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.consultationId)
    || !isNonEmptyText(value.displayCode, 100) || !isNonEmptyText(value.serviceLabel, 100)
    || !nonnegativeIdr(value.gross) || !nonnegativeIdr(value.commission) || !nonnegativeIdr(value.net)
    || value.gross - value.commission !== value.net
    || !oneOf(value.status, ['pending', 'available']) || !isIsoTimestampWithTimezone(value.earnedAt)) {
    throw invalidResponse('Transaksi pendapatan server tidak sesuai kontrak rupiah.');
  }
  return { id: value.id, consultationId: value.consultationId, displayCode: value.displayCode,
    serviceLabel: value.serviceLabel, gross: value.gross, commission: value.commission,
    net: value.net, status: value.status, earnedAt: value.earnedAt };
}

function parseEarnings(value: unknown): ApiEarnings {
  if (!isRecord(value) || typeof value.period !== 'string' || !PERIOD.test(value.period)
    || !isNonEmptyText(value.periodLabel, 100) || !Array.isArray(value.periods)
    || !isRecord(value.balances) || !isRecord(value.totals)
    || !Array.isArray(value.transactions) || !Array.isArray(value.withdrawals)
    || !Array.isArray(value.history) || !Array.isArray(value.destinations)) {
    throw invalidResponse('Ringkasan pendapatan server tidak sesuai kontrak.');
  }
  const page = parseReadPage({ items: value.transactions, nextCursor: value.nextCursor, hasMore: value.hasMore }, parseTransaction, 'transaksi');
  const balances = value.balances;
  const totals = value.totals;
  if (!nonnegativeIdr(balances.pending) || !nonnegativeIdr(balances.available)
    || !nonnegativeIdr(balances.reserved) || !nonnegativeIdr(balances.paidOut)
    || !nonnegativeIdr(totals.gross) || !nonnegativeIdr(totals.commission)
    || !nonnegativeIdr(totals.net) || totals.gross - totals.commission !== totals.net) {
    throw invalidResponse('Saldo atau total pendapatan server tidak sesuai kontrak rupiah.');
  }
  const periods = value.periods.map((period: unknown) => {
    if (!isRecord(period) || typeof period.value !== 'string' || !PERIOD.test(period.value)
      || !isNonEmptyText(period.label, 100)) throw invalidResponse('Daftar periode pendapatan tidak valid.');
    return { value: period.value, label: period.label };
  });
  return {
    period: value.period, periodLabel: value.periodLabel, periods,
    balances: { pending: balances.pending, available: balances.available, reserved: balances.reserved, paidOut: balances.paidOut },
    totals: { gross: totals.gross, commission: totals.commission, net: totals.net },
    transactions: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore,
    withdrawals: value.withdrawals.map(parseWithdrawal), history: value.history.map(parseWithdrawal),
    destinations: value.destinations.map(parseDestination),
  };
}
