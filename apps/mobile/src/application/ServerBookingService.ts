import type { AccountRole } from '../domain/auth';
import { DomainError } from '../domain/errors';
import type { ApiConsultationActionResult, ApiConsultationQuote, ApiConsultationRepository, ConsultationQuoteInput } from './ports/ApiConsultationRepository';
import type { FarmReadRepository } from './ports/FarmReadRepository';
import type { LivestockReadRepository } from './ports/LivestockReadRepository';
import type { VetDirectoryReadRepository } from './ports/VetDirectoryReadRepository';

export interface PendingServerBooking {
  quoteId: string;
  idempotencyKey: string;
}

export interface PendingServerBookingStore {
  read(userId: string): Promise<PendingServerBooking | null>;
  write(userId: string, pending: PendingServerBooking): Promise<void>;
  clear(userId: string): Promise<void>;
}

/** BE-05 quote/booking orchestration. Price, role, slot and owner remain server-authoritative. */
export class ServerBookingService {
  constructor(
    private readonly farms: FarmReadRepository,
    private readonly livestock: LivestockReadRepository,
    private readonly vets: VetDirectoryReadRepository,
    private readonly consultations: ApiConsultationRepository,
    private readonly pending: PendingServerBookingStore,
  ) {}

  async createQuote(role: AccountRole, userId: string, farmId: string, input: ConsultationQuoteInput, idempotencyKey: string): Promise<ApiConsultationQuote> {
    this.requireFarmer(role);
    if (!input || !isUuidValue(input.vetId) || !isUuidValue(input.animalId)
      || (input.serviceType !== 'chat' && input.serviceType !== 'visit')
      || !Number.isFinite(Date.parse(input.startsAt))
      || input.startsAt.length < 20 || !input.startsAt.match(/(?:Z|[+-]\d{2}:\d{2})$/)
      || typeof input.complaint !== 'string' || input.complaint.trim().length < 1 || input.complaint.trim().length > 4000) {
      throw new DomainError('VALIDATION_FAILED', 'Data konsultasi dan waktu pilihan harus lengkap serta valid.');
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) throw new DomainError('VALIDATION_FAILED', 'Kunci quote tidak valid.');
    const farm = await this.farms.getFarmById(farmId);
    const animal = await this.livestock.getById(input.animalId);
    if (farm.id !== farmId || animal.id !== input.animalId || animal.farmerId !== userId || animal.farmId !== farm.id) {
      throw new DomainError('FORBIDDEN', 'Ternak bukan milik Peternak atau Farm yang dipilih.');
    }
    if (!Array.isArray(farm.species)) throw new DomainError('API_RESPONSE_INVALID', 'Daftar jenis Peternakan dari server tidak valid.');
    if (farm.species.length && !farm.species.includes(animal.species)) {
      throw new DomainError('INVALID_STATE', 'Jenis ternak tidak sesuai dengan jenis pada Peternakan.');
    }
    const vet = await this.vets.getById(input.vetId);
    if (vet.id !== input.vetId || !vet.acceptingNewRequests || !vet.services.includes(input.serviceType) || !vet.species.includes(animal.species)) {
      throw new DomainError('INVALID_STATE', 'Dokter tidak menerima layanan untuk jenis ternak ini.');
    }
    const slotDate = new Intl.DateTimeFormat('en-CA', { timeZone: vet.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(input.startsAt));
    const slots = await this.vets.getSlots(vet.id, { dateFrom: slotDate, dateTo: slotDate, service: input.serviceType });
    if (!slots.some((slot) => Date.parse(slot.startsAt) === Date.parse(input.startsAt))) {
      throw new DomainError('INVALID_STATE', 'Slot tidak tersedia lagi. Muat ulang jadwal Dokter.');
    }
    let addressId: string | undefined;
    if (input.serviceType === 'visit') {
      addressId = farm.visitAddressId ?? undefined;
      if (!addressId) throw new DomainError('VALIDATION_FAILED', 'Pilih alamat kunjungan untuk Farm ini sebelum meminta kunjungan.');
      const address = await this.farms.getAddressById(addressId);
      if (address.id !== addressId) throw new DomainError('API_RESPONSE_INVALID', 'Alamat kunjungan server tidak sesuai dengan Farm terpilih.');
    }
    const payload: ConsultationQuoteInput = {
      vetId: vet.id,
      animalId: animal.id,
      serviceType: input.serviceType,
      startsAt: input.startsAt,
      complaint: input.complaint.trim(),
      ...(addressId ? { addressId } : {}),
    };
    const quote = await this.consultations.createQuote({ idempotencyKey, payload });
    const expectedAddressId = payload.serviceType === 'visit' ? payload.addressId : undefined;
    if (!isUuidValue(quote.id) || quote.id !== quote.quoteId || quote.farmerId !== userId || quote.vetId !== vet.id || quote.animalId !== animal.id
      || quote.serviceType !== payload.serviceType || Date.parse(quote.startsAt) !== Date.parse(payload.startsAt)
      || quote.complaint !== payload.complaint || quote.currency !== 'IDR'
      || !isSafeIdr(quote.feeIdr) || !isSafeIdr(quote.commissionIdr) || quote.commissionIdr > quote.feeIdr
      || !isSafeIdr(quote.amountIdr) || quote.amountIdr !== quote.feeIdr || quote.consumed
      || (expectedAddressId ? quote.visitAddressSnapshot?.id !== expectedAddressId : quote.visitAddressSnapshot !== null)) {
      throw new DomainError('API_RESPONSE_INVALID', 'Quote server tidak sesuai permintaan yang dipilih.');
    }
    return quote;
  }

  async createBooking(role: AccountRole, userId: string, quote: ApiConsultationQuote): Promise<ApiConsultationActionResult> {
    this.requireFarmer(role);
    if (!isUuidValue(quote.quoteId) || quote.id !== quote.quoteId || quote.farmerId !== userId || quote.consumed) {
      throw new DomainError('FORBIDDEN', 'Quote tidak tersedia untuk akun Peternak ini.');
    }
    const pending = await this.pending.read(userId);
    const next = pending ?? { quoteId: quote.quoteId, idempotencyKey: `consultation:${quote.quoteId}` };
    if (pending && pending.quoteId !== quote.quoteId) {
      throw new DomainError('INVALID_STATE', 'Selesaikan atau pulihkan permintaan konsultasi yang statusnya belum pasti terlebih dahulu.');
    }
    await this.pending.write(userId, next);
    return this.submitBooking(userId, next);
  }

  async retryPendingBooking(role: AccountRole, userId: string): Promise<ApiConsultationActionResult> {
    this.requireFarmer(role);
    const pending = await this.pending.read(userId);
    if (!pending) throw new DomainError('NOT_FOUND', 'Tidak ada permintaan konsultasi yang menunggu kepastian.');
    return this.submitBooking(userId, pending);
  }

  async getPendingBooking(role: AccountRole, userId: string): Promise<PendingServerBooking | null> {
    this.requireFarmer(role);
    return this.pending.read(userId);
  }

  private async submitBooking(userId: string, pending: PendingServerBooking): Promise<ApiConsultationActionResult> {
    const result = await this.consultations.create({
      idempotencyKey: pending.idempotencyKey,
      payload: { quoteId: pending.quoteId },
    });
    const consultation = result.consultation;
    if (consultation.farmerId !== userId || consultation.status !== 'awaiting_payment'
      || consultation.paymentStatus !== 'pending') {
      throw new DomainError('API_RESPONSE_INVALID', 'Reservasi server tidak berada pada status menunggu pembayaran.');
    }
    await this.pending.clear(userId);
    return result;
  }

  private requireFarmer(role: AccountRole): void {
    if (role !== 'farmer') throw new DomainError('FORBIDDEN', 'Hanya Peternak dapat membuat konsultasi.');
  }
}

function isUuidValue(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSafeIdr(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
