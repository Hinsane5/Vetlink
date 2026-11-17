import { DomainError } from '../../domain/errors';

export const MAX_OPAQUE_CURSOR_LENGTH = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|\+00:00)$/;
const ISO_TIMESTAMP_WITH_ZONE_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReadPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function isDecimalString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const date = value.slice(0, 10);
  return isCalendarDate(date) && Number.isFinite(Date.parse(value));
}

/** ISO-8601 date-time with an explicit Z or numeric timezone offset. */
export function isIsoTimestampWithTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_WITH_ZONE_PATTERN.test(value)) return false;
  const date = value.slice(0, 10);
  return isCalendarDate(date) && Number.isFinite(Date.parse(value));
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateOpaqueCursor(cursor: string | undefined, label: string): void {
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_OPAQUE_CURSOR_LENGTH)) {
    throw invalidQuery(`Cursor ${label} tidak valid.`);
  }
}

export function validatePageLimit(limit: number | undefined, label: string): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    throw invalidQuery(`Jumlah ${label} per halaman harus berupa bilangan bulat dari 1 sampai 100.`);
  }
}

export function parseReadPage<T>(value: unknown, parseItem: (item: unknown) => T, label: string): ReadPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean'
    || !(value.nextCursor === null || typeof value.nextCursor === 'string')) {
    throw invalidResponse(`Halaman ${label} tidak sesuai kontrak.`);
  }
  if (value.hasMore) {
    if (value.items.length === 0 || typeof value.nextCursor !== 'string'
      || value.nextCursor.length === 0 || value.nextCursor.length > MAX_OPAQUE_CURSOR_LENGTH) {
      throw invalidResponse(`Cursor halaman ${label} tidak valid.`);
    }
  } else if (value.nextCursor !== null) {
    throw invalidResponse(`Cursor ${label} harus kosong pada halaman terakhir.`);
  }
  return { items: value.items.map(parseItem), nextCursor: value.nextCursor, hasMore: value.hasMore };
}

export function invalidQuery(message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', message);
}

export function invalidResponse(message: string): DomainError {
  return new DomainError('API_RESPONSE_INVALID', message);
}
