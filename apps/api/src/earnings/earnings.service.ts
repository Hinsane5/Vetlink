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
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { adapterFailed, type AdapterResult } from '../communication/adapter-result.js';
import { DatabaseService } from '../database/database.service.js';
import {
  EARNING_SETTLEMENT_ADAPTER,
  WITHDRAWAL_SUBMISSION_ADAPTER,
  type EarningSettlementAdapter,
  type PayoutDestinationSnapshot,
  type WithdrawalSubmissionAdapter,
} from './earnings.adapter.js';
import type { ConsultationCompletionEarningsPort } from './earnings-completion.port.js';
import { CreateWithdrawalDto, EarningsQueryDto } from './earnings.dto.js';

type Row = Record<string, any>;
type Cursor = { at: string; id: string };
type EarningSettlementResult = AdapterResult<{ reference: string }>;
type PayoutResult = AdapterResult<{ status: 'processing' | 'paid' | 'rejected'; reference: string }>;

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validation(field: string, message: string): never {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Request validation failed', fieldErrors: { [field]: [message] } });
}

function storedIdr(value: string | number, field: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ServiceUnavailableException({ code: 'LEDGER_INVALID', message: `Nilai ${field} tersimpan di luar batas integer rupiah aman.` });
  }
  return result;
}

function inputIdr(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) validation('amount', 'Jumlah harus berupa integer rupiah positif.');
  return value;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ServiceUnavailableException({ code: 'DATA_INVALID', message: 'Timestamp finansial tidak valid.' });
  return date.toISOString();
}

function encodeCursor(at: Date | string, id: string): string {
  return Buffer.from(JSON.stringify({ at: timestamp(at), id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.at !== 'string' || !Number.isFinite(Date.parse(parsed.at))
      || typeof parsed.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.id)) throw new Error('invalid cursor');
    return { at: new Date(parsed.at).toISOString(), id: parsed.id };
  } catch {
    validation('cursor', 'Cursor tidak valid.');
  }
}

function periodLabel(period: string): string {
  const date = new Date(`${period}-01T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Periode tidak valid.' });
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function dateRange(query: EarningsQueryDto): { from: string; toExclusive: string; period: string; label: string } {
  if (query.period && (query.from || query.to)) validation('period', 'Gunakan period atau from/to, jangan keduanya.');
  if (Boolean(query.from) !== Boolean(query.to)) validation('from', 'from dan to harus dikirim bersamaan.');
  if (query.period) {
    const [year, month] = query.period.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return { from: start.toISOString(), toExclusive: end.toISOString(), period: query.period, label: periodLabel(query.period) };
  }
  if (query.from && query.to) {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T00:00:00.000Z`);
    if (from.toISOString().slice(0, 10) !== query.from || to.toISOString().slice(0, 10) !== query.to || from > to) {
      validation('from', 'Rentang tanggal harus valid dan from tidak melewati to.');
    }
    const end = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    const period = query.from.slice(0, 7) === query.to.slice(0, 7)
      ? query.from.slice(0, 7)
      : `${query.from}..${query.to}`;
    return {
      from: from.toISOString(), toExclusive: end.toISOString(), period,
      label: query.from.slice(0, 7) === query.to.slice(0, 7) ? periodLabel(period) : `${query.from} – ${query.to}`,
    };
  }
  const period = currentPeriod();
  const [year, month] = period.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    toExclusive: new Date(Date.UTC(year, month, 1)).toISOString(),
    period,
    label: periodLabel(period),
  };
}

function destinationSnapshot(value: unknown): PayoutDestinationSnapshot {
  if (!value || typeof value !== 'object') throw new ServiceUnavailableException({ code: 'DATA_INVALID', message: 'Snapshot tujuan pencairan tidak valid.' });
  const row = value as Record<string, unknown>;
  const fields = ['id', 'label', 'bankLabel', 'accountMasked', 'accountHolder'] as const;
  if (fields.some((field) => typeof row[field] !== 'string' || !row[field])) {
    throw new ServiceUnavailableException({ code: 'DATA_INVALID', message: 'Snapshot tujuan pencairan tidak lengkap.' });
  }
  return {
    id: row.id as string,
    label: row.label as string,
    bankLabel: row.bankLabel as string,
    accountMasked: row.accountMasked as string,
    accountHolder: row.accountHolder as string,
  };
}

function destinationView(row: Row): PayoutDestinationSnapshot {
  return {
    id: row.id,
    label: row.label,
    bankLabel: row.bank_label,
    accountMasked: row.account_masked,
    accountHolder: row.account_holder,
  };
}

@Injectable()
export class EarningsService implements ConsultationCompletionEarningsPort {
  constructor(
    private readonly database: DatabaseService,
    @Inject(EARNING_SETTLEMENT_ADAPTER) private readonly settlementAdapter: EarningSettlementAdapter,
    @Inject(WITHDRAWAL_SUBMISSION_ADAPTER) private readonly withdrawalAdapter: WithdrawalSubmissionAdapter,
  ) {}

  async createForCompletedConsultation(client: PoolClient, consultationId: string): Promise<string> {
    const query = await client.query<Row>(
      `SELECT c.id AS consultation_id, c.vet_id, c.status AS consultation_status,
              c.completion_at, c.fee_snapshot_idr::text AS gross_idr,
              c.commission_snapshot_idr::text AS commission_idr,
              n.status AS note_status, p.id AS payment_id, p.amount_idr::text AS payment_amount_idr,
              p.status AS payment_status, p.owner_id
       FROM consultations c
       JOIN clinical_notes n ON n.consultation_id = c.id AND n.status = 'final'
       JOIN payments p ON p.owner_id = c.farmer_id AND p.payable_type = 'consultation'
         AND p.payable_id = c.id AND p.status = 'succeeded' AND p.amount_idr = c.fee_snapshot_idr
       WHERE c.id = $1 AND c.status = 'completed' AND c.completion_at IS NOT NULL
       FOR UPDATE OF c`,
      [consultationId],
    );
    if (query.rowCount !== 1) {
      throw new ConflictException({ code: 'EARNING_NOT_ELIGIBLE', message: 'Pendapatan hanya dibuat untuk layanan selesai dengan catatan final dan pembayaran sukses yang cocok.' });
    }
    const source = query.rows[0];
    const gross = storedIdr(source.gross_idr, 'gross');
    const commission = storedIdr(source.commission_idr, 'commission');
    const paid = storedIdr(source.payment_amount_idr, 'payment');
    if (paid !== gross || commission > gross) {
      throw new ConflictException({ code: 'EARNING_SOURCE_MISMATCH', message: 'Snapshot pembayaran atau komisi tidak cocok dengan layanan.' });
    }
    const net = gross - commission;
    await client.query(
      `INSERT INTO earning_transactions(vet_id, consultation_id, payment_id, gross_idr, commission_idr, net_idr)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (consultation_id) DO NOTHING`,
      [source.vet_id, source.consultation_id, source.payment_id, gross, commission, net],
    );
    const earningResult = await client.query<Row>(
      `SELECT id, vet_id, payment_id, gross_idr::text, commission_idr::text, net_idr::text
       FROM earning_transactions WHERE consultation_id=$1 FOR UPDATE`,
      [consultationId],
    );
    const earning = earningResult.rows[0];
    if (!earning || earning.vet_id !== source.vet_id || earning.payment_id !== source.payment_id
      || storedIdr(earning.gross_idr, 'gross') !== gross
      || storedIdr(earning.commission_idr, 'commission') !== commission
      || storedIdr(earning.net_idr, 'net') !== net) {
      throw new ConflictException({ code: 'EARNING_SOURCE_MISMATCH', message: 'Pendapatan yang sudah tercatat berbeda dari snapshot layanan.' });
    }
    if (net > 0) {
      await client.query(
        `INSERT INTO ledger_entries(vet_id, earning_id, kind, amount_idr, operation_key)
         VALUES($1,$2,'earn_pending',$3,$4) ON CONFLICT (operation_key) DO NOTHING`,
        [source.vet_id, earning.id, net, `earning:${earning.id}:pending`],
      );
    }
    return earning.id as string;
  }

  async settleEarning(earningId: string): Promise<void> {
    let result: EarningSettlementResult;
    try {
      result = await this.settlementAdapter.settle(earningId, `earning-settlement:${earningId}`);
    } catch {
      result = adapterFailed('SERVICE_UNAVAILABLE', 'Adapter settlement lokal gagal.', true);
    }
    await this.recordEarningSettlementResult(earningId, result);
  }

  /** Internal adapter-result hook; it is deliberately not exposed as a public mutation route. */
  async recordEarningSettlementResult(earningId: string, result: EarningSettlementResult) {
    const fingerprint = sha256({ earningId, outcome: result.status, reference: result.status === 'failed' ? null : result.value.reference,
      errorCode: result.status === 'failed' ? result.error.code : null });
    return this.database.transaction(async (client) => {
      const owner = await client.query<{ vet_id: string }>('SELECT vet_id FROM earning_transactions WHERE id=$1', [earningId]);
      if (!owner.rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transaksi pendapatan tidak ditemukan.' });
      await this.lockVet(client, owner.rows[0].vet_id);
      const earningResult = await client.query<Row>(
        'SELECT id,vet_id,net_idr::text,status FROM earning_transactions WHERE id=$1 FOR UPDATE', [earningId]);
      const earning = earningResult.rows[0];
      const seen = await client.query<Row>('SELECT earning_id,request_fingerprint,outcome FROM earning_settlement_events WHERE event_id=$1', [result.operationId]);
      if (seen.rows[0]) {
        if (seen.rows[0].earning_id !== earningId || seen.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException({ code: 'ADAPTER_EVENT_CONFLICT', message: 'Event settlement telah digunakan dengan hasil berbeda.' });
        }
        return { earningId, status: earning.status, duplicate: true };
      }
      await client.query(
        `INSERT INTO earning_settlement_events(earning_id,event_id,outcome,request_fingerprint,service_reference,error_code,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()))`,
        [earningId, result.operationId, result.status, fingerprint,
          result.status === 'failed' ? null : result.value.reference,
          result.status === 'failed' ? result.error.code : null,
          result.occurredAt],
      );
      if (result.status !== 'succeeded' || earning.status === 'available') {
        return { earningId, status: earning.status, duplicate: false };
      }
      const net = storedIdr(earning.net_idr, 'net');
      if (net > 0) {
        await client.query(
          `INSERT INTO ledger_entries(vet_id,earning_id,kind,amount_idr,operation_key)
           VALUES($1,$2,'release_pending',$3,$4) ON CONFLICT (operation_key) DO NOTHING`,
          [earning.vet_id, earningId, net, `earning:${earningId}:release-pending`],
        );
        await client.query(
          `INSERT INTO ledger_entries(vet_id,earning_id,kind,amount_idr,operation_key)
           VALUES($1,$2,'credit_available',$3,$4) ON CONFLICT (operation_key) DO NOTHING`,
          [earning.vet_id, earningId, net, `earning:${earningId}:available`],
        );
      }
      await client.query("UPDATE earning_transactions SET status='available' WHERE id=$1 AND status='pending'", [earningId]);
      return { earningId, status: 'available', duplicate: false };
    });
  }

  async earnings(principal: AuthenticatedPrincipal, query: EarningsQueryDto) {
    this.requireVetRole(principal);
    await this.requireVetProfile(principal.userId);
    const range = dateRange(query);
    const limit = query.limit ?? 100;
    const cursor = decodeCursor(query.cursor);
    return this.database.transaction(async (client) => {
      const balance = await this.balanceForVet(client, principal.userId);
      const totalsResult = await client.query<Row>(
        `SELECT COALESCE(sum(gross_idr),0)::text AS gross,
                COALESCE(sum(commission_idr),0)::text AS commission,
                COALESCE(sum(net_idr),0)::text AS net
         FROM earning_transactions WHERE vet_id=$1 AND earned_at >= $2 AND earned_at < $3`,
        [principal.userId, range.from, range.toExclusive],
      );
      const totals = {
        gross: storedIdr(totalsResult.rows[0].gross, 'gross'),
        commission: storedIdr(totalsResult.rows[0].commission, 'commission'),
        net: storedIdr(totalsResult.rows[0].net, 'net'),
      };
      if (totals.gross - totals.commission !== totals.net) {
        throw new ServiceUnavailableException({ code: 'LEDGER_INVALID', message: 'Total pendapatan tidak cocok dengan gross dikurangi komisi.' });
      }
      const params: unknown[] = [principal.userId, range.from, range.toExclusive];
      let cursorClause = '';
      if (cursor) {
        params.push(cursor.at, cursor.id);
        cursorClause = `AND (e.earned_at,e.id) < ($4::timestamptz,$5::uuid)`;
      }
      params.push(limit + 1);
      const rows = await client.query<Row>(
        `SELECT e.id,e.consultation_id,e.gross_idr::text,e.commission_idr::text,e.net_idr::text,
                e.status,e.earned_at,c.display_code,c.service_type
         FROM earning_transactions e JOIN consultations c ON c.id=e.consultation_id AND c.vet_id=e.vet_id
         WHERE e.vet_id=$1 AND e.earned_at >= $2 AND e.earned_at < $3 ${cursorClause}
         ORDER BY e.earned_at DESC,e.id DESC LIMIT $${params.length}`,
        params,
      );
      const hasMore = rows.rows.length > limit;
      const pageRows = rows.rows.slice(0, limit);
      const transactions = pageRows.map((row) => this.earningView(row));
      const lastEarning = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && lastEarning ? encodeCursor(lastEarning.earned_at, lastEarning.id) : null;
      const withdrawals = await this.withdrawalRows(client, principal.userId);
      const periodWithdrawals = withdrawals.filter((row) => {
        const at = row.submitted_at ?? row.created_at;
        return new Date(at).getTime() >= Date.parse(range.from) && new Date(at).getTime() < Date.parse(range.toExclusive);
      });
      const destinations = await this.destinationRows(client, principal.userId);
      const periodsResult = await client.query<{ period: string }>(
        `SELECT period FROM (
           SELECT to_char(earned_at AT TIME ZONE 'UTC','YYYY-MM') AS period FROM earning_transactions WHERE vet_id=$1
           UNION SELECT to_char(COALESCE(submitted_at,created_at) AT TIME ZONE 'UTC','YYYY-MM') AS period FROM withdrawals WHERE vet_id=$1
         ) periods ORDER BY period DESC LIMIT 24`,
        [principal.userId],
      );
      const periods = [...new Set([currentPeriod(), ...periodsResult.rows.map((row) => row.period)])]
        .sort((left, right) => right.localeCompare(left)).map((value) => ({ value, label: periodLabel(value) }));
      return {
        period: range.period,
        periodLabel: range.label,
        periods,
        balances: balance,
        totals,
        transactions,
        nextCursor,
        hasMore,
        withdrawals: periodWithdrawals.map((row) => this.withdrawalView(row)),
        history: withdrawals.map((row) => this.withdrawalView(row)),
        destinations: destinations.map(destinationView),
      };
    });
  }

  async getTransaction(principal: AuthenticatedPrincipal, earningId: string) {
    this.requireVetRole(principal);
    const result = await this.database.query<Row>(
      `SELECT e.id,e.consultation_id,e.gross_idr::text,e.commission_idr::text,e.net_idr::text,
              e.status,e.earned_at,c.display_code,c.service_type
       FROM earning_transactions e JOIN consultations c ON c.id=e.consultation_id AND c.vet_id=e.vet_id
       WHERE e.id=$1 AND e.vet_id=$2`,
      [earningId, principal.userId],
    );
    if (!result.rows[0]) throw this.notFound('Transaksi pendapatan tidak ditemukan.');
    return this.earningView(result.rows[0]);
  }

  async payoutDestinations(principal: AuthenticatedPrincipal) {
    this.requireVetRole(principal);
    await this.requireVetProfile(principal.userId);
    const destinations = await this.database.query<Row>(
      `SELECT id,label,bank_label,account_masked,account_holder
       FROM payout_destinations WHERE vet_id=$1 AND active=true ORDER BY created_at,id`,
      [principal.userId],
    );
    return { items: destinations.rows.map(destinationView) };
  }

  async withdrawals(principal: AuthenticatedPrincipal, query: { limit?: number; cursor?: string }) {
    this.requireVetRole(principal);
    await this.requireVetProfile(principal.userId);
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const params: unknown[] = [principal.userId];
    let cursorClause = '';
    if (cursor) {
      params.push(cursor.at, cursor.id);
      cursorClause = `AND (COALESCE(submitted_at,created_at),id) < ($2::timestamptz,$3::uuid)`;
    }
    params.push(limit + 1);
    const rows = await this.database.query<Row>(
      `SELECT * FROM withdrawals WHERE vet_id=$1 ${cursorClause}
       ORDER BY COALESCE(submitted_at,created_at) DESC,id DESC LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.rows.length > limit;
    const page = rows.rows.slice(0, limit);
    const lastWithdrawal = page[page.length - 1];
    return {
      items: page.map((row) => this.withdrawalView(row)),
      nextCursor: hasMore && lastWithdrawal ? encodeCursor(lastWithdrawal.submitted_at ?? lastWithdrawal.created_at, lastWithdrawal.id) : null,
      hasMore,
    };
  }

  async getWithdrawal(principal: AuthenticatedPrincipal, withdrawalId: string) {
    this.requireVetRole(principal);
    const result = await this.database.query<Row>('SELECT * FROM withdrawals WHERE id=$1 AND vet_id=$2', [withdrawalId, principal.userId]);
    if (!result.rows[0]) throw this.notFound('Riwayat pencairan tidak ditemukan.');
    return this.withdrawalView(result.rows[0]);
  }

  async createWithdrawal(principal: AuthenticatedPrincipal, key: string | undefined, input: CreateWithdrawalDto) {
    this.requireVetRole(principal);
    const operationKey = key?.trim();
    if (!operationKey || operationKey.length < 8 || operationKey.length > 128) validation('Idempotency-Key', 'Idempotency-Key harus sepanjang 8–128 karakter.');
    const amount = inputIdr(input.amount);
    const fingerprint = sha256({ amount, destinationId: input.destinationId });
    const prepared = await this.database.transaction(async (client) => {
      await this.lockVet(client, principal.userId);
      const existingResult = await client.query<Row>(
        'SELECT * FROM withdrawals WHERE vet_id=$1 AND operation_key=$2 FOR UPDATE',
        [principal.userId, operationKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency-Key telah dipakai dengan payload berbeda.' });
        }
        if (existing.status === 'failed') {
          throw new ServiceUnavailableException({ code: 'WITHDRAWAL_FAILED', message: 'Adapter pencairan sebelumnya gagal; gunakan pengajuan baru setelah saldo tersedia kembali.' });
        }
        return { row: existing, replayed: true, shouldSubmit: existing.status === 'submitting' };
      }

      const destinationResult = await client.query<Row>(
        `SELECT id,label,bank_label,account_masked,account_holder
         FROM payout_destinations WHERE id=$1 AND vet_id=$2 AND active=true`,
        [input.destinationId, principal.userId],
      );
      if (!destinationResult.rows[0]) throw this.notFound('Tujuan pencairan tidak ditemukan.');
      const destination = destinationView(destinationResult.rows[0]);
      const balances = await this.balanceForVet(client, principal.userId);
      if (balances.available <= 0) throw new UnprocessableEntityException({ code: 'BALANCE_UNAVAILABLE', message: 'Saldo tersedia belum dapat dicairkan.' });
      if (amount > balances.available) throw new UnprocessableEntityException({ code: 'AMOUNT_EXCEEDS_AVAILABLE', message: 'Jumlah melebihi saldo tersedia.' });

      const inserted = await client.query<Row>(
        `INSERT INTO withdrawals(vet_id,destination_id,destination_snapshot,amount_idr,fee_snapshot_idr,net_amount_idr,
                                status,operation_key,request_fingerprint,adapter_outcome)
         VALUES($1,$2,$3::jsonb,$4,0,$4,'submitting',$5,$6,'pending') RETURNING *`,
        [principal.userId, destination.id, JSON.stringify(destination), amount, operationKey, fingerprint],
      );
      const withdrawal = inserted.rows[0];
      await client.query(
        `INSERT INTO ledger_entries(vet_id,withdrawal_id,kind,amount_idr,operation_key)
         VALUES($1,$2,'reserve_withdrawal',$3,$4)`,
        [principal.userId, withdrawal.id, amount, `withdrawal:${withdrawal.id}:reserve`],
      );
      return { row: withdrawal, replayed: false, shouldSubmit: true };
    });

    if (!prepared.shouldSubmit) {
      return { operationId: prepared.row.id, replayed: true, adapterOutcome: prepared.row.adapter_outcome, withdrawal: this.withdrawalView(prepared.row) };
    }

    const destination = destinationSnapshot(prepared.row.destination_snapshot);
    let result: AdapterResult<{ reference: string }>;
    try {
      result = await this.withdrawalAdapter.submit({
        withdrawalId: prepared.row.id,
        operationKey,
        amountIdr: amount,
        destination,
      });
    } catch {
      result = adapterFailed('SERVICE_UNAVAILABLE', 'Adapter pencairan lokal gagal.', true);
    }
    const applied = await this.recordWithdrawalSubmissionResult(prepared.row.id, result);
    if (applied.adapterOutcome === 'failed') {
      throw new ServiceUnavailableException({ code: 'WITHDRAWAL_FAILED', message: 'Adapter pencairan gagal; reservasi saldo telah dilepas.' });
    }
    return {
      operationId: prepared.row.id,
      replayed: prepared.replayed,
      adapterOutcome: applied.adapterOutcome,
      withdrawal: this.withdrawalView(applied.row),
    };
  }

  /** Internal payout adapter hook; no public callback route is enabled for BE-15. */
  async recordPayoutAdapterResult(withdrawalId: string, result: PayoutResult) {
    const targetStatus = result.status === 'succeeded' ? result.value.status : result.status === 'failed' ? 'failed' : null;
    const reference = result.status === 'failed' ? null : result.value.reference;
    const fingerprint = sha256({ withdrawalId, eventType: 'payout', outcome: result.status, targetStatus, reference,
      errorCode: result.status === 'failed' ? result.error.code : null });
    return this.database.transaction(async (client) => {
      const owner = await client.query<{ vet_id: string }>('SELECT vet_id FROM withdrawals WHERE id=$1', [withdrawalId]);
      if (!owner.rows[0]) throw this.notFound('Riwayat pencairan tidak ditemukan.');
      await this.lockVet(client, owner.rows[0].vet_id);
      const currentResult = await client.query<Row>('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [withdrawalId]);
      const current = currentResult.rows[0];
      const seen = await client.query<Row>('SELECT withdrawal_id,request_fingerprint FROM withdrawal_adapter_events WHERE event_id=$1', [result.operationId]);
      if (seen.rows[0]) {
        if (seen.rows[0].withdrawal_id !== withdrawalId || seen.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException({ code: 'ADAPTER_EVENT_CONFLICT', message: 'Event pencairan telah digunakan dengan hasil berbeda.' });
        }
        return { withdrawal: this.withdrawalView(current), duplicate: true };
      }
      if (current.status === 'paid' && result.status === 'succeeded' && result.value.status === 'paid') {
        return { withdrawal: this.withdrawalView(current), duplicate: true };
      }
      if (!['submitted', 'processing'].includes(current.status)) {
        throw new ConflictException({ code: 'WITHDRAWAL_STATE_CONFLICT', message: 'Hasil payout hanya dapat diproses untuk pengajuan yang telah diterima adapter.' });
      }
      await client.query(
        `INSERT INTO withdrawal_adapter_events(withdrawal_id,event_id,event_type,outcome,target_status,request_fingerprint,service_reference,error_code,occurred_at)
         VALUES($1,$2,'payout',$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now()))`,
        [withdrawalId, result.operationId, result.status, targetStatus, fingerprint, reference,
          result.status === 'failed' ? result.error.code : null, result.occurredAt],
      );
      if (result.status === 'pending') return { withdrawal: this.withdrawalView(current), duplicate: false };

      if (result.status === 'failed' || result.value.status === 'rejected') {
        const target = result.status === 'failed' ? 'failed' : 'rejected';
        await this.releaseWithdrawal(client, current);
        const updated = await client.query<Row>(
          'UPDATE withdrawals SET status=$2,adapter_outcome=$3,updated_at=now() WHERE id=$1 RETURNING *',
          [withdrawalId, target, result.status],
        );
        return { withdrawal: this.withdrawalView(updated.rows[0]), duplicate: false };
      }
      if (result.value.status === 'paid') {
        await client.query(
          `INSERT INTO ledger_entries(vet_id,withdrawal_id,kind,amount_idr,operation_key)
           VALUES($1,$2,'payout_paid',$3,$4) ON CONFLICT (operation_key) DO NOTHING`,
          [current.vet_id, current.id, storedIdr(current.amount_idr, 'withdrawal'), `withdrawal:${current.id}:paid`],
        );
      }
      const target = result.value.status;
      const updated = await client.query<Row>(
        'UPDATE withdrawals SET status=$2,adapter_reference=COALESCE($3,adapter_reference),updated_at=now() WHERE id=$1 RETURNING *',
        [withdrawalId, target, reference],
      );
      return { withdrawal: this.withdrawalView(updated.rows[0]), duplicate: false };
    });
  }

  /** Internal adapter-result hook; a pending submission keeps its existing reservation. */
  async recordWithdrawalSubmissionResult(withdrawalId: string, result: AdapterResult<{ reference: string }>) {
    const fingerprint = sha256({ withdrawalId, eventType: 'submission', outcome: result.status,
      reference: result.status === 'failed' ? null : result.value.reference,
      errorCode: result.status === 'failed' ? result.error.code : null });
    return this.database.transaction(async (client) => {
      const owner = await client.query<{ vet_id: string }>('SELECT vet_id FROM withdrawals WHERE id=$1', [withdrawalId]);
      if (!owner.rows[0]) throw this.notFound('Riwayat pencairan tidak ditemukan.');
      await this.lockVet(client, owner.rows[0].vet_id);
      const currentResult = await client.query<Row>('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [withdrawalId]);
      const current = currentResult.rows[0];
      const seen = await client.query<Row>('SELECT withdrawal_id,request_fingerprint FROM withdrawal_adapter_events WHERE event_id=$1', [result.operationId]);
      if (seen.rows[0]) {
        if (seen.rows[0].withdrawal_id !== withdrawalId || seen.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException({ code: 'ADAPTER_EVENT_CONFLICT', message: 'Event pengajuan telah digunakan dengan hasil berbeda.' });
        }
        return { row: current, adapterOutcome: result.status };
      }
      if (current.status !== 'submitting') return { row: current, adapterOutcome: current.adapter_outcome };
      await client.query(
        `INSERT INTO withdrawal_adapter_events(withdrawal_id,event_id,event_type,outcome,target_status,request_fingerprint,service_reference,error_code,occurred_at)
         VALUES($1,$2,'submission',$3,NULL,$4,$5,$6,COALESCE($7::timestamptz,now()))`,
        [withdrawalId, result.operationId, result.status, fingerprint,
          result.status === 'failed' ? null : result.value.reference,
          result.status === 'failed' ? result.error.code : null, result.occurredAt],
      );
      if (result.status === 'pending') {
        const updated = await client.query<Row>(
          "UPDATE withdrawals SET adapter_outcome='pending',adapter_reference=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [withdrawalId, result.value.reference],
        );
        return { row: updated.rows[0], adapterOutcome: 'pending' as const };
      }
      if (result.status === 'failed') {
        await this.releaseWithdrawal(client, current);
        const updated = await client.query<Row>(
          "UPDATE withdrawals SET status='failed',adapter_outcome='failed',updated_at=now() WHERE id=$1 RETURNING *",
          [withdrawalId],
        );
        return { row: updated.rows[0], adapterOutcome: 'failed' as const };
      }
      const updated = await client.query<Row>(
        `UPDATE withdrawals SET status='submitted',adapter_outcome='succeeded',adapter_reference=$2,
                submitted_at=COALESCE(submitted_at,now()),updated_at=now() WHERE id=$1 RETURNING *`,
        [withdrawalId, result.value.reference],
      );
      return { row: updated.rows[0], adapterOutcome: 'succeeded' as const };
    });
  }

  private async releaseWithdrawal(client: PoolClient, row: Row): Promise<void> {
    await client.query(
      `INSERT INTO ledger_entries(vet_id,withdrawal_id,kind,amount_idr,operation_key)
       VALUES($1,$2,'release_withdrawal',$3,$4) ON CONFLICT (operation_key) DO NOTHING`,
      [row.vet_id, row.id, storedIdr(row.amount_idr, 'withdrawal'), `withdrawal:${row.id}:release`],
    );
  }

  private async balanceForVet(client: PoolClient, vetId: string) {
    const result = await client.query<Row>(
      `SELECT
         (COALESCE(sum(amount_idr) FILTER (WHERE kind='earn_pending'),0) - COALESCE(sum(amount_idr) FILTER (WHERE kind='release_pending'),0))::text AS pending,
         (COALESCE(sum(amount_idr) FILTER (WHERE kind='credit_available'),0) - COALESCE(sum(amount_idr) FILTER (WHERE kind='reserve_withdrawal'),0) + COALESCE(sum(amount_idr) FILTER (WHERE kind='release_withdrawal'),0))::text AS available,
         (COALESCE(sum(amount_idr) FILTER (WHERE kind='reserve_withdrawal'),0) - COALESCE(sum(amount_idr) FILTER (WHERE kind='release_withdrawal'),0) - COALESCE(sum(amount_idr) FILTER (WHERE kind='payout_paid'),0))::text AS reserved,
         COALESCE(sum(amount_idr) FILTER (WHERE kind='payout_paid'),0)::text AS "paidOut"
       FROM ledger_entries WHERE vet_id=$1`,
      [vetId],
    );
    const values = result.rows[0];
    const balances = {
      pending: storedIdr(values.pending, 'pending'),
      available: storedIdr(values.available, 'available'),
      reserved: storedIdr(values.reserved, 'reserved'),
      paidOut: storedIdr(values.paidOut, 'paidOut'),
    };
    return balances;
  }

  private async withdrawalRows(client: PoolClient, vetId: string): Promise<Row[]> {
    const rows = await client.query<Row>(
      'SELECT * FROM withdrawals WHERE vet_id=$1 ORDER BY COALESCE(submitted_at,created_at) DESC,id DESC', [vetId]);
    return rows.rows;
  }

  private async destinationRows(client: PoolClient, vetId: string): Promise<Row[]> {
    const rows = await client.query<Row>(
      `SELECT id,label,bank_label,account_masked,account_holder
       FROM payout_destinations WHERE vet_id=$1 AND active=true ORDER BY created_at,id`, [vetId]);
    return rows.rows;
  }

  private earningView(row: Row) {
    const gross = storedIdr(row.gross_idr, 'gross');
    const commission = storedIdr(row.commission_idr, 'commission');
    const net = storedIdr(row.net_idr, 'net');
    if (gross - commission !== net) throw new ServiceUnavailableException({ code: 'LEDGER_INVALID', message: 'Rincian pendapatan tidak cocok.' });
    return {
      id: row.id,
      consultationId: row.consultation_id,
      displayCode: row.display_code,
      serviceLabel: row.service_type === 'visit' ? 'Kunjungan' : 'Konsultasi',
      gross,
      commission,
      net,
      status: row.status,
      earnedAt: timestamp(row.earned_at),
    };
  }

  private withdrawalView(row: Row) {
    const amount = storedIdr(row.amount_idr, 'withdrawal');
    const fee = storedIdr(row.fee_snapshot_idr, 'withdrawal fee');
    const netAmount = storedIdr(row.net_amount_idr, 'withdrawal net');
    if (amount - fee !== netAmount) throw new ServiceUnavailableException({ code: 'LEDGER_INVALID', message: 'Rincian pencairan tidak cocok.' });
    return {
      id: row.id,
      amount,
      fee,
      netAmount,
      status: row.status,
      submittedAt: row.submitted_at ? timestamp(row.submitted_at) : null,
      adapterOutcome: row.adapter_outcome ?? 'pending',
      destination: destinationSnapshot(row.destination_snapshot),
    };
  }

  private async lockVet(client: PoolClient, vetId: string): Promise<void> {
    const profile = await client.query('SELECT user_id FROM vet_profiles WHERE user_id=$1 FOR UPDATE', [vetId]);
    if (profile.rowCount !== 1) throw this.notFound('Profil Dokter tidak ditemukan.');
  }

  private async requireVetProfile(vetId: string): Promise<void> {
    const profile = await this.database.query('SELECT user_id FROM vet_profiles WHERE user_id=$1', [vetId]);
    if (profile.rowCount !== 1) throw this.notFound('Profil Dokter tidak ditemukan.');
  }

  private requireVetRole(principal: AuthenticatedPrincipal): void {
    if (principal.activeRole !== 'vet' || !principal.roles.includes('vet')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Hanya Dokter dapat mengakses pendapatan dan pencairan.' });
    }
  }

  private notFound(message = 'Resource tidak ditemukan.') {
    return new NotFoundException({ code: 'NOT_FOUND', message });
  }
}
