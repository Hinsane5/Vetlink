import type { AccountRole } from './auth';
import type { DomainEntity } from './entities';
import type { VerificationStatus } from './policies';

export type DashboardServiceType = 'chat' | 'visit' | 'unknown';

export interface DashboardConsultationItem {
  id: string;
  displayCode: string;
  farmerId: string;
  vetId: string;
  animalId: string | null;
  animalName: string;
  otherPartyName: string;
  type: DashboardServiceType;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  complaint: string;
  visitAddress: string | null;
}

export interface DashboardReminderItem {
  id: string;
  ownerId: string;
  animalId: string | null;
  animalName: string;
  kind: string;
  dueAt: string;
  instructions: string;
  careStatus: string;
  deliveryStatus: string;
}

export interface FarmerDashboardSnapshot {
  role: 'farmer';
  displayName: string;
  farmName: string;
  farmLocation: string;
  totalLivestock: number;
  activeConsultationCount: number;
  activeConsultations: DashboardConsultationItem[];
  upcomingConsultations: DashboardConsultationItem[];
  nextReminder: DashboardReminderItem | null;
  nextReminderDays: number | null;
}

export interface VetDashboardSnapshot {
  role: 'vet';
  displayName: string;
  verificationStatus: VerificationStatus;
  acceptingNewRequests: boolean;
  newRequests: DashboardConsultationItem[];
  todayAppointments: DashboardConsultationItem[];
  upcomingAppointments: DashboardConsultationItem[];
  availableBalance: number;
  pendingBalance: number;
}

export type DashboardSnapshot = FarmerDashboardSnapshot | VetDashboardSnapshot;

export interface DashboardContextDetail {
  role: AccountRole;
  kind: 'consultation' | 'reminder';
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  dateLabel: string | null;
  animalName: string;
  otherPartyName: string | null;
  description: string;
  visitAddress: string | null;
}

const activeConsultationStatuses = new Set(['requested', 'scheduled', 'in_progress']);
const appointmentStatuses = new Set(['scheduled', 'in_progress']);

export function selectFarmerDashboard(input: {
  userId: string;
  displayName: string;
  farmName: string;
  farmLocation: string;
  animals: readonly DomainEntity[];
  consultations: readonly DashboardConsultationItem[];
  reminders: readonly DashboardReminderItem[];
  now: Date;
}): FarmerDashboardSnapshot {
  const animals = input.animals.filter((item) => item.kind === 'livestock' && item.ownerId === input.userId);
  const animalIds = new Set(animals.map((item) => item.id));
  const consultations = input.consultations
    .filter((item) => item.farmerId === input.userId && activeConsultationStatuses.has(item.status))
    .filter((item) => item.animalId === null || animalIds.has(item.animalId))
    .sort(compareStartsAt);
  const reminders = input.reminders
    .filter((item) => item.ownerId === input.userId && item.careStatus === 'scheduled')
    .filter((item) => item.deliveryStatus === 'pending' || item.deliveryStatus === 'sent')
    .filter((item) => item.dueAt.length > 0 && Number.isFinite(Date.parse(item.dueAt)))
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  const nextReminder = reminders[0] ?? null;

  return {
    role: 'farmer',
    displayName: input.displayName,
    farmName: input.farmName,
    farmLocation: input.farmLocation,
    totalLivestock: animals.length,
    activeConsultationCount: consultations.length,
    activeConsultations: consultations,
    upcomingConsultations: consultations.slice(0, 3),
    nextReminder,
    nextReminderDays: nextReminder ? calendarDaysUntil(input.now, new Date(nextReminder.dueAt)) : null,
  };
}

export function selectVetDashboard(input: {
  userId: string;
  displayName: string;
  verificationStatus: VerificationStatus;
  acceptingNewRequests: boolean;
  consultations: readonly DashboardConsultationItem[];
  availableBalance: number;
  pendingBalance: number;
  now: Date;
}): VetDashboardSnapshot {
  const consultations = input.consultations.filter((item) => item.vetId === input.userId);
  const newRequests = consultations
    .filter((item) => item.status === 'requested')
    .sort(compareStartsAt);
  const appointments = consultations
    .filter((item) => appointmentStatuses.has(item.status))
    .filter((item) => item.status === 'in_progress' || !item.startsAt ||
      Date.parse(item.startsAt) >= input.now.getTime() || localDateKey(new Date(item.startsAt)) === localDateKey(input.now))
    .sort(compareStartsAt);
  const today = localDateKey(input.now);
  const todayAppointments = appointments.filter((item) => item.startsAt && localDateKey(new Date(item.startsAt)) === today);

  return {
    role: 'vet',
    displayName: input.displayName,
    verificationStatus: input.verificationStatus,
    acceptingNewRequests: input.verificationStatus === 'verified' && input.acceptingNewRequests,
    newRequests,
    todayAppointments,
    upcomingAppointments: appointments.slice(0, 5),
    availableBalance: input.availableBalance,
    pendingBalance: input.pendingBalance,
  };
}

export function calendarDaysUntil(now: Date, due: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.max(0, Math.round((dueDay - today) / 86_400_000));
}

function compareStartsAt(left: DashboardConsultationItem, right: DashboardConsultationItem): number {
  const leftTime = left.startsAt ? Date.parse(left.startsAt) : Number.MAX_SAFE_INTEGER;
  const rightTime = right.startsAt ? Date.parse(right.startsAt) : Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime || left.id.localeCompare(right.id);
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}
