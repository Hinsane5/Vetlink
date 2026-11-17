export interface ApiWeekdayRule { weekday: number; start: string; end: string; }
export interface ApiVetAvailability {
  vetId: string;
  acceptingNewRequests: boolean;
  services: ('chat' | 'visit')[];
  timezone: string;
  weekdayRules: ApiWeekdayRule[];
  chatDurationMinutes: number;
  visitDurationMinutes: number;
  updatedAt: string;
  version: number;
  experienceYears: number;
  specialties: string[];
  species: string[];
  practiceLocation: string;
  serviceAreas: string[];
  rates: Partial<Record<'chat' | 'visit', number>>;
}

export interface ApiVetAvailabilityInput {
  expectedVersion: number;
  acceptingNewRequests: boolean;
  services: ('chat' | 'visit')[];
  timezone: string;
  weekdayRules: ApiWeekdayRule[];
  chatDurationMinutes: number;
  visitDurationMinutes: number;
  rates: Partial<Record<'chat' | 'visit', number>>;
  experienceYears?: number;
  specialties?: string[];
  species?: string[];
  practiceLocation?: string;
  serviceAreas?: string[];
}

export interface ApiVetAvailabilityResult {
  operationId: string;
  status: 'succeeded';
  occurredAt: string;
  value: ApiVetAvailability;
}

export interface ApiVetBlockedTime {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: 'active' | 'cancelled';
  version: number;
}

export interface ApiVetBlockedTimeInput { startsAt: string; endsAt: string; reason: string; }
export interface ApiVetBlockedTimeCreateResult {
  operationId: string;
  status: 'succeeded';
  occurredAt: string;
  value: ApiVetBlockedTime;
}
export interface ApiVetBlockedTimeCancelResult { id: string; status: 'cancelled'; version: number; }

export interface ApiVetSchedule {
  appointments: {
    id: string; displayCode: string; service: 'chat' | 'visit'; status: string;
    startsAt: string; endsAt: string; feeIdr: string;
  }[];
  followUps: {
    id: string; consultationId: string; animalId: string; farmerId: string;
    startsAt: string; endsAt: string; reason: string; status: 'scheduled'; version: number;
  }[];
  blockedTimes: Omit<ApiVetBlockedTime, 'version'>[];
}

export interface ApiVetScheduleRepository {
  getAvailability(): Promise<ApiVetAvailability | null>;
  updateAvailability(input: ApiVetAvailabilityInput): Promise<ApiVetAvailabilityResult>;
  getBlockedTimes(): Promise<ApiVetBlockedTime[]>;
  createBlockedTime(input: ApiVetBlockedTimeInput): Promise<ApiVetBlockedTimeCreateResult>;
  updateBlockedTime(id: string, input: ApiVetBlockedTimeInput & { expectedVersion: number }): Promise<ApiVetBlockedTime>;
  cancelBlockedTime(id: string, expectedVersion: number): Promise<ApiVetBlockedTimeCancelResult>;
  getSchedule(from: string, to: string): Promise<ApiVetSchedule>;
}
