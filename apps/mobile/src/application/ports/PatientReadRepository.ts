/** Exact compact row returned by the BE-03 patients service query. */
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
}

/** The backend limits this list to the authenticated veterinarian's assigned patients. */
export interface PatientReadRepository {
  listPatients(): Promise<ApiPatientRecord[]>;
}
