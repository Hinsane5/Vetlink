export type DomainErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_STATE'
  | 'VALIDATION_FAILED'
  | 'IMMUTABLE_RECORD'
  | 'VERSION_CONFLICT'
  | 'NOT_FOUND'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'ROLE_NOT_ALLOWED'
  | 'SESSION_INVALID'
  | 'SESSION_STORAGE_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_FIXTURE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
