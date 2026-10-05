import { DomainError } from './errors';

export type VerificationStatus = 'not_submitted' | 'pending' | 'revision_required' | 'verified';
export type ConsultationStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'requested'
  | 'scheduled'
  | 'reschedule_pending'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type VisitStage = 'scheduled' | 'en_route' | 'arrived' | 'examining' | 'completed';

const visitSequence: readonly VisitStage[] = [
  'scheduled',
  'en_route',
  'arrived',
  'examining',
  'completed',
];

export function assertCanAcceptConsultation(input: {
  actorUserId: string;
  assignedVetUserId: string;
  verificationStatus: VerificationStatus;
  consultationStatus: ConsultationStatus;
}): void {
  if (input.actorUserId !== input.assignedVetUserId) {
    throw new DomainError('FORBIDDEN', 'Konsultasi ini bukan untuk dokter yang sedang masuk.');
  }
  if (input.verificationStatus !== 'verified') {
    throw new DomainError('FORBIDDEN', 'Dokter harus terverifikasi sebelum menerima layanan.');
  }
  if (input.consultationStatus !== 'requested') {
    throw new DomainError('INVALID_STATE', 'Hanya permintaan aktif yang dapat diterima.');
  }
}

export function assertConsultationParticipant(input: {
  actorUserId: string;
  farmerUserId: string;
  assignedVetUserId: string;
}): void {
  if (input.actorUserId !== input.farmerUserId && input.actorUserId !== input.assignedVetUserId) {
    throw new DomainError('FORBIDDEN', 'Akun ini tidak terkait dengan layanan tersebut.');
  }
}

export function assertVisitTransition(input: {
  current: VisitStage;
  next: VisitStage;
  clinicalNoteFinal: boolean;
  userConfirmedCompletion: boolean;
}): void {
  const currentIndex = visitSequence.indexOf(input.current);
  const nextIndex = visitSequence.indexOf(input.next);
  if (nextIndex !== currentIndex + 1) {
    throw new DomainError('INVALID_STATE', 'Tahap kunjungan harus dijalankan berurutan.');
  }
  if (input.next === 'completed' && !input.clinicalNoteFinal) {
    throw new DomainError('INVALID_STATE', 'Catatan final diperlukan sebelum layanan selesai.');
  }
  if (input.next === 'completed' && !input.userConfirmedCompletion) {
    throw new DomainError('INVALID_STATE', 'Penyelesaian layanan perlu konfirmasi pengguna.');
  }
}

export interface ClinicalNoteFields {
  complaint: string;
  findings: string;
  assessment: string;
  actions: string;
  careInstructions: string;
}

export function assertClinicalNoteFinalizable(fields: ClinicalNoteFields): void {
  const missing = Object.entries(fields)
    .filter(([, value]) => value.trim().length === 0)
    .map(([key]) => key);
  if (missing.length) {
    throw new DomainError('VALIDATION_FAILED', `Catatan belum lengkap: ${missing.join(', ')}.`);
  }
}

export function assertClinicalNoteEditable(status: 'draft' | 'final'): void {
  if (status === 'final') {
    throw new DomainError('IMMUTABLE_RECORD', 'Catatan klinis final tidak dapat diubah.');
  }
}
