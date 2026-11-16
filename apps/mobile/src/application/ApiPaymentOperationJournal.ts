import type {
  ApiPaymentOperationInput,
  ApiPaymentOperationPersistence,
  ApiPaymentOperationStore,
} from './ports/ApiPaymentOperationStore';
import type { PaymentMethod, PayableType } from './PaymentService';
import { DomainError } from '../domain/errors';

type StoredOperation = ApiPaymentOperationInput & {
  attempt: number;
  operationKey: string;
  outcome: 'pending' | 'succeeded' | 'failed';
};

let serialTail: Promise<void> = Promise.resolve();

/** Persists an idempotency key before a remote payment mutation is attempted. */
export class ApiPaymentOperationJournal implements ApiPaymentOperationStore {
  constructor(private readonly persistence: ApiPaymentOperationPersistence) {}

  getOrCreate(input: ApiPaymentOperationInput): Promise<string> {
    return serialize(async () => {
      const current = await this.read(input);
      if (current && current.outcome === 'pending') return current.operationKey;
      const attempt = (current?.attempt ?? 0) + 1;
      const operationKey = `pay:${input.payableType}:${input.payableId}:${input.method}:${attempt}`;
      if (operationKey.length < 8 || operationKey.length > 128) {
        throw new DomainError('VALIDATION_FAILED', 'Kunci operasi pembayaran melampaui batas API.');
      }
      await this.write(input, { ...input, attempt, operationKey, outcome: 'pending' });
      return operationKey;
    });
  }

  recordOutcome(operationKey: string, outcome: 'pending' | 'succeeded' | 'failed'): Promise<void> {
    return serialize(async () => {
      const current = await this.readByOperationKey(operationKey);
      if (!current) return;
      await this.write(current, { ...current, outcome });
    });
  }

  private async read(input: ApiPaymentOperationInput): Promise<StoredOperation | null> {
    try {
      const raw = await this.persistence.getItem(storageKey(input));
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isStoredOperation(value, input)) {
        await this.persistence.deleteItem(storageKey(input));
        return null;
      }
      return value;
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pembayaran tidak dapat dibaca dengan aman.');
    }
  }

  private async readByOperationKey(operationKey: string): Promise<StoredOperation | null> {
    const match = /^pay:(consultation|order):([^:]+):(bank_transfer|e_wallet):\d+$/.exec(operationKey);
    if (!match) throw new DomainError('VALIDATION_FAILED', 'Kunci retry pembayaran tidak valid.');
    const payableType: PayableType = match[1] === 'consultation' ? 'consultation' : 'order';
    const method: PaymentMethod = match[3] === 'bank_transfer' ? 'bank_transfer' : 'e_wallet';
    return this.read({ payableType, payableId: match[2], method });
  }

  private async write(input: ApiPaymentOperationInput, operation: StoredOperation): Promise<void> {
    try {
      await this.persistence.setItem(storageKey(input), JSON.stringify(operation));
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pembayaran tidak dapat disimpan dengan aman.');
    }
  }
}

function storageKey(input: ApiPaymentOperationInput): string {
  return `vetlink.api.payment-operation.v1:${input.payableType}:${input.payableId}:${input.method}`;
}

function isStoredOperation(value: unknown, input: ApiPaymentOperationInput): value is StoredOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const operation = value as Record<string, unknown>;
  return operation.payableType === input.payableType
    && operation.payableId === input.payableId
    && operation.method === input.method
    && Number.isSafeInteger(operation.attempt)
    && Number(operation.attempt) > 0
    && typeof operation.operationKey === 'string'
    && ['pending', 'succeeded', 'failed'].includes(String(operation.outcome));
}

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = serialTail.then(work);
  serialTail = result.then(() => undefined, () => undefined);
  return result;
}
