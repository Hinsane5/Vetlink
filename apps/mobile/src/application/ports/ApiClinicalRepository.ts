export interface ApiClinicalNote {
  id: string | null;
  consultationId: string;
  status: 'draft' | 'final';
  complaint: string;
  findings: string;
  assessment: string;
  actions: string;
  careInstructions: string;
  version: number;
  finalizedAt: string | null;
}

export interface ApiClinicalNoteInput {
  expectedVersion: number;
  complaint?: string;
  findings?: string;
  assessment?: string;
  actions?: string;
  careInstructions?: string;
}

export interface ApiRecommendationItem {
  productId: string | null;
  title: string;
  instructions: string;
  note: string;
}

export interface ApiRecommendation {
  id: string | null;
  consultationId: string;
  status: 'draft' | 'sent';
  version: number;
  sentAt: string | null;
  items: ApiRecommendationItem[] | null;
  alreadySent?: boolean;
}

export interface ApiRecommendationInput {
  expectedVersion: number;
  items: { productId?: string; title?: string; instructions?: string; note?: string }[];
}

/** Server decides access, draft visibility, final immutability, and send eligibility. */
export interface ApiClinicalRepository {
  getNote(consultationId: string): Promise<ApiClinicalNote>;
  saveNote(consultationId: string, input: ApiClinicalNoteInput): Promise<ApiClinicalNote>;
  finalizeNote(consultationId: string, expectedVersion: number): Promise<ApiClinicalNote>;
  getRecommendation(consultationId: string): Promise<ApiRecommendation>;
  saveRecommendation(consultationId: string, input: ApiRecommendationInput): Promise<ApiRecommendation>;
  sendRecommendation(consultationId: string, expectedVersion: number): Promise<ApiRecommendation>;
}
