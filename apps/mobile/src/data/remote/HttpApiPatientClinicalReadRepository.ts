import type { ApiPatientClinicalNote, PatientClinicalReadRepository } from '../../application/ports/PatientReadRepository';
import { ApiClient } from './ApiClient';
import { invalidQuery, invalidResponse, isIsoTimestampWithTimezone, isNonEmptyText, isRecord, isUuid } from './apiReadValidation';

/** Reads final clinical notes from the patient-scoped, assignment-checked BE-16 projection. */
export class HttpApiPatientClinicalReadRepository implements PatientClinicalReadRepository {
  constructor(private readonly api: ApiClient) {}

  async listFinalNotes(animalId: string): Promise<ApiPatientClinicalNote[]> {
    if (!isUuid(animalId)) throw invalidQuery('ID pasien untuk catatan klinis harus UUID.');
    const value = await this.api.request<unknown>(`/v1/patients/${encodeURIComponent(animalId)}/clinical-notes`);
    if (!Array.isArray(value)) throw invalidResponse('Catatan klinis pasien server harus berupa array BE-16.');
    return value.map(parseApiPatientClinicalNote);
  }
}

function parseApiPatientClinicalNote(value: unknown): ApiPatientClinicalNote {
  if (!isRecord(value)
    || !isUuid(value.id) || !isUuid(value.consultationId)
    || !isNonEmptyText(value.complaint, 4000)
    || !isNonEmptyText(value.findings, 8000)
    || !isNonEmptyText(value.assessment, 8000)
    || !isNonEmptyText(value.actions, 8000)
    || !isNonEmptyText(value.careInstructions, 8000)
    || !isIsoTimestampWithTimezone(value.finalizedAt)) {
    throw invalidResponse('Catatan klinis pasien server tidak sesuai PatientClinicalNoteResponseDto BE-16.');
  }
  return {
    id: value.id,
    consultationId: value.consultationId,
    complaint: value.complaint,
    findings: value.findings,
    assessment: value.assessment,
    actions: value.actions,
    careInstructions: value.careInstructions,
    finalizedAt: value.finalizedAt,
  };
}
