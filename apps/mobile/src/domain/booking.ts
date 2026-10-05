import type { DirectoryServiceType } from './directory';
import { DomainError } from './errors';

export type BookingInput = {
  service: DirectoryServiceType; animalId: string; startsAt: string; endsAt: string;
  complaint: string; visitAddress: string; attachmentIds: string[]; selectedDay?: string;
};
export type BookingDraft = {
  id: string; vetId: string; version: number; updatedAt: string; input: BookingInput;
};
export type BookingAttachment = { id: string; kind: 'image' | 'video'; filename: string; localUri: string; byteSize: number };
export type BookingReview = { draftId: string; version: number; total: number; vetName: string; animalName: string; timezone: string; input: BookingInput };
export const emptyBookingInput: BookingInput = { service: 'chat', animalId: '', startsAt: '', endsAt: '', complaint: '', visitAddress: '', attachmentIds: [], selectedDay: '' };

export function validateBookingInput(input: BookingInput): BookingInput {
  if (!['chat', 'visit'].includes(input.service)) throw new DomainError('VALIDATION_FAILED', 'Pilih layanan yang tersedia.');
  if (!input.animalId) throw new DomainError('VALIDATION_FAILED', 'Pilih ternak yang akan diperiksa.');
  if (!Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.startsAt) >= Date.parse(input.endsAt)) {
    throw new DomainError('VALIDATION_FAILED', 'Pilih tanggal dan waktu yang tersedia.');
  }
  const complaint = input.complaint.trim();
  if (complaint.length < 5 || complaint.length > 2000) throw new DomainError('VALIDATION_FAILED', 'Keluhan harus berisi 5 sampai 2.000 karakter.');
  const visitAddress = input.visitAddress.trim();
  if (input.service === 'visit' && (visitAddress.length < 10 || visitAddress.length > 1000)) throw new DomainError('VALIDATION_FAILED', 'Lengkapi alamat kunjungan (10 sampai 1.000 karakter), termasuk kota dan petunjuk lokasi.');
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) throw new DomainError('VALIDATION_FAILED', 'Lampiran tidak boleh berulang.');
  return { ...input, complaint, visitAddress: input.service === 'visit' ? visitAddress : '', attachmentIds: [...input.attachmentIds] };
}
