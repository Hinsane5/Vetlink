import type { DirectoryServiceType } from './directory';
import { DomainError } from './errors';
export type WorkingRule = { weekday: number; start: string; end: string };
export type BlockInput = { id: string; version: number; start: string; end: string; reason: string };
export type AvailabilityInput = {
  accepting: boolean; timezone: string; services: DirectoryServiceType[]; rules: WorkingRule[];
  chatDuration: string; visitDuration: string; chatFee: string; visitFee: string; blocks: BlockInput[];
};
export type CalendarEntry = { id: string; kind: 'consultation' | 'followUp' | 'blockedTime'; title: string; description: string; status: string; startsAt: string; endsAt: string; consultationId?: string; animalId?: string };
export const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export function validateAvailability(input: AvailabilityInput, supported: readonly DirectoryServiceType[]) {
  timezoneValid(input.timezone);
  if (typeof input.accepting !== 'boolean' || new Set(input.services).size !== input.services.length || input.services.some((value) => !supported.includes(value))) fail('Pilih layanan yang tercantum pada profil dokter.');
  if (input.accepting && (!input.services.length || !input.rules.length)) fail('Pilih layanan dan jam kerja sebelum menerima permintaan.');
  const rules = input.rules.map((rule) => {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6 || !validTime(rule.start) || !validTime(rule.end) || rule.start >= rule.end) fail('Jam mulai harus sebelum jam selesai, dengan format HH:mm.');
    return { ...rule };
  }).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  if (rules.some((rule, index) => index > 0 && rules[index - 1].weekday === rule.weekday && rules[index - 1].end > rule.start)) fail('Jam kerja pada hari yang sama tidak boleh bertumpuk.');
  const chatDuration = integer(input.chatDuration, 5, 240, 'Durasi chat');
  const visitDuration = integer(input.visitDuration, 5, 240, 'Durasi kunjungan');
  const chatFee = integer(input.chatFee, 0, Number.MAX_SAFE_INTEGER, 'Tarif chat');
  const visitFee = integer(input.visitFee, 0, Number.MAX_SAFE_INTEGER, 'Tarif kunjungan');
  const seen = new Set<string>();
  const blocks = input.blocks.map((block) => {
    if (block.id && seen.has(block.id)) fail('Blok waktu yang sama tidak boleh berulang.');
    if (block.id) seen.add(block.id);
    const startsAt = localTimestamp(block.start, input.timezone);
    const endsAt = localTimestamp(block.end, input.timezone);
    const reason = block.reason.trim();
    if (startsAt >= endsAt || reason.length < 3 || reason.length > 1000) fail('Blok waktu memerlukan waktu mulai sebelum selesai dan alasan 3–1.000 karakter.');
    return { ...block, startsAt, endsAt, reason };
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (blocks.some((block, index) => index > 0 && blocks[index - 1].endsAt > block.startsAt)) fail('Blok waktu tidak boleh bertumpuk.');
  return { acceptingNewRequests: input.accepting, timezone: input.timezone, services: [...input.services].sort(), weekdayRules: rules, chatDurationMinutes: chatDuration, visitDurationMinutes: visitDuration, chatFee, visitFee, blocks };
}
function integer(raw: string, min: number, max: number, label: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(`${label} harus integer ${min === 5 ? '5–240 menit' : 'rupiah nonnegatif'}.`);
  return Number(value);
}
function fail(message: string): never { throw new DomainError('VALIDATION_FAILED', message); }
export function timezoneValid(timezone: string) { try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(0)); } catch { fail('Zona waktu tidak valid.'); } }
export function validTime(value: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function shiftDate(value: string, days: number) { if (!validDate(value)) fail('Tanggal harus valid, dengan format YYYY-MM-DD.'); const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function localDisplay(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
export function localTimestamp(value: string, timezone: string): string {
  timezoneValid(timezone);
  const [date, time] = value.trim().split(' ');
  if (!validDate(date ?? '') || !validTime(time ?? '') || value.trim() !== `${date} ${time}`) fail('Waktu harus berformat YYYY-MM-DD HH:mm, misalnya 2026-10-07 09:00.');
  const target = Date.parse(`${date}T${time}:00Z`);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localDisplay(new Date(instant).toISOString(), timezone);
    if (observed === `${date} ${time}`) return new Date(instant).toISOString();
    instant += target - Date.parse(`${observed.replace(' ', 'T')}:00Z`);
  }
  fail('Waktu tidak tersedia pada zona waktu tersebut.');
}
export function overlaps(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) { return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt); }
export function calendarDays(date: string, mode: 'day' | 'week'): string[] {
  if (!validDate(date)) fail('Tanggal kalender tidak valid.');
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const first = mode === 'day' ? date : shiftDate(date, -((weekday + 6) % 7));
  return Array.from({ length: mode === 'day' ? 1 : 7 }, (_, index) => shiftDate(first, index));
}
export function entriesOnDate(entries: readonly CalendarEntry[], date: string, timezone: string): CalendarEntry[] {
  const range = { startsAt: localTimestamp(`${date} 00:00`, timezone), endsAt: localTimestamp(`${shiftDate(date, 1)} 00:00`, timezone) };
  return entries.filter((entry) => overlaps(entry, range)).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}
