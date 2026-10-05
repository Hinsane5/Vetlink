import type { DomainEntity } from './entities';
import type { LivestockSpecies } from './profiles';

export type DirectoryServiceType = 'chat' | 'visit';
export type DirectoryVet = {
  id: string; name: string; photoUri: string | null; verified: boolean; accepting: boolean;
  species: LivestockSpecies[]; services: DirectoryServiceType[]; location: string;
  visitRegions: string[]; experienceYears: number;
  rates: { service: DirectoryServiceType; amount: number }[];
  reviews: { id: string; stars: number; text: string; submittedAt: string }[];
};
export type VetFilters = {
  query: string; species: LivestockSpecies | 'all'; service: DirectoryServiceType | 'all';
  location: string; availableOnly: boolean; maxFee: number | null;
};
export const emptyVetFilters: VetFilters = {
  query: '', species: 'all', service: 'all', location: '', availableOnly: false, maxFee: null,
};

export function filterVets(vets: readonly DirectoryVet[], filters: VetFilters): DirectoryVet[] {
  const query = filters.query.trim().toLocaleLowerCase('id');
  const location = filters.location.trim().toLocaleLowerCase('id');
  return vets.filter((vet) => {
    const matchingRates = vet.rates.filter((rate) => filters.service === 'all' || rate.service === filters.service);
    return (!query || vet.name.toLocaleLowerCase('id').includes(query))
      && (filters.species === 'all' || vet.species.includes(filters.species))
      && (filters.service === 'all' || vet.services.includes(filters.service))
      && (!location || [vet.location, ...vet.visitRegions].some((value) => value.toLocaleLowerCase('id').includes(location)))
      && (!filters.availableOnly || (vet.verified && vet.accepting))
      && (filters.maxFee === null || matchingRates.some((rate) => rate.amount <= filters.maxFee!));
  });
}

export type DirectorySlot = { id: string; startsAt: string; endsAt: string };
export type DirectorySchedule = { timezone: string; slots: DirectorySlot[] };

// weekday: 0 = Minggu ... 6 = Sabtu; start/end adalah HH:mm pada timezone dokter.
export function projectDirectorySlots(
  vet: DirectoryVet, service: DirectoryServiceType, availability: DomainEntity | undefined,
  commitments: readonly DomainEntity[], now: Date,
): DirectorySchedule {
  const timezone = typeof availability?.payload.timezone === 'string' ? availability.payload.timezone : 'Asia/Jakarta';
  const empty = { timezone, slots: [] };
  if (!vet.verified || !vet.accepting || !vet.services.includes(service) || !vet.rates.some((rate) => rate.service === service)) return empty;
  const payload = availability?.payload;
  if (!payload || !Array.isArray(payload.weekdayRules) || !Array.isArray(payload.services) || !payload.services.includes(service)) return empty;
  const duration = payload[service === 'chat' ? 'chatDurationMinutes' : 'visitDurationMinutes'];
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 5 || duration > 240) return empty;
  let date: string;
  try { date = zonedParts(now, timezone).date; } catch { return empty; }
  const occupied = commitments.filter((item) => {
    if (item.kind === 'blockedTime') return true;
    if (item.kind === 'followUp') return item.payload.status === 'scheduled';
    return ['awaiting_payment', 'requested', 'scheduled', 'in_progress'].includes(String(item.payload.status));
  });
  const slots = new Map<string, DirectorySlot>();
  for (let day = 0; day < 7; day += 1) {
    const calendar = new Date(`${date}T00:00:00Z`);
    calendar.setUTCDate(calendar.getUTCDate() + day);
    const localDate = calendar.toISOString().slice(0, 10);
    for (const raw of payload.weekdayRules) {
      if (!raw || typeof raw !== 'object') continue;
      const rule = raw as Record<string, unknown>;
      if (rule.weekday !== calendar.getUTCDay()) continue;
      const start = minutes(rule.start);
      const end = minutes(rule.end);
      if (start === null || end === null || start >= end) continue;
      for (let minute = start; minute + duration <= end; minute += duration) {
        const startsAt = localInstant(localDate, minute, timezone);
        const endsAt = localInstant(localDate, minute + duration, timezone);
        if (!startsAt || !endsAt || startsAt.getTime() <= now.getTime() || startsAt >= endsAt) continue;
        if (occupied.some((item) => {
          const from = Date.parse(String(item.payload.startsAt));
          const until = Date.parse(String(item.payload.endsAt));
          return from < endsAt.getTime() && until > startsAt.getTime();
        })) continue;
        const iso = startsAt.toISOString();
        slots.set(iso, { id: `${vet.id}:${service}:${iso}`, startsAt: iso, endsAt: endsAt.toISOString() });
      }
    }
  }
  return { timezone, slots: [...slots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
}

function minutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
function zonedParts(date: Date, timezone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}
function localInstant(date: string, minute: number, timezone: string): Date | null {
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let instant = new Date(target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zonedParts(instant, timezone);
    const observed = Date.parse(`${local.date}T00:00:00Z`) + (local.hour * 60 + local.minute) * 60_000;
    if (observed === target) return instant;
    instant = new Date(instant.getTime() + target - observed);
  }
  return null;
}
