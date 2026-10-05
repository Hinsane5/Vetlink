import type { AccountRole } from '../../domain/auth';
import type { DomainEntity, EntityRelation } from '../../domain/entities';
import type { SelectedAsset } from '../../domain/profiles';

export interface ProfileAggregate {
  user: DomainEntity;
  profile: DomainEntity;
  farm: DomainEntity | null;
  address: DomainEntity | null;
  submissions: DomainEntity[];
  attachments: DomainEntity[];
  drafts: DomainEntity[];
  profileRelations: EntityRelation[];
  farmRelations: EntityRelation[];
}

export interface ProfileCreate {
  entity: DomainEntity;
  relations?: readonly EntityRelation[];
}

export interface ProfileUpdate {
  entity: DomainEntity;
  expectedVersion: number;
  relations?: readonly EntityRelation[];
}

export interface ProfileRepository {
  loadProfile(userId: string, role: AccountRole): Promise<ProfileAggregate>;
  commit(changes: { creates?: readonly ProfileCreate[]; updates?: readonly ProfileUpdate[] }): Promise<void>;
}

export interface AttachmentMedia {
  pickPhoto(): Promise<SelectedAsset | null>;
  pickDocuments(): Promise<SelectedAsset[]>;
  store(asset: SelectedAsset, attachmentId: string): Promise<{
    localUri: string;
    filename: string;
    mimeType: string;
    byteSize: number;
  }>;
  remove(localUri: string): Promise<void>;
}
