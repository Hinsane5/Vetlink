import type { DomainEntity } from './entities';
import { DomainError } from './errors';

export const clinicalNoteFields = ['complaint', 'findings', 'assessment', 'actions', 'careInstructions'] as const;
export type ClinicalNoteField = (typeof clinicalNoteFields)[number];

export interface ClinicalNoteFields {
  complaint: string;
  findings: string;
  assessment: string;
  actions: string;
  careInstructions: string;
}

export interface ClinicalNoteSnapshot {
  record: DomainEntity;
  fields: ClinicalNoteFields;
  status: 'draft' | 'final';
  finalizedAt: string | null;
}

export const clinicalFieldLabels: Record<ClinicalNoteField, string> = {
  complaint: 'Keluhan',
  findings: 'Temuan pemeriksaan',
  assessment: 'Penilaian dokter',
  actions: 'Tindakan yang dilakukan',
  careInstructions: 'Instruksi perawatan',
};

export function validateClinicalNoteDraft(input: ClinicalNoteFields): ClinicalNoteFields {
  if (!input || typeof input !== 'object') throw new DomainError('VALIDATION_FAILED', 'Isi catatan tidak valid.');
  const values = {} as ClinicalNoteFields;
  for (const field of clinicalNoteFields) {
    const value = input[field];
    if (typeof value !== 'string') throw new DomainError('VALIDATION_FAILED', 'Semua bagian catatan harus berupa teks.');
    if (value.length > 2000) throw new DomainError('VALIDATION_FAILED', `${clinicalFieldLabels[field]} maksimal 2.000 karakter.`);
    values[field] = value.trim();
  }
  return values;
}

export function clinicalNoteFieldsFrom(entity: DomainEntity): ClinicalNoteFields {
  return {
    complaint: stringValue(entity.payload.complaint),
    findings: stringValue(entity.payload.findings),
    assessment: stringValue(entity.payload.assessment),
    actions: stringValue(entity.payload.actions),
    careInstructions: stringValue(entity.payload.careInstructions),
  };
}

export function clinicalNoteSnapshot(record: DomainEntity): ClinicalNoteSnapshot {
  const status = record.payload.status;
  if (record.kind !== 'clinicalNote' || (status !== 'draft' && status !== 'final')) {
    throw new DomainError('INVALID_STATE', 'Status catatan pemeriksaan tidak valid.');
  }
  return {
    record,
    fields: clinicalNoteFieldsFrom(record),
    status,
    finalizedAt: typeof record.payload.finalizedAt === 'string' ? record.payload.finalizedAt : null,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
