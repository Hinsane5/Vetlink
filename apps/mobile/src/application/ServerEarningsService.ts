import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type {
  ApiEarningTransaction, ApiEarnings, ApiEarningsRepository, ApiWithdrawal, ApiWithdrawalAction,
} from './ports/ApiEarningsRepository';

export interface PendingServerWithdrawal {
  idempotencyKey: string;
  amount: number;
  destinationId: string;
}

export interface PendingServerWithdrawalStore {
  read(userId: string): Promise<PendingServerWithdrawal | null>;
  write(userId: string, operation: PendingServerWithdrawal): Promise<void>;
  clear(userId: string): Promise<void>;
}

export interface ServerEarningsSnapshot extends ApiEarnings {
  pendingWithdrawal: PendingServerWithdrawal | null;
}

/** Uses only the server ledger; a pending operation is persisted before its POST. */
export class ServerEarningsService {
  constructor(
    private readonly repository: ApiEarningsRepository,
    private readonly pending: PendingServerWithdrawalStore,
    private readonly createId: () => string,
  ) {}

  async load(role: AccountRole, userId: string, period?: string): Promise<ServerEarningsSnapshot> {
    assertVet(role, userId);
    const [snapshot, pendingWithdrawal] = await Promise.all([
      this.repository.getEarnings(period ? { period } : {}),
      this.pending.read(userId),
    ]);
    return { ...snapshot, pendingWithdrawal };
  }

  async getTransaction(role: AccountRole, userId: string, id: string): Promise<ApiEarningTransaction> {
    assertVet(role, userId);
    return this.repository.getTransaction(id);
  }

  async getWithdrawal(role: AccountRole, userId: string, id: string): Promise<ApiWithdrawal> {
    assertVet(role, userId);
    return this.repository.getWithdrawal(id);
  }

  async readPending(role: AccountRole, userId: string): Promise<PendingServerWithdrawal | null> {
    assertVet(role, userId);
    return this.pending.read(userId);
  }

  async submitWithdrawal(role: AccountRole, userId: string, amount: number, destinationId: string): Promise<ApiWithdrawalAction> {
    assertVet(role, userId);
    assertAmount(amount);
    if (!isUuid(destinationId)) throw new DomainError('VALIDATION_FAILED', 'Pilih tujuan pencairan yang tersedia.');

    const current = await this.pending.read(userId);
    let operation = current;
    if (operation) {
      if (operation.amount !== amount || operation.destinationId !== destinationId) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'Selesaikan pencairan tertunda dengan jumlah dan tujuan yang sama sebelum membuat pengajuan baru.');
      }
    } else {
      const snapshot = await this.repository.getEarnings();
      if (!snapshot.destinations.some((item) => item.id === destinationId)) {
        throw new DomainError('NOT_FOUND', 'Tujuan pencairan tidak tersedia untuk akun ini.');
      }
      if (snapshot.balances.available <= 0) throw new DomainError('INVALID_STATE', 'Saldo tersedia belum dapat dicairkan.');
      if (amount > snapshot.balances.available) throw new DomainError('VALIDATION_FAILED', 'Jumlah melebihi saldo tersedia.');
      operation = { idempotencyKey: this.newOperationKey(), amount, destinationId };
      await this.pending.write(userId, operation);
    }
    return this.submitExact(userId, operation);
  }

  async retryPending(role: AccountRole, userId: string): Promise<ApiWithdrawalAction> {
    assertVet(role, userId);
    const operation = await this.pending.read(userId);
    if (!operation) throw new DomainError('NOT_FOUND', 'Tidak ada pengajuan pencairan yang perlu dipulihkan.');
    return this.submitExact(userId, operation);
  }

  private newOperationKey(): string {
    const key = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(key)) {
      throw new DomainError('VALIDATION_FAILED', 'Generator identitas operasi menghasilkan nilai tidak valid.');
    }
    return key;
  }

  private async submitExact(userId: string, operation: PendingServerWithdrawal): Promise<ApiWithdrawalAction> {
    try {
      const result = await this.repository.createWithdrawal({
        idempotencyKey: operation.idempotencyKey,
        payload: { amount: operation.amount, destinationId: operation.destinationId },
      });
      assertWithdrawalResult(result, operation);
      await this.pending.clear(userId);
      return result;
    } catch (cause) {
      if (cause instanceof DomainError && isDefinitiveRejection(cause.code)) await this.pending.clear(userId);
      throw cause;
    }
  }
}

function assertVet(role: AccountRole, userId: string): void {
  if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Pendapatan dan pencairan hanya tersedia untuk Dokter.');
  if (!userId) throw new DomainError('SESSION_INVALID', 'Sesi Dokter tidak tersedia. Masuk kembali untuk melanjutkan.');
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('VALIDATION_FAILED', 'Jumlah harus berupa rupiah integer lebih dari nol.');
}

function assertWithdrawalResult(result: ApiWithdrawalAction, operation: PendingServerWithdrawal): void {
  if (!result || !result.withdrawal || !result.withdrawal.destination
    || !isUuid(result.operationId) || result.operationId !== result.withdrawal.id
    || result.withdrawal.amount !== operation.amount || result.withdrawal.destination.id !== operation.destinationId
    || result.withdrawal.fee + result.withdrawal.netAmount !== operation.amount
    || result.adapterOutcome !== result.withdrawal.adapterOutcome) {
    throw new DomainError('API_RESPONSE_INVALID', 'Hasil pencairan server tidak cocok dengan pengajuan.');
  }
}

function isDefinitiveRejection(code: DomainError['code']): boolean {
  return code === 'FORBIDDEN' || code === 'INVALID_STATE' || code === 'VALIDATION_FAILED'
    || code === 'VERSION_CONFLICT' || code === 'NOT_FOUND' || code === 'SESSION_INVALID'
    || code === 'ADAPTER_FAILED';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
