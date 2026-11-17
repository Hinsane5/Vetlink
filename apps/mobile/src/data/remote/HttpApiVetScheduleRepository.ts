import type {
  ApiVetAvailability, ApiVetAvailabilityInput, ApiVetAvailabilityResult, ApiVetBlockedTime,
  ApiVetBlockedTimeInput, ApiVetBlockedTimeCreateResult, ApiVetBlockedTimeCancelResult,
  ApiVetSchedule, ApiVetScheduleRepository, ApiWeekdayRule,
} from '../../application/ports/ApiVetScheduleRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const SERVICES = ['chat', 'visit'] as const;

/** BE-04 schedule boundary. The server remains the booking and availability authority. */
export class HttpApiVetScheduleRepository implements ApiVetScheduleRepository {
  constructor(private readonly api: ApiClient) {}

  async getAvailability(): Promise<ApiVetAvailability | null> {
    const value = await this.api.request<unknown>('/v1/me/vet/availability');
    return value === null ? null : parseAvailability(value);
  }

  async updateAvailability(input: ApiVetAvailabilityInput): Promise<ApiVetAvailabilityResult> {
    const body = availabilityPayload(input);
    const value = await this.api.request<unknown>('/v1/me/vet/availability', { method: 'PUT', body });
    if (!isRecord(value) || !isUuid(value.operationId) || value.status !== 'succeeded'
      || !isIsoTimestampWithTimezone(value.occurredAt)) throw invalidResponse('Hasil update availability tidak sesuai kontrak BE-04.');
    return { operationId: value.operationId, status: 'succeeded', occurredAt: value.occurredAt,
      value: parseAvailability(value.value) };
  }

  async getBlockedTimes(): Promise<ApiVetBlockedTime[]> {
    const value = await this.api.request<unknown>('/v1/me/vet/blocked-times');
    if (!Array.isArray(value)) throw invalidResponse('Daftar blokir Dokter harus array.');
    return value.map(parseBlockedTime);
  }

  async createBlockedTime(input: ApiVetBlockedTimeInput): Promise<ApiVetBlockedTimeCreateResult> {
    const body = blockedPayload(input);
    const value = await this.api.request<unknown>('/v1/me/vet/blocked-times', { method: 'POST', body });
    if (!isRecord(value) || !isUuid(value.operationId) || value.status !== 'succeeded'
      || !isIsoTimestampWithTimezone(value.occurredAt)) throw invalidResponse('Hasil pembuatan blokir tidak sesuai kontrak.');
    return { operationId: value.operationId, status: 'succeeded', occurredAt: value.occurredAt,
      value: parseBlockedTime(value.value) };
  }

  async updateBlockedTime(id: string, input: ApiVetBlockedTimeInput & { expectedVersion: number }): Promise<ApiVetBlockedTime> {
    const blockId = blockResourceId(id);
    if (!isRecord(input) || !positiveVersion(input.expectedVersion)) throw invalidQuery('Versi blokir Dokter tidak valid.');
    const body = { ...blockedPayload(input), expectedVersion: input.expectedVersion };
    return parseBlockedTime(await this.api.request<unknown>(`/v1/me/vet/blocked-times/${blockId}`, { method: 'PUT', body }));
  }

  async cancelBlockedTime(id: string, expectedVersion: number): Promise<ApiVetBlockedTimeCancelResult> {
    const blockId = blockResourceId(id);
    if (!positiveVersion(expectedVersion)) throw invalidQuery('Versi blokir Dokter tidak valid.');
    const params = new URLSearchParams({ expectedVersion: String(expectedVersion) });
    const value = await this.api.request<unknown>(`/v1/me/vet/blocked-times/${blockId}?${params}`, { method: 'DELETE' });
    if (!isRecord(value) || value.id !== id || value.status !== 'cancelled' || !positiveVersion(value.version)) {
      throw invalidResponse('Hasil pembatalan blokir tidak sesuai kontrak.');
    }
    return { id: value.id, status: 'cancelled', version: value.version };
  }

  async getSchedule(from: string, to: string): Promise<ApiVetSchedule> {
    if (!isIsoTimestampWithTimezone(from) || !isIsoTimestampWithTimezone(to)
      || Date.parse(from) >= Date.parse(to) || Date.parse(to) - Date.parse(from) > 32 * 86_400_000) {
      throw invalidQuery('Rentang kalender harus ISO berzona dan maksimal 32 hari.');
    }
    const params = new URLSearchParams({ from, to });
    return parseSchedule(await this.api.request<unknown>(`/v1/me/vet/schedule?${params}`));
  }
}

function positiveVersion(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1; }
function safeIdr(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }

function parseRule(value: unknown): ApiWeekdayRule {
  if (!isRecord(value) || !Number.isInteger(value.weekday) || Number(value.weekday) < 0 || Number(value.weekday) > 6
    || typeof value.start !== 'string' || typeof value.end !== 'string'
    || !CLOCK.test(value.start) || !CLOCK.test(value.end) || value.start >= value.end) {
    throw invalidResponse('Aturan mingguan Dokter tidak valid.');
  }
  return { weekday: value.weekday as number, start: value.start, end: value.end };
}

function parseRates(value: unknown): ApiVetAvailability['rates'] {
  if (!isRecord(value) || Object.keys(value).some((key) => !SERVICES.includes(key as 'chat' | 'visit'))
    || Object.values(value).some((fee) => !safeIdr(fee))) throw invalidResponse('Tarif Dokter harus integer rupiah.');
  return value as ApiVetAvailability['rates'];
}

function parseAvailability(value: unknown): ApiVetAvailability {
  if (!isRecord(value) || !isUuid(value.vet_id) || typeof value.accepting_new_requests !== 'boolean'
    || !Array.isArray(value.services) || !value.services.every((service) => oneOf(service, SERVICES))
    || !isNonEmptyText(value.timezone, 80) || !Array.isArray(value.weekday_rules)
    || !positiveDuration(value.chat_duration_minutes) || !positiveDuration(value.visit_duration_minutes)
    || !isIsoTimestampWithTimezone(value.updated_at) || !positiveVersion(value.version)
    || !Number.isInteger(value.experienceYears) || Number(value.experienceYears) < 0 || Number(value.experienceYears) > 80
    || !strings(value.specialties) || !strings(value.species) || typeof value.practiceLocation !== 'string'
    || !strings(value.serviceAreas)) throw invalidResponse('Availability Dokter tidak sesuai row BE-04.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); }
  catch { throw invalidResponse('Timezone availability Dokter tidak valid.'); }
  const weekdayRules = value.weekday_rules.map(parseRule);
  if (new Set(value.services).size !== value.services.length
    || new Set(weekdayRules.map((rule) => rule.weekday)).size !== weekdayRules.length) {
    throw invalidResponse('Layanan atau aturan weekday Dokter duplikat.');
  }
  const rates = parseRates(value.rates);
  return {
    vetId: value.vet_id, acceptingNewRequests: value.accepting_new_requests,
    services: value.services as ApiVetAvailability['services'], timezone: value.timezone,
    weekdayRules, chatDurationMinutes: value.chat_duration_minutes,
    visitDurationMinutes: value.visit_duration_minutes, updatedAt: value.updated_at,
    version: value.version, experienceYears: value.experienceYears as number,
    specialties: value.specialties, species: value.species, practiceLocation: value.practiceLocation,
    serviceAreas: value.serviceAreas, rates,
  };
}

function positiveDuration(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 5 && Number(value) <= 240;
}

function blockResourceId(value: string): string {
  if (!isUuid(value)) throw invalidQuery('ID blokir Dokter harus UUID.');
  return encodeURIComponent(value);
}

function blockedPayload(input: ApiVetBlockedTimeInput): ApiVetBlockedTimeInput {
  if (!isRecord(input) || !isIsoTimestampWithTimezone(input.startsAt)
    || !isIsoTimestampWithTimezone(input.endsAt)
    || Date.parse(input.startsAt) >= Date.parse(input.endsAt)
    || !isNonEmptyText(input.reason, 500)) throw invalidQuery('Waktu atau alasan blokir Dokter tidak valid.');
  return { startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason };
}

function availabilityPayload(input: ApiVetAvailabilityInput): Record<string, unknown> {
  if (!isRecord(input) || !positiveVersion(input.expectedVersion)
    || typeof input.acceptingNewRequests !== 'boolean'
    || !Array.isArray(input.services) || !input.services.every((service) => oneOf(service, SERVICES))
    || new Set(input.services).size !== input.services.length
    || !isNonEmptyText(input.timezone, 80) || !Array.isArray(input.weekdayRules)
    || !positiveDuration(input.chatDurationMinutes) || !positiveDuration(input.visitDurationMinutes)
    || !isRecord(input.rates)) throw invalidQuery('Input availability Dokter tidak valid.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); }
  catch { throw invalidQuery('Timezone Dokter harus IANA.'); }
  const weekdayRules = input.weekdayRules.map((rule) => {
    try { return parseRule(rule); } catch { throw invalidQuery('Aturan weekday Dokter tidak valid.'); }
  });
  if (new Set(weekdayRules.map((rule) => rule.weekday)).size !== weekdayRules.length) throw invalidQuery('Hari aturan tidak boleh duplikat.');
  const rates: Record<string, number> = {};
  for (const service of SERVICES) {
    const fee = input.rates[service];
    if (fee !== undefined) {
      if (!safeIdr(fee)) throw invalidQuery('Tarif harus integer rupiah aman.');
      rates[service] = fee;
    }
  }
  if (input.services.some((service) => rates[service] === undefined)) throw invalidQuery('Setiap layanan memerlukan tarif rupiah.');
  if (input.experienceYears !== undefined && (!Number.isInteger(input.experienceYears) || input.experienceYears < 0 || input.experienceYears > 80)) throw invalidQuery('Pengalaman Dokter tidak valid.');
  for (const value of [input.specialties, input.species, input.serviceAreas]) {
    if (value !== undefined && !strings(value)) throw invalidQuery('Daftar profil Dokter tidak valid.');
  }
  if (input.practiceLocation !== undefined && (typeof input.practiceLocation !== 'string' || input.practiceLocation.length > 160)) throw invalidQuery('Lokasi praktik tidak valid.');
  const body: Record<string, unknown> = {
    expectedVersion: input.expectedVersion, acceptingNewRequests: input.acceptingNewRequests,
    services: [...input.services], timezone: input.timezone, weekdayRules,
    chatDurationMinutes: input.chatDurationMinutes, visitDurationMinutes: input.visitDurationMinutes, rates,
  };
  if (input.experienceYears !== undefined) body.experienceYears = input.experienceYears;
  if (input.specialties !== undefined) body.specialties = [...input.specialties];
  if (input.species !== undefined) body.species = [...input.species];
  if (input.practiceLocation !== undefined) body.practiceLocation = input.practiceLocation;
  if (input.serviceAreas !== undefined) body.serviceAreas = [...input.serviceAreas];
  return body;
}

function parseBlockedTime(value: unknown): ApiVetBlockedTime {
  if (!isRecord(value) || !isUuid(value.id) || !isIsoTimestampWithTimezone(value.startsAt)
    || !isIsoTimestampWithTimezone(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt)
    || !isNonEmptyText(value.reason, 500) || !oneOf(value.status, ['active', 'cancelled'])
    || !positiveVersion(value.version)) throw invalidResponse('Blokir Dokter tidak sesuai kontrak.');
  return { id: value.id, startsAt: value.startsAt, endsAt: value.endsAt, reason: value.reason,
    status: value.status, version: value.version };
}

function parseSchedule(value: unknown): ApiVetSchedule {
  if (!isRecord(value) || !Array.isArray(value.appointments)
    || !Array.isArray(value.followUps) || !Array.isArray(value.blockedTimes)) {
    throw invalidResponse('Kalender Dokter tidak sesuai kontrak BE-04.');
  }
  const appointments = value.appointments.map((item: unknown) => {
    if (!isRecord(item) || !isUuid(item.id) || !isNonEmptyText(item.displayCode, 100)
      || !oneOf(item.service, SERVICES) || !isNonEmptyText(item.status, 50)
      || !isIsoTimestampWithTimezone(item.startsAt) || !isIsoTimestampWithTimezone(item.endsAt)
      || Date.parse(item.startsAt) >= Date.parse(item.endsAt)
      || typeof item.feeIdr !== 'string' || !/^\d+$/.test(item.feeIdr)
      || BigInt(item.feeIdr) > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidResponse('Janji kalender Dokter tidak valid.');
    return { id: item.id, displayCode: item.displayCode, service: item.service,
      status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, feeIdr: item.feeIdr };
  });
  const followUps = value.followUps.map((item: unknown) => {
    if (!isRecord(item) || !isUuid(item.id) || !isUuid(item.consultationId)
      || !isUuid(item.animalId) || !isUuid(item.farmerId)
      || !isIsoTimestampWithTimezone(item.startsAt) || !isIsoTimestampWithTimezone(item.endsAt)
      || Date.parse(item.startsAt) >= Date.parse(item.endsAt)
      || !isNonEmptyText(item.reason, 500) || item.status !== 'scheduled' || !positiveVersion(item.version)) {
      throw invalidResponse('Tindak lanjut kalender Dokter tidak valid.');
    }
    return { id: item.id, consultationId: item.consultationId, animalId: item.animalId,
      farmerId: item.farmerId, startsAt: item.startsAt, endsAt: item.endsAt,
      reason: item.reason, status: 'scheduled' as const, version: item.version };
  });
  const blockedTimes = value.blockedTimes.map((item: unknown) => {
    const block = parseBlockedTime({ ...(isRecord(item) ? item : {}), version: 1 });
    return { id: block.id, startsAt: block.startsAt, endsAt: block.endsAt,
      reason: block.reason, status: block.status };
  });
  return { appointments, followUps, blockedTimes };
}
