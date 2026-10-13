import { randomUUID } from 'node:crypto';

export type AdapterResult<Value> =
  | {
      operationId: string;
      status: 'pending';
      occurredAt: string;
      value: Value;
    }
  | {
      operationId: string;
      status: 'succeeded';
      occurredAt: string;
      value: Value;
    }
  | {
      operationId: string;
      status: 'failed';
      occurredAt: string;
      error: { code: string; message: string; retryable: boolean };
    };

export function adapterSucceeded<Value>(value: Value): AdapterResult<Value> {
  return { operationId: randomUUID(), status: 'succeeded', occurredAt: new Date().toISOString(), value };
}

export function adapterPending<Value>(value: Value): AdapterResult<Value> {
  return { operationId: randomUUID(), status: 'pending', occurredAt: new Date().toISOString(), value };
}

export function adapterFailed<Value>(code: string, message: string, retryable: boolean): AdapterResult<Value> {
  return {
    operationId: randomUUID(),
    status: 'failed',
    occurredAt: new Date().toISOString(),
    error: { code, message, retryable },
  };
}
