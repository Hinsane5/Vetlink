import type { DomainEntity } from '../domain/entities';
import { DomainError } from '../domain/errors';
import type { DomainRepository } from './ports/DomainRepository';
import type { IdFactory } from './ports/AuthRepository';

export const notificationCategories = ['consultations', 'reminders', 'commerce'] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

export interface NotificationCategoriesState {
  consultations: boolean;
  reminders: boolean;
  commerce: boolean;
}

export interface PreferencesSnapshot {
  id: string;
  userId: string;
  enabled: boolean;
  notifications: NotificationCategoriesState;
  version: number;
  updatedAt: string;
}

export interface PreferencesUpdate {
  enabled?: boolean;
  notifications?: Partial<NotificationCategoriesState>;
}

const defaultCategories: NotificationCategoriesState = {
  consultations: true,
  reminders: true,
  commerce: true,
};

/** Persists one preference record per account without changing inbox records. */
export class PreferencesService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string): Promise<PreferencesSnapshot> {
    await this.requireUser(userId);
    const existing = await this.findForUser(userId);
    if (existing) return toSnapshot(existing, userId);

    const timestamp = this.now().toISOString();
    const created: DomainEntity = {
      id: this.ids.create(),
      kind: 'preferences',
      ownerId: userId,
      contextId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      payload: { userId, enabled: true, notifications: { ...defaultCategories } },
    };
    try {
      await this.repository.create(created, [{ sourceId: created.id, targetId: userId, relationship: 'user' }]);
      return toSnapshot(created, userId);
    } catch (cause) {
      // A second screen may initialize the same account at the same time. Read the winner.
      const raced = await this.findForUser(userId);
      if (raced) return toSnapshot(raced, userId);
      throw cause;
    }
  }

  async update(userId: string, patch: PreferencesUpdate): Promise<PreferencesSnapshot> {
    validatePatch(patch);
    let current = await this.ensure(userId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = toSnapshot(current, userId);
      const nextEnabled = patch.enabled ?? snapshot.enabled;
      const nextCategories = { ...snapshot.notifications, ...patch.notifications };
      if (nextEnabled === snapshot.enabled && sameCategories(nextCategories, snapshot.notifications)) {
        return snapshot;
      }
      const timestamp = this.now().toISOString();
      const updated: DomainEntity = {
        ...current,
        payload: { ...current.payload, userId, enabled: nextEnabled, notifications: nextCategories },
        updatedAt: timestamp,
        version: current.version + 1,
      };
      try {
        await this.repository.update(updated, current.version);
        return toSnapshot(updated, userId);
      } catch (cause) {
        if (!(cause instanceof DomainError) || cause.code !== 'VERSION_CONFLICT') throw cause;
        const latest = await this.findForUser(userId);
        if (!latest) throw cause;
        current = latest;
      }
    }
    throw new DomainError('VERSION_CONFLICT', 'Preferensi sedang berubah. Muat ulang sebelum mencoba lagi.');
  }

  private async ensure(userId: string): Promise<DomainEntity> {
    await this.requireUser(userId);
    const existing = await this.findForUser(userId);
    if (existing) return existing;
    await this.load(userId);
    const created = await this.findForUser(userId);
    if (!created) throw new DomainError('INVALID_STATE', 'Preferensi akun belum dapat disimpan.');
    return created;
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.repository.findById('user', userId);
    if (!user) throw new DomainError('NOT_FOUND', 'Akun tidak ditemukan.');
  }

  private async findForUser(userId: string): Promise<DomainEntity | null> {
    const records = (await this.repository.listByOwner('preferences', userId))
      .filter((record) => record.kind === 'preferences' && record.ownerId === userId && record.payload.userId === userId);
    if (records.length > 1) throw new DomainError('INVALID_STATE', 'Preferensi akun ganda tidak dapat dimuat.');
    return records[0] ?? null;
  }
}

function validatePatch(patch: PreferencesUpdate): void {
  if (typeof patch !== 'object' || patch === null) {
    throw new DomainError('VALIDATION_FAILED', 'Preferensi tidak valid.');
  }
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
    throw new DomainError('VALIDATION_FAILED', 'Status notifikasi harus aktif atau nonaktif.');
  }
  if (patch.notifications === undefined) return;
  if (typeof patch.notifications !== 'object' || patch.notifications === null || Array.isArray(patch.notifications)) {
    throw new DomainError('VALIDATION_FAILED', 'Kategori notifikasi tidak valid.');
  }
  for (const [category, value] of Object.entries(patch.notifications)) {
    if (!(notificationCategories as readonly string[]).includes(category) || typeof value !== 'boolean') {
      throw new DomainError('VALIDATION_FAILED', 'Kategori notifikasi tidak valid.');
    }
  }
}

function toSnapshot(record: DomainEntity, userId: string): PreferencesSnapshot {
  const stored = typeof record.payload.notifications === 'object' && record.payload.notifications !== null
    ? record.payload.notifications as Record<string, unknown>
    : {};
  return {
    id: record.id,
    userId,
    enabled: record.payload.enabled !== false,
    notifications: {
      consultations: stored.consultations !== false,
      reminders: stored.reminders !== false,
      commerce: stored.commerce !== false,
    },
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

function sameCategories(left: NotificationCategoriesState, right: NotificationCategoriesState): boolean {
  return notificationCategories.every((category) => left[category] === right[category]);
}
