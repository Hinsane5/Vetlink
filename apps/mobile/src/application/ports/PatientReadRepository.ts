/** PatientResponseDto returned by the BE-16 assigned-patient projection. */
export interface ApiPatientRecord {
  id: string;
  displayCode: string;
  name: string;
  species: string;
  breed: string | null;
  sex: 'female' | 'male' | 'unknown';
  birthDate: string | null;
  estimatedAgeMonths: number | null;
  /** PostgreSQL numeric is returned as a decimal string. */
  weightKg: string | null;
  farmId: string;
  farmerId: string;
  ownerName: string;
  lastServiceAt: string;
  serviceCount: number;
  latestServiceType: 'chat' | 'visit';
  latestServiceStatus: 'requested' | 'scheduled' | 'reschedule_pending' | 'in_progress'
    | 'en_route' | 'arrived' | 'examining' | 'completed' | 'rejected' | 'cancelled';
}

/** The backend limits this list to the authenticated veterinarian's assigned patients. */
export interface PatientReadRepository {
  listPatients(): Promise<ApiPatientRecord[]>;
}
