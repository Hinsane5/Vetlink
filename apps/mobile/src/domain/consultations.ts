import type { DomainEntity } from './entities';
export type ConsultationAction = 'accept' | 'reject' | 'propose' | 'approve' | 'decline' | 'cancel';
export type ConsultationCommand = {
  id: string; version: number; operationKey: string; action: ConsultationAction;
  reason?: string; startsAt?: string; endsAt?: string; proposalId?: string;
};
export type ConsultationDetail = {
  record: DomainEntity; timezone: string; animalName: string; otherPartyName: string; verified: boolean; paid: boolean;
  proposal: DomainEntity | null; visit: DomainEntity | null; history: DomainEntity[];
  attachments: { id: string; filename: string; kind: string; localUri: string }[];
};
export type ProposalInput = { reason: string; startsAt: string; endsAt: string };
export const emptyProposalInput: ProposalInput = { reason: '', startsAt: '', endsAt: '' };
export function consultationLabel(status: string): string {
  return ({ awaiting_payment: 'Menunggu pembayaran', requested: 'Menunggu dokter', scheduled: 'Terjadwal', reschedule_pending: 'Menunggu respons jadwal', in_progress: 'Berlangsung', completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan' } as Record<string, string>)[status] ?? status;
}
export const actionLabels: Record<ConsultationAction, string> = { accept: 'Permintaan diterima', reject: 'Permintaan ditolak', propose: 'Jadwal baru diusulkan', approve: 'Usulan jadwal diterima', decline: 'Usulan jadwal ditolak', cancel: 'Layanan dibatalkan' };
export function consultationTab(record: DomainEntity): 'requests' | 'appointments' | 'history' {
  if (['awaiting_payment', 'requested'].includes(String(record.payload.status))) return 'requests';
  if (['scheduled', 'reschedule_pending', 'in_progress'].includes(String(record.payload.status))) return 'appointments';
  return 'history';
}
