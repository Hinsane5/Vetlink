import type { AccountRole } from '../domain/auth';
import type { DirectoryServiceType } from '../domain/directory';
import { DomainError } from '../domain/errors';
import type { ApiVetAvailability, ApiVetAvailabilityInput, ApiVetBlockedTime, ApiVetBlockedTimeInput, ApiVetSchedule, ApiVetScheduleRepository } from './ports/ApiVetScheduleRepository';
import type { ApiVetSlot } from './ports/VetDirectoryReadRepository';
import type { ServerVetDirectoryService } from './ServerVetDirectoryService';

/** Lists the assigned veterinarian's server-available slots for schedule proposals. */
export class ServerVetScheduleService {
  constructor(
    private readonly schedule: ApiVetScheduleRepository,
    private readonly directory: ServerVetDirectoryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ownAvailability(role: AccountRole, userId: string): Promise<ApiVetAvailability | null> {
    assertVet(role);
    const value = await this.schedule.getAvailability();
    if (value && value.vetId !== userId) throw forbiddenSchedule();
    return value;
  }

  async saveOwnAvailability(role: AccountRole, userId: string, input: ApiVetAvailabilityInput) {
    assertVet(role);
    const current = await this.ownAvailability(role, userId);
    if (input.expectedVersion !== (current?.version ?? 1)) throw new DomainError('VERSION_CONFLICT', 'Jadwal berubah. Muat ulang sebelum menyimpan.');
    const result = await this.schedule.updateAvailability(input);
    if (result.value.vetId !== userId) throw new DomainError('API_RESPONSE_INVALID', 'Jadwal hasil simpan tidak terkait akun Dokter ini.');
    return result;
  }

  async ownBlockedTimes(role: AccountRole, userId: string): Promise<ApiVetBlockedTime[]> {
    assertVet(role);
    const availability = await this.ownAvailability(role, userId);
    if (!availability) return [];
    return this.schedule.getBlockedTimes();
  }

  async createOwnBlockedTime(role: AccountRole, userId: string, input: ApiVetBlockedTimeInput) {
    assertVet(role);
    await this.requireOwnAvailability(role, userId);
    return this.schedule.createBlockedTime(input);
  }

  async updateOwnBlockedTime(role: AccountRole, userId: string, id: string, input: ApiVetBlockedTimeInput & { expectedVersion: number }) {
    assertVet(role);
    await this.requireOwnAvailability(role, userId);
    return this.schedule.updateBlockedTime(id, input);
  }

  async cancelOwnBlockedTime(role: AccountRole, userId: string, id: string, expectedVersion: number) {
    assertVet(role);
    await this.requireOwnAvailability(role, userId);
    return this.schedule.cancelBlockedTime(id, expectedVersion);
  }

  async ownSchedule(role: AccountRole, userId: string, from: string, to: string): Promise<ApiVetSchedule> {
    assertVet(role);
    await this.requireOwnAvailability(role, userId);
    return this.schedule.getSchedule(from, to);
  }

  async timezoneFor(role: AccountRole, userId: string, vetId: string): Promise<string> {
    if (role === 'farmer') return (await this.directory.getDetail(role, vetId)).timezone;
    if (role === 'vet' && userId === vetId) {
      const availability = await this.schedule.getAvailability();
      if (!availability || availability.vetId !== userId) throw new DomainError('FORBIDDEN', 'Zona waktu tidak terkait dengan akun Dokter ini.');
      return availability.timezone;
    }
    throw new DomainError('FORBIDDEN', 'Zona waktu jadwal tidak tersedia untuk akun ini.');
  }

  async proposalSlots(role: AccountRole, userId: string, service: DirectoryServiceType): Promise<{ timezone: string; slots: ApiVetSlot[] }> {
    if (role !== 'vet') throw new DomainError('FORBIDDEN', 'Hanya Dokter yang dapat membaca slot untuk usulan jadwal.');
    const availability = await this.schedule.getAvailability();
    if (!availability || availability.vetId !== userId) throw new DomainError('FORBIDDEN', 'Jadwal tidak terkait dengan akun Dokter ini.');
    if (!availability.acceptingNewRequests || !availability.services.includes(service))
      throw new DomainError('INVALID_STATE', 'Layanan ini tidak sedang tersedia pada jadwal Dokter.');
    const dateFrom = localDate(this.now(), availability.timezone);
    const dateTo = addDays(dateFrom, 13);
    const slots = await this.directory.getOwnProposalSlots(role, userId, service, dateFrom, dateTo);
    const seen = new Set<number>();
    for (const slot of slots) {
      const startsAt = Date.parse(slot.startsAt);
      const endsAt = Date.parse(slot.endsAt);
      if (!isTimestamp(slot.startsAt) || !isTimestamp(slot.endsAt) || startsAt >= endsAt || seen.has(startsAt))
        throw new DomainError('API_RESPONSE_INVALID', 'Daftar slot server tidak valid.');
      seen.add(startsAt);
    }
    return { timezone: availability.timezone, slots: [...slots].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)) };
  }

  private async requireOwnAvailability(role: AccountRole, userId: string): Promise<ApiVetAvailability> {
    const value = await this.ownAvailability(role, userId);
    if (!value) throw new DomainError('INVALID_STATE', 'Atur jadwal Dokter terlebih dahulu.');
    return value;
  }
}

function assertVet(role: AccountRole): asserts role is 'vet' {
  if (role !== 'vet') throw forbiddenSchedule();
}

function forbiddenSchedule(): DomainError {
  return new DomainError('FORBIDDEN', 'Jadwal hanya dapat dibuka oleh Dokter pemilik akun.');
}

function localDate(value: Date, timezone: string): string {
  const fields = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => fields.find((item) => item.type === type)?.value;
  const year = get('year'); const month = get('month'); const day = get('day');
  if (!year || !month || !day) throw new DomainError('API_RESPONSE_INVALID', 'Tanggal lokal Dokter tidak tersedia.');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}
