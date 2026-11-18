import type { AccountRole } from '../domain/auth';
import type { ApiHealthEvent, LivestockHealthReadRepository } from './ports/LivestockHealthRepository';
import type { ApiCareEvent, ApiCareEventInput, LivestockCareEventWriteRepository } from './ports/LivestockHealthRepository';
import type { ApiLivestockRecord } from './ports/LivestockReadRepository';
import type { FarmerReportKind } from '../domain/health';
import { DomainError } from '../domain/errors';
import { ServerLivestockService } from './ServerLivestockService';

export interface PendingCareReportStore {
  read(userId: string, livestockId: string): Promise<ApiCareEventInput | null>;
  write(userId: string, livestockId: string, input: ApiCareEventInput): Promise<void>;
  clear(userId: string, livestockId: string): Promise<void>;
}

/** Read the latest livestock record by ID before opening its BE-03 health timeline. */
export class ServerLivestockHealthService {
  constructor(
    private readonly livestock: ServerLivestockService,
    private readonly health: LivestockHealthReadRepository,
    private readonly care?: LivestockCareEventWriteRepository,
    private readonly pending?: PendingCareReportStore,
    private readonly newKey: () => string = () => { throw new DomainError('INVALID_STATE', 'Pembuat kunci laporan belum tersedia.'); },
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getDetail(role: AccountRole, userId: string, farmId: string, livestockId: string): Promise<{
    animal: ApiLivestockRecord;
    events: ApiHealthEvent[];
  }> {
    const animal = await this.livestock.getForFarm(role, userId, farmId, livestockId);
    const events = await this.health.listHealthEvents(animal.id);
    return { animal, events };
  }

  async getPendingReport(role: AccountRole, userId: string, farmId: string, livestockId: string): Promise<ApiCareEventInput | null> {
    await this.livestock.getForFarm(role, userId, farmId, livestockId);
    return this.requirePending().read(userId, livestockId);
  }

  async createReport(role: AccountRole, userId: string, farmId: string, livestockId: string, kind: FarmerReportKind, description: string): Promise<ApiCareEvent> {
    await this.livestock.getForFarm(role, userId, farmId, livestockId);
    const pending = this.requirePending();
    if (await pending.read(userId, livestockId)) {
      throw new DomainError('INVALID_STATE', 'Selesaikan laporan yang status simpannya belum pasti sebelum membuat laporan baru.');
    }
    const text = description.trim();
    if (!(['disease', 'vaccine', 'medication', 'care'] as readonly string[]).includes(kind) || text.length < 1 || text.length > 2000) {
      throw new DomainError('VALIDATION_FAILED', 'Pilih jenis dan isi keterangan laporan 1 sampai 2000 karakter.');
    }
    const input: ApiCareEventInput = { kind, description: text, occurredAt: this.now(), sourceKey: this.newKey() };
    await pending.write(userId, livestockId, input);
    return this.sendReport(userId, livestockId, input);
  }

  async retryPendingReport(role: AccountRole, userId: string, farmId: string, livestockId: string): Promise<ApiCareEvent> {
    await this.livestock.getForFarm(role, userId, farmId, livestockId);
    const input = await this.requirePending().read(userId, livestockId);
    if (!input) throw new DomainError('NOT_FOUND', 'Tidak ada laporan tertunda untuk dikirim ulang.');
    return this.sendReport(userId, livestockId, input);
  }

  private async sendReport(userId: string, livestockId: string, input: ApiCareEventInput): Promise<ApiCareEvent> {
    if (!this.care) throw new DomainError('INVALID_STATE', 'Layanan laporan kesehatan server belum tersedia.');
    const saved = await this.care.createCareEvent(livestockId, input);
    await this.requirePending().clear(userId, livestockId);
    return saved;
  }

  private requirePending(): PendingCareReportStore {
    if (!this.pending) throw new DomainError('INVALID_STATE', 'Penyimpanan kunci retry laporan belum tersedia.');
    return this.pending;
  }
}
