import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import { calculateWalletBalances, type LedgerEntryKind, type LedgerMovement, type WalletBalances } from '../domain/ledger';
import type { AccountRole } from '../domain/auth';
import type { DomainRepository } from './ports/DomainRepository';
import type { IdFactory } from './ports/AuthRepository';
import type { EarningsRepository } from './ports/EarningsRepository';

export type EarningsPeriod = string;
export type EarningStatus = 'pending' | 'available';
export type WithdrawalStatus = 'submitted' | 'processing' | 'paid' | 'rejected' | 'failed';

export interface EarningSnapshot {
  id: string;
  consultationId: string;
  displayCode: string;
  serviceLabel: string;
  gross: number;
  commission: number;
  net: number;
  status: EarningStatus;
  earnedAt: string;
}

export interface PayoutDestinationSnapshot {
  id: string;
  bankLabel: string;
  accountMasked: string;
  accountHolder: string;
  label: string;
}

export interface WithdrawalSnapshot {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: WithdrawalStatus;
  submittedAt: string;
  destination: PayoutDestinationSnapshot;
}

export interface EarningsTotals {
  gross: number;
  commission: number;
  net: number;
}

export interface EarningsSnapshot {
  vetId: string;
  period: EarningsPeriod;
  periodLabel: string;
  periods: { value: EarningsPeriod; label: string }[];
  balances: WalletBalances;
  totals: EarningsTotals;
  transactions: EarningSnapshot[];
  withdrawals: WithdrawalSnapshot[];
  history: WithdrawalSnapshot[];
  destinations: PayoutDestinationSnapshot[];
}

const ledgerKinds = new Set<LedgerEntryKind>([
  'earn_pending',
  'release_pending',
  'credit_available',
  'reserve_withdrawal',
  'release_withdrawal',
  'payout_paid',
]);

const withdrawalStatuses = new Set<WithdrawalStatus>([
  'submitted',
  'processing',
  'paid',
  'rejected',
  'failed',
]);

const monthNames = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Read-only earnings projections and local withdrawal commands. A withdrawal is
 * recorded as submitted only after the withdrawal and reserve ledger entry commit.
 */
export class EarningsService {
  constructor(
    private readonly repository: EarningsRepository,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  newWithdrawalOperationKey(): string {
    return this.ids.create();
  }

  async load(userId: string, role: AccountRole, requestedPeriod?: EarningsPeriod): Promise<EarningsSnapshot> {
    assertVet(role);
    return this.repository.transact(async (repository) => {
      const data = await this.readData(repository, userId);
      const currentPeriod = periodForDate(this.now());
      const period = requestedPeriod ?? currentPeriod;
      assertPeriod(period);
      const periods = buildPeriods(data.earnings, data.withdrawals, currentPeriod);
      const transactions = data.earnings.filter((entry) => periodForDate(new Date(entry.earnedAt)) === period);
      const withdrawals = data.withdrawals.filter((entry) => periodForDate(new Date(entry.submittedAt)) === period);
      return {
        vetId: userId,
        period,
        periodLabel: labelPeriod(period),
        periods,
        balances: data.balances,
        totals: sumEarnings(transactions),
        transactions,
        withdrawals,
        history: data.withdrawals,
        destinations: data.destinations,
      };
    });
  }

  async getTransaction(userId: string, role: AccountRole, earningId: string): Promise<EarningSnapshot> {
    assertVet(role);
    return this.repository.transact(async (repository) => {
      const data = await this.readData(repository, userId);
      const earning = data.earnings.find((item) => item.id === earningId);
      if (!earning) throw new DomainError('NOT_FOUND', 'Transaksi pendapatan tidak ditemukan.');
      return earning;
    });
  }

  async getWithdrawal(userId: string, role: AccountRole, withdrawalId: string): Promise<WithdrawalSnapshot> {
    assertVet(role);
    return this.repository.transact(async (repository) => {
      const record = await repository.findById('withdrawal', withdrawalId);
      if (!record || record.ownerId !== userId || record.payload.vetId !== userId) {
        throw new DomainError('NOT_FOUND', 'Riwayat pencairan tidak ditemukan.');
      }
      return toWithdrawalSnapshot(record);
    });
  }

  async submitWithdrawal(
    userId: string,
    role: AccountRole,
    amount: number,
    destinationId: string,
    operationKey: string,
  ): Promise<WithdrawalSnapshot> {
    assertVet(role);
    assertAmount(amount);
    const key = operationKey.trim();
    if (key.length < 8 || key.length > 128) {
      throw new DomainError('VALIDATION_FAILED', 'Kunci pengajuan tidak valid.');
    }
    if (!destinationId.trim()) throw new DomainError('VALIDATION_FAILED', 'Pilih tujuan pencairan.');

    return this.repository.transact(async (repository) => {
      const [withdrawalRecords, ledgerRecords, destinationRecords] = await Promise.all([
        repository.listByOwner('withdrawal', userId),
        repository.listByOwner('ledgerEntry', userId),
        repository.listByOwner('payoutDestination', userId),
      ]);
      const withdrawals = withdrawalRecords.filter((item) => belongsToVet(item, userId));
      const ledger = movementsForVet(ledgerRecords, userId);
      const destination = destinationRecords.find((item) =>
        item.kind === 'payoutDestination' && item.ownerId === userId && item.payload.vetId === userId && item.id === destinationId,
      );
      if (!destination) throw new DomainError('NOT_FOUND', 'Tujuan pencairan tidak ditemukan.');

      const duplicate = withdrawals.filter((item) => item.payload.operationKey === key);
      if (duplicate.length > 1) throw new DomainError('INVALID_STATE', 'Kunci pengajuan memiliki lebih dari satu transaksi.');
      if (duplicate[0]) {
        const existing = duplicate[0];
        const samePayload = existing.payload.vetId === userId
          && existing.payload.amount === amount
          && existing.contextId === destinationId;
        if (!samePayload) throw new DomainError('VERSION_CONFLICT', 'Kunci operasi sudah digunakan untuk pengajuan lain.');
        assertReservationExists(ledgerRecords, userId, existing, amount);
        return toWithdrawalSnapshot(existing);
      }

      const balances = calculateWalletBalances(ledger);
      if (balances.available <= 0) throw new DomainError('INVALID_STATE', 'Saldo tersedia belum dapat dicairkan.');
      if (amount > balances.available) throw new DomainError('VALIDATION_FAILED', 'Jumlah melebihi saldo tersedia.');

      const timestamp = this.now().toISOString();
      const destinationSnapshot = toDestinationSnapshot(destination);
      const withdrawalId = this.ids.create();
      const withdrawal = makeEntity('withdrawal', userId, destinationId, withdrawalId, timestamp, {
        vetId: userId,
        destinationId,
        destinationSnapshot: {
          destinationId,
          bankLabel: destinationSnapshot.bankLabel,
          accountMasked: destinationSnapshot.accountMasked,
          accountHolder: destinationSnapshot.accountHolder,
        },
        amount,
        feeSnapshot: 0,
        netAmount: amount,
        status: 'submitted',
        operationKey: key,
        submittedAt: timestamp,
        serviceReference: null,
      });
      const reserve = makeEntity('ledgerEntry', userId, withdrawalId, this.ids.create(), timestamp, {
        vetId: userId,
        withdrawalId,
        kind: 'reserve_withdrawal',
        amount,
        operationKey: `reserve-withdrawal:${key}`,
        occurredAt: timestamp,
      });
      const withdrawalRelations: EntityRelation[] = [
        { sourceId: withdrawal.id, targetId: userId, relationship: 'vet' },
        { sourceId: withdrawal.id, targetId: destinationId, relationship: 'destination' },
      ];
      await repository.create(withdrawal, withdrawalRelations);
      await repository.create(reserve, [{ sourceId: reserve.id, targetId: withdrawal.id, relationship: 'withdrawal' }]);
      return toWithdrawalSnapshot(withdrawal);
    });
  }

  private async readData(repository: DomainRepository, userId: string) {
    const user = await repository.findById('user', userId);
    if (!user) throw new DomainError('NOT_FOUND', 'Akun Dokter tidak ditemukan.');
    const [earningRecords, ledgerRecords, destinationRecords, withdrawalRecords, assignedConsultations] = await Promise.all([
      repository.listByOwner('earningTransaction', userId),
      repository.listByOwner('ledgerEntry', userId),
      repository.listByOwner('payoutDestination', userId),
      repository.listByOwner('withdrawal', userId),
      repository.listByRelated('consultation', userId, 'veterinarian'),
    ]);
    const consultations = new Map(assignedConsultations
      .filter((item) => item.kind === 'consultation' && item.payload.vetId === userId)
      .map((item) => [item.id, item] as const));
    const earnings: EarningSnapshot[] = [];
    for (const item of earningRecords) {
      if (!belongsToVet(item, userId)) continue;
      const linked = await repository.listRelated('earningTransaction', item.id, 'consultation');
      const consultationId = stringValue(item.payload.consultationId);
      const consultation = consultationId ? consultations.get(consultationId) : undefined;
      if (linked.length !== 1 || linked[0].id !== consultationId || !consultation) {
        throw new DomainError('INVALID_STATE', 'Relasi layanan pendapatan tidak cocok dengan Dokter.');
      }
      earnings.push(toEarningSnapshot(item, consultation));
    }
    earnings.sort((left, right) => right.earnedAt.localeCompare(left.earnedAt) || left.id.localeCompare(right.id));
    const ledger = movementsForVet(ledgerRecords, userId);
    const withdrawals = withdrawalRecords
      .filter((item) => belongsToVet(item, userId))
      .map(toWithdrawalSnapshot)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt) || left.id.localeCompare(right.id));
    const destinations = destinationRecords
      .filter((item) => item.kind === 'payoutDestination' && item.ownerId === userId && item.payload.vetId === userId)
      .map(toDestinationSnapshot);
    return { earnings, balances: calculateWalletBalances(ledger), withdrawals, destinations };
  }
}

function assertVet(role: AccountRole): void {
  if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Pendapatan hanya dapat diakses oleh Dokter.');
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Jumlah harus berupa rupiah integer lebih dari nol.');
  }
}

function assertPeriod(period: string): void {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new DomainError('VALIDATION_FAILED', 'Periode pendapatan tidak valid.');
  }
}

function periodForDate(date: Date): EarningsPeriod {
  if (!Number.isFinite(date.getTime())) throw new DomainError('INVALID_STATE', 'Tanggal transaksi tidak valid.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new DomainError('INVALID_STATE', 'Periode transaksi tidak dapat dibaca.');
  return `${year}-${month}`;
}

function labelPeriod(value: EarningsPeriod): string {
  assertPeriod(value);
  const [year, month] = value.split('-');
  return `${monthNames[Number(month) - 1]} ${year}`;
}

function buildPeriods(earnings: readonly EarningSnapshot[], withdrawals: readonly WithdrawalSnapshot[], current: string) {
  const values = new Set<string>([current]);
  for (const item of earnings) values.add(periodForDate(new Date(item.earnedAt)));
  for (const item of withdrawals) values.add(periodForDate(new Date(item.submittedAt)));
  return [...values].sort((left, right) => right.localeCompare(left)).map((value) => ({ value, label: labelPeriod(value) }));
}

function sumEarnings(entries: readonly EarningSnapshot[]): EarningsTotals {
  const totals = entries.reduce((sum, item) => ({
    gross: sum.gross + item.gross,
    commission: sum.commission + item.commission,
    net: sum.net + item.net,
  }), { gross: 0, commission: 0, net: 0 });
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value)) || totals.gross - totals.commission !== totals.net) {
    throw new DomainError('INVALID_STATE', 'Ringkasan pendapatan tidak konsisten.');
  }
  return totals;
}

function movementsForVet(records: readonly DomainEntity[], vetId: string): LedgerMovement[] {
  return records.flatMap((item) => {
    if (item.kind !== 'ledgerEntry' || item.ownerId !== vetId || item.payload.vetId !== vetId) return [];
    const kind = item.payload.kind;
    const amount = item.payload.amount;
    if (typeof kind !== 'string' || !ledgerKinds.has(kind as LedgerEntryKind)) {
      throw new DomainError('INVALID_STATE', 'Jenis pergerakan ledger tidak dikenali.');
    }
    if (typeof amount !== 'number') throw new DomainError('VALIDATION_FAILED', 'Nilai ledger harus berupa integer rupiah.');
    return [{ kind: kind as LedgerEntryKind, amount }];
  });
}

function belongsToVet(item: DomainEntity, vetId: string): boolean {
  return item.ownerId === vetId && item.payload.vetId === vetId;
}

function toEarningSnapshot(item: DomainEntity, consultation: DomainEntity): EarningSnapshot {
  const gross = integerAmount(item.payload.gross, 'Pendapatan kotor');
  const commission = integerAmount(item.payload.commission, 'Komisi');
  const net = integerAmount(item.payload.net, 'Pendapatan bersih');
  if (commission > gross || gross - commission !== net) {
    throw new DomainError('INVALID_STATE', 'Pendapatan bersih harus sama dengan kotor dikurangi komisi.');
  }
  const status = item.payload.status;
  if (status !== 'pending' && status !== 'available') throw new DomainError('INVALID_STATE', 'Status pendapatan tidak dikenali.');
  const earnedAt = stringValue(item.payload.earnedAt) ?? item.createdAt;
  if (!Number.isFinite(Date.parse(earnedAt))) throw new DomainError('INVALID_STATE', 'Tanggal pendapatan tidak valid.');
  return {
    id: item.id,
    consultationId: consultation.id,
    displayCode: stringValue(consultation.payload.displayCode) ?? consultation.id,
    serviceLabel: consultation.payload.type === 'visit' ? 'Kunjungan' : 'Konsultasi chat',
    gross,
    commission,
    net,
    status,
    earnedAt,
  };
}

function toWithdrawalSnapshot(item: DomainEntity): WithdrawalSnapshot {
  const amount = integerAmount(item.payload.amount, 'Jumlah pencairan');
  const fee = integerAmount(item.payload.feeSnapshot, 'Biaya pencairan');
  const netAmount = integerAmount(item.payload.netAmount, 'Dana diterima');
  const status = item.payload.status;
  const submittedAt = stringValue(item.payload.submittedAt) ?? item.createdAt;
  if (commissionAfterFee(amount, fee) !== netAmount) throw new DomainError('INVALID_STATE', 'Rincian pencairan tidak konsisten.');
  if (typeof status !== 'string' || !withdrawalStatuses.has(status as WithdrawalStatus)) {
    throw new DomainError('INVALID_STATE', 'Status pencairan tidak dikenali.');
  }
  if (!Number.isFinite(Date.parse(submittedAt))) throw new DomainError('INVALID_STATE', 'Tanggal pengajuan tidak valid.');
  return { id: item.id, amount, fee, netAmount, status: status as WithdrawalStatus, submittedAt, destination: destinationFromWithdrawal(item) };
}

function toDestinationSnapshot(item: DomainEntity): PayoutDestinationSnapshot {
  const bankLabel = stringValue(item.payload.bankLabel);
  const accountMasked = stringValue(item.payload.accountMasked);
  const accountHolder = stringValue(item.payload.accountHolder);
  if (!bankLabel || !accountMasked || !accountHolder) {
    throw new DomainError('INVALID_STATE', 'Data tujuan pencairan belum lengkap.');
  }
  return { id: item.id, bankLabel, accountMasked, accountHolder, label: `${bankLabel} ${accountMasked}` };
}

function destinationFromWithdrawal(item: DomainEntity): PayoutDestinationSnapshot {
  const value = item.payload.destinationSnapshot;
  if (typeof value === 'object' && value !== null) {
    const snapshot = value as Record<string, unknown>;
    const bankLabel = stringValue(snapshot.bankLabel) ?? 'Bank tersimpan';
    const accountMasked = stringValue(snapshot.accountMasked) ?? '';
    const accountHolder = stringValue(snapshot.accountHolder) ?? '';
    return {
      id: stringValue(snapshot.destinationId) ?? item.contextId ?? '',
      bankLabel,
      accountMasked,
      accountHolder,
      label: `${bankLabel}${accountMasked ? ` ${accountMasked}` : ''}`,
    };
  }
  const label = stringValue(value) ?? 'Tujuan tersimpan';
  const separator = label.indexOf(' ••••');
  return {
    id: stringValue(item.contextId) ?? '',
    bankLabel: separator >= 0 ? label.slice(0, separator) : label,
    accountMasked: separator >= 0 ? label.slice(separator + 1) : '',
    accountHolder: '',
    label,
  };
}

function assertReservationExists(records: readonly DomainEntity[], vetId: string, withdrawal: DomainEntity, amount: number): void {
  const reservations = records.filter((item) => item.kind === 'ledgerEntry'
    && item.ownerId === vetId
    && item.payload.vetId === vetId
    && item.payload.withdrawalId === withdrawal.id
    && item.payload.kind === 'reserve_withdrawal');
  if (reservations.length !== 1 || reservations[0].payload.amount !== amount) {
    throw new DomainError('INVALID_STATE', 'Reservasi saldo untuk pengajuan tidak cocok.');
  }
}

function makeEntity(kind: 'withdrawal' | 'ledgerEntry', ownerId: string, contextId: string, id: string, timestamp: string, payload: Record<string, unknown>): DomainEntity {
  return { id, kind, ownerId, contextId, createdAt: timestamp, updatedAt: timestamp, version: 1, payload };
}

function integerAmount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('VALIDATION_FAILED', `${label} harus berupa rupiah integer nonnegatif.`);
  }
  return value;
}

function commissionAfterFee(amount: number, fee: number): number {
  return amount - fee;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}
