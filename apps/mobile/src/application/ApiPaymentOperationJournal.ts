import type {
  ApiPaymentOperationInput,
  ApiPaymentOperationPersistence,
  ApiPaymentOperationStore,
} from './ports/ApiPaymentOperationStore';
import { DomainError } from '../domain/errors';

type StoredOperation = ApiPaymentOperationInput & {
  attempt: number;
  operationKey: string;
};

let serialTail: Promise<void> = Promise.resolve();

/** Persists an idempotency key before a remote payment mutation is attempted. */
export class ApiPaymentOperationJournal implements ApiPaymentOperationStore {
  constructor(private readonly persistence: ApiPaymentOperationPersistence) {}

  getOrCreate(input: ApiPaymentOperationInput, attemptNumber: number): Promise<string> {
    return serialize(async () => {
      if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
        throw new DomainError('VALIDATION_FAILED', 'Nomor Attempt pembayaran server tidak valid.');
      }
      const current = await this.read(input);
      if (current?.attempt === attemptNumber) {
        await this.write(input, current);
        return current.operationKey;
      }
      const operationKey = `pay:${input.payableType}:${input.payableId}:${input.method}:${attemptNumber}`;
      if (operationKey.length < 8 || operationKey.length > 128) {
        throw new DomainError('VALIDATION_FAILED', 'Kunci operasi pembayaran melampaui batas API.');
      }
      await this.write(input, { ...input, attempt: attemptNumber, operationKey });
      return operationKey;
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
      return {
        payableType: input.payableType,
        payableId: input.payableId,
        method: input.method,
        attempt: Number(value.attempt),
        operationKey: String(value.operationKey),
      };
    } catch {
      throw new DomainError('SESSION_STORAGE_FAILED', 'Kunci retry pembayaran tidak dapat dibaca dengan aman.');
    }
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
    && operation.operationKey === `pay:${input.payableType}:${input.payableId}:${input.method}:${Number(operation.attempt)}`;
}

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = serialTail.then(work);
  serialTail = result.then(() => undefined, () => undefined);
  return result;
}
