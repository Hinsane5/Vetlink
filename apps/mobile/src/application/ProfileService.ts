import type { AccountRole } from '../domain/auth';
import type { DomainEntity, EntityRelation } from '../domain/entities';
import { DomainError } from '../domain/errors';
import {
  isVerificationStatus,
  validateFarmerProfile,
  validateVetProfile,
  type AttachmentSelection,
  type AttachmentSummary,
  type FarmerProfileInput,
  type ProfileForm,
  type ProfileMediaSelection,
  type ProfileSnapshot,
  type SelectedAsset,
  type VetProfileInput,
} from '../domain/profiles';
import type { AttachmentMedia, ProfileAggregate, ProfileCreate, ProfileRepository, ProfileUpdate } from './ports/ProfileRepository';
import type { IdFactory } from './ports/AuthRepository';

export class ProfileService {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly media: AttachmentMedia,
    private readonly ids: IdFactory,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(userId: string, role: AccountRole): Promise<ProfileSnapshot> {
    return toSnapshot(await this.repository.loadProfile(userId, role));
  }

  pickPhoto(): Promise<SelectedAsset | null> {
    return this.media.pickPhoto();
  }

  pickDocuments(): Promise<SelectedAsset[]> {
    return this.media.pickDocuments();
  }

  async saveFarmerProfile(userId: string, input: FarmerProfileInput, selection?: AttachmentSelection): Promise<void> {
    const values = validateFarmerProfile(input);
    const current = await this.repository.loadProfile(userId, 'farmer');
    const attachments = await this.resolveSelection(userId, current.profile.id, selection, 'profile', 'image', current);
    const farmId = current.farm?.id ?? existingString(current.profile.payload.farmId) ?? this.ids.create();
    const addressId = current.address?.id ?? this.ids.create();
    const timestamp = this.now().toISOString();
    const photoId = attachments.selectionId ?? existingString(current.profile.payload.photoAttachmentId);
    const user = revised(current.user, { name: values.displayName }, timestamp);
    const profile = revised(current.profile, {
      userId,
      farmId,
      photoAttachmentId: photoId,
    }, timestamp);
    const farm = current.farm
      ? revised(current.farm, { name: values.farmName, species: values.species, location: values.farmLocation, visitAddressId: addressId }, timestamp)
      : createEntity('farm', farmId, userId, { name: values.farmName, species: values.species, location: values.farmLocation, visitAddressId: addressId }, timestamp, current.profile.id);
    const addressPayload = {
      label: values.addressLabel,
      recipient: values.recipient,
      phone: values.phone,
      address: values.address,
      city: values.city,
      province: values.province,
      postalCode: values.postalCode,
    };
    const address = current.address
      ? revised(current.address, addressPayload, timestamp)
      : createEntity('address', addressId, userId, addressPayload, timestamp, current.profile.id);

    const creates: ProfileCreate[] = [...attachments.creates];
    const updates: ProfileUpdate[] = [
      update(user, current.user),
      update(profile, current.profile, farmerProfileRelations(current.profileRelations, profile.id, userId, farmId, addressId, photoId)),
      ...(current.farm ? [update(farm, current.farm, farmRelations(current.farmRelations, farmId, userId, addressId))] : []),
      ...(current.address ? [update(address, current.address)] : []),
      ...appliedDraftUpdates(current, timestamp),
    ];
    if (!current.farm) creates.push({ entity: farm, relations: [{ sourceId: farmId, relationship: 'owner', targetId: userId }, { sourceId: farmId, relationship: 'visitAddress', targetId: addressId }] });
    if (!current.address) creates.push({ entity: address });
    await this.commitWithMediaCleanup({ creates, updates }, attachments.storedUris);
  }

  async saveVetProfile(userId: string, input: VetProfileInput, mediaSelection: ProfileMediaSelection = {}): Promise<void> {
    const values = validateVetProfile(input);
    const current = await this.repository.loadProfile(userId, 'vet');
    const photo = await this.resolveSelection(userId, current.profile.id, mediaSelection.photo, 'profile', 'image', current);
    const timestamp = this.now().toISOString();
    const photoId = photo.selectionId ?? existingString(current.profile.payload.photoAttachmentId);
    const profile = revised(current.profile, {
      ...values,
      photoAttachmentId: photoId,
      verificationStatus: isVerificationStatus(current.profile.payload.verificationStatus)
        ? current.profile.payload.verificationStatus
        : 'not_submitted',
    }, timestamp);
    const relations = vetProfileRelations(current.profileRelations, profile.id, userId, photoId);
    const updates = [update(profile, current.profile, relations)];
    await this.commitWithMediaCleanup({ creates: photo.creates, updates }, photo.storedUris);
  }

  async saveDraft(userId: string, role: AccountRole, form: ProfileForm, mediaSelection: ProfileMediaSelection = {}): Promise<void> {
    if (form.role !== role) throw new DomainError('FORBIDDEN', 'Draft profil tidak sesuai dengan peran akun.');
    const current = await this.repository.loadProfile(userId, role);
    const existingDraft = current.drafts.find((draft) => draft.payload.role === role && draft.payload.status === 'draft') ?? null;
    const photo = await this.resolveSelection(userId, current.profile.id, mediaSelection.photo, 'profile', 'image', current);
    let documents: Awaited<ReturnType<ProfileService['resolveMultipleSelections']>>;
    try {
      documents = await this.resolveMultipleSelections(userId, current.profile.id, mediaSelection.documents ?? [], current, existingDraft);
    } catch (error) {
      await Promise.allSettled(photo.storedUris.map((uri) => this.media.remove(uri)));
      throw error;
    }
    const timestamp = this.now().toISOString();
    const draftId = existingDraft?.id ?? this.ids.create();
    const photoId = photo.selectionId ?? (existingDraft ? existingString(existingDraft.payload.photoAttachmentId) : null);
    const documentIds = [...new Set([
      ...documents.selectionIds,
      ...(!mediaSelection.documents ? draftDocumentIds(existingDraft) : []),
    ])];
    const payload = {
      role,
      status: 'draft',
      form,
      photoAttachmentId: photoId ?? null,
      documentAttachmentIds: documentIds,
      updatedAt: timestamp,
    };
    const draft = existingDraft
      ? revised(existingDraft, payload, timestamp)
      : createEntity('profileDraft', draftId, userId, payload, timestamp, current.profile.id);
    const createAttachments = [...photo.creates, ...documents.creates];
    const relations: EntityRelation[] = [
      { sourceId: draftId, relationship: 'user', targetId: userId },
      ...(photoId ? [{ sourceId: draftId, relationship: 'photo', targetId: photoId }] : []),
      ...documentIds.map((id) => ({ sourceId: draftId, relationship: 'document', targetId: id })),
    ];
    const changes = existingDraft
      ? { creates: createAttachments, updates: [update(draft, existingDraft, relations)] }
      : { creates: [...createAttachments, { entity: draft, relations }] };
    await this.commitWithMediaCleanup(changes, [...photo.storedUris, ...documents.storedUris]);
  }

  async submitVetVerification(
    userId: string,
    input: VetProfileInput,
    documents: readonly AttachmentSelection[],
    photo?: AttachmentSelection,
  ): Promise<void> {
    const values = validateVetProfile(input);
    const current = await this.repository.loadProfile(userId, 'vet');
    const status = isVerificationStatus(current.profile.payload.verificationStatus)
      ? current.profile.payload.verificationStatus
      : 'not_submitted';
    if (status === 'pending') throw new DomainError('INVALID_STATE', 'Pengajuan masih menunggu verifikasi.');
    if (status === 'verified') throw new DomainError('INVALID_STATE', 'Dokter ini sudah terverifikasi.');
    if (status !== 'not_submitted' && status !== 'revision_required') {
      throw new DomainError('INVALID_STATE', 'Status verifikasi belum memungkinkan pengajuan.');
    }
    const draft = current.drafts.find((item) => item.payload.role === 'vet' && item.payload.status === 'draft') ?? null;
    const chosenDocuments = documents.length
      ? documents
      : draftDocumentIds(draft).map((attachmentId) => ({ type: 'existing' as const, attachmentId }));
    if (!chosenDocuments.length) throw new DomainError('VALIDATION_FAILED', 'Pilih minimal satu dokumen pendukung sebelum mengajukan verifikasi.');
    const photoResult = await this.resolveSelection(userId, current.profile.id, photo, 'profile', 'image', current);
    let documentResult: Awaited<ReturnType<ProfileService['resolveMultipleSelections']>>;
    try {
      documentResult = await this.resolveMultipleSelections(userId, current.profile.id, chosenDocuments, current, draft);
    } catch (error) {
      await Promise.allSettled(photoResult.storedUris.map((uri) => this.media.remove(uri)));
      throw error;
    }
    const timestamp = this.now().toISOString();
    const submissionId = this.ids.create();
    const photoId = photoResult.selectionId ?? existingString(current.profile.payload.photoAttachmentId);
    const profile = revised(current.profile, {
      ...values,
      photoAttachmentId: photoId,
      verificationStatus: 'pending',
    }, timestamp);
    const submission = createEntity('verificationSubmission', submissionId, userId, {
      vetId: userId,
      documentAttachmentIds: documentResult.selectionIds,
      status: 'pending',
      reviewerReason: null,
      submittedAt: timestamp,
      reviewedAt: null,
      professionalDetailsSnapshot: values,
    }, timestamp, profile.id);
    const creates: ProfileCreate[] = [
      ...photoResult.creates,
      ...documentResult.creates,
      {
        entity: submission,
        relations: [
          { sourceId: profile.id, relationship: 'verificationSubmission', targetId: submissionId },
          ...documentResult.selectionIds.map((id) => ({ sourceId: submissionId, relationship: 'document', targetId: id })),
        ],
      },
    ];
    const updates: ProfileUpdate[] = [update(profile, current.profile, vetProfileRelations(current.profileRelations, profile.id, userId, photoId))];
    if (draft) {
      updates.push(update(revised(draft, { ...draft.payload, status: 'submitted', submissionId }, timestamp), draft));
    }
    await this.commitWithMediaCleanup({ creates, updates }, [...photoResult.storedUris, ...documentResult.storedUris]);
  }

  private async resolveSelection(
    userId: string,
    contextId: string,
    selection: AttachmentSelection | undefined,
    accessContext: 'profile' | 'verification',
    kind: 'image' | 'document',
    current: ProfileAggregate,
  ): Promise<{ selectionId: string | null; creates: ProfileCreate[]; storedUris: string[] }> {
    if (!selection) return { selectionId: null, creates: [], storedUris: [] };
    if (selection.type === 'existing') {
      const stored = current.attachments.find((attachment) => attachment.id === selection.attachmentId);
      if (!stored || stored.payload.kind !== kind) throw new DomainError('FORBIDDEN', 'Lampiran tidak ditemukan pada profil ini.');
      return { selectionId: stored.id, creates: [], storedUris: [] };
    }
    if (selection.asset.kind !== kind) throw new DomainError('VALIDATION_FAILED', 'Jenis lampiran tidak sesuai.');
    const id = this.ids.create();
    const file = await this.media.store(selection.asset, id);
    const entity = createEntity('attachment', id, userId, {
      ownerId: userId,
      kind,
      mimeType: file.mimeType,
      filename: file.filename,
      byteSize: file.byteSize,
      localUri: file.localUri,
      accessContext,
      uploadStatus: 'local',
    }, this.now().toISOString(), contextId);
    return {
      selectionId: id,
      creates: [{ entity }],
      storedUris: [file.localUri],
    };
  }

  private async resolveMultipleSelections(
    userId: string,
    contextId: string,
    selections: readonly AttachmentSelection[],
    current: ProfileAggregate,
    draft?: DomainEntity | null,
  ): Promise<{ selectionIds: string[]; creates: ProfileCreate[]; storedUris: string[] }> {
    const selectionIds: string[] = [];
    const creates: ProfileCreate[] = [];
    const storedUris: string[] = [];
    try {
      for (const selection of selections) {
        if (selection.type === 'existing') {
          const stored = current.attachments.find((attachment) => attachment.id === selection.attachmentId);
          const belongsToDraft = draftDocumentIds(draft ?? null).includes(selection.attachmentId);
          if (!stored || stored.payload.kind !== 'document' || !belongsToDraft) {
            throw new DomainError('FORBIDDEN', 'Dokumen yang dipilih bukan bagian dari draft akun ini.');
          }
          selectionIds.push(stored.id);
          continue;
        }
        if (selection.asset.kind !== 'document') throw new DomainError('VALIDATION_FAILED', 'Lampiran verifikasi harus berupa dokumen.');
        const resolved = await this.resolveSelection(userId, contextId, selection, 'verification', 'document', current);
        if (resolved.selectionId) selectionIds.push(resolved.selectionId);
        creates.push(...resolved.creates);
        storedUris.push(...resolved.storedUris);
      }
    } catch (error) {
      await Promise.allSettled(storedUris.map((uri) => this.media.remove(uri)));
      throw error;
    }
    return { selectionIds: [...new Set(selectionIds)], creates, storedUris };
  }

  private async commitWithMediaCleanup(
    changes: { creates?: readonly ProfileCreate[]; updates?: readonly ProfileUpdate[] },
    storedUris: readonly string[],
  ): Promise<void> {
    try {
      await this.repository.commit(changes);
    } catch (error) {
      await Promise.allSettled(storedUris.map((uri) => this.media.remove(uri)));
      throw error;
    }
  }
}

function toSnapshot(current: ProfileAggregate): ProfileSnapshot {
  const attachments = new Map(current.attachments.map((attachment) => [attachment.id, attachmentSummary(attachment)]));
  const role = current.profile.kind === 'farmerProfile' ? 'farmer' : 'vet';
  const activeDraft = current.drafts.find((draft) => draft.payload.role === role && draft.payload.status === 'draft') ?? null;
  const photoId = existingString(current.profile.payload.photoAttachmentId);
  const submission = [...current.submissions].sort((left, right) => String(right.payload.submittedAt ?? '').localeCompare(String(left.payload.submittedAt ?? '')))[0] ?? null;
  const verificationStatus = role === 'vet'
    ? isVerificationStatus(current.profile.payload.verificationStatus) ? current.profile.payload.verificationStatus : 'not_submitted'
    : null;
  const reason = typeof submission?.payload.reviewerReason === 'string' ? submission.payload.reviewerReason : null;
  const draft = activeDraft ? decodeDraft(activeDraft, attachments) : null;
  const farmer = role === 'farmer' ? farmerValues(current) : null;
  const vet = role === 'vet' ? vetValues(current.profile) : null;
  const verificationIds = Array.isArray(submission?.payload.documentAttachmentIds)
    ? submission.payload.documentAttachmentIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    role,
    displayName: String(current.user.payload.name ?? ''),
    farmer,
    vet,
    photo: photoId ? attachments.get(photoId) ?? null : null,
    verificationStatus,
    reviewerReason: reason,
    verificationDocuments: verificationIds.map((id) => attachments.get(id)).filter((value): value is AttachmentSummary => Boolean(value)),
    draft,
  };
}

function farmerValues(current: ProfileAggregate): FarmerProfileInput {
  const farm = current.farm?.payload ?? {};
  const address = current.address?.payload ?? {};
  return {
    displayName: String(current.user.payload.name ?? ''),
    farmName: String(farm.name ?? ''),
    species: speciesArray(farm.species),
    farmLocation: String(farm.location ?? ''),
    addressLabel: String(address.label ?? ''),
    recipient: String(address.recipient ?? ''),
    phone: String(address.phone ?? ''),
    address: String(address.address ?? ''),
    city: String(address.city ?? ''),
    province: String(address.province ?? ''),
    postalCode: String(address.postalCode ?? ''),
  };
}

function vetValues(profile: DomainEntity): VetProfileInput {
  return {
    professionalName: String(profile.payload.professionalName ?? ''),
    registrationNumber: String(profile.payload.registrationNumber ?? ''),
    experienceYears: typeof profile.payload.experienceYears === 'number' ? profile.payload.experienceYears : 0,
    services: Array.isArray(profile.payload.services) ? profile.payload.services.filter((item): item is 'chat' | 'visit' => item === 'chat' || item === 'visit') : [],
    species: speciesArray(profile.payload.species),
    practiceLocation: String(profile.payload.practiceLocation ?? ''),
    visitRegions: stringArray(profile.payload.visitRegions),
  };
}

function decodeDraft(draft: DomainEntity, attachments: Map<string, AttachmentSummary>): ProfileSnapshot['draft'] {
  const form = draft.payload.form;
  if (!form || typeof form !== 'object' || !('role' in form) || !('values' in form)) return null;
  const draftForm = form as ProfileForm;
  const photoId = existingString(draft.payload.photoAttachmentId);
  return {
    form: draftForm,
    photo: photoId ? attachments.get(photoId) ?? null : null,
    documents: draftDocumentIds(draft).map((id) => attachments.get(id)).filter((value): value is AttachmentSummary => Boolean(value)),
  };
}

function attachmentSummary(entity: DomainEntity): AttachmentSummary {
  return {
    id: entity.id,
    filename: String(entity.payload.filename ?? ''),
    mimeType: String(entity.payload.mimeType ?? ''),
    byteSize: typeof entity.payload.byteSize === 'number' ? entity.payload.byteSize : 0,
    localUri: String(entity.payload.localUri ?? ''),
    kind: entity.payload.kind === 'document' ? 'document' : 'image',
  };
}

function draftDocumentIds(draft: DomainEntity | null | undefined): string[] {
  return Array.isArray(draft?.payload.documentAttachmentIds)
    ? draft.payload.documentAttachmentIds.filter((id): id is string => typeof id === 'string')
    : [];
}

function farmerProfileRelations(current: readonly EntityRelation[], profileId: string, userId: string, farmId: string, addressId: string, photoId: string | null): EntityRelation[] {
  return [
    ...current.filter((relation) => !['user', 'farm', 'address', 'photo'].includes(relation.relationship)),
    { sourceId: profileId, relationship: 'user', targetId: userId },
    { sourceId: profileId, relationship: 'farm', targetId: farmId },
    { sourceId: profileId, relationship: 'address', targetId: addressId },
    ...(photoId ? [{ sourceId: profileId, relationship: 'photo', targetId: photoId }] : []),
  ];
}

function vetProfileRelations(current: readonly EntityRelation[], profileId: string, userId: string, photoId: string | null): EntityRelation[] {
  return [
    ...current.filter((relation) => !['user', 'photo'].includes(relation.relationship)),
    { sourceId: profileId, relationship: 'user', targetId: userId },
    ...(photoId ? [{ sourceId: profileId, relationship: 'photo', targetId: photoId }] : []),
  ];
}

function farmRelations(current: readonly EntityRelation[], farmId: string, userId: string, addressId: string): EntityRelation[] {
  return [
    ...current.filter((relation) => !['owner', 'visitAddress'].includes(relation.relationship)),
    { sourceId: farmId, relationship: 'owner', targetId: userId },
    { sourceId: farmId, relationship: 'visitAddress', targetId: addressId },
  ];
}

function appliedDraftUpdates(current: ProfileAggregate, timestamp: string): ProfileUpdate[] {
  return current.drafts
    .filter((draft) => draft.payload.role === 'farmer' && draft.payload.status === 'draft')
    .map((draft) => update(revised(draft, { ...draft.payload, status: 'applied' }, timestamp), draft));
}

function createEntity(kind: DomainEntity['kind'], id: string, ownerId: string, payload: Record<string, unknown>, timestamp: string, contextId: string | null = null): DomainEntity {
  return { id, kind, ownerId, contextId, payload, createdAt: timestamp, updatedAt: timestamp, version: 1 };
}

function revised(entity: DomainEntity, payload: Record<string, unknown>, timestamp: string): DomainEntity {
  return { ...entity, payload, updatedAt: timestamp, version: entity.version + 1 };
}

function update(entity: DomainEntity, current: DomainEntity, relations?: readonly EntityRelation[]): ProfileUpdate {
  return { entity, expectedVersion: current.version, ...(relations ? { relations } : {}) };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function speciesArray(value: unknown): FarmerProfileInput['species'] {
  const allowed = new Set(['cattle', 'goat', 'sheep', 'poultry', 'duck', 'pig', 'horse']);
  return stringArray(value).filter((item): item is FarmerProfileInput['species'][number] => allowed.has(item));
}

function existingString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
