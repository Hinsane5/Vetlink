export interface ApiPayoutDestination {
  id: string;
  label: string;
  bankLabel: string;
  accountMasked: string;
  accountHolder: string;
}

export interface ApiWithdrawal {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: 'submitting' | 'submitted' | 'processing' | 'paid' | 'rejected' | 'failed';
  submittedAt: string | null;
  adapterOutcome: 'pending' | 'succeeded' | 'failed';
  destination: ApiPayoutDestination;
}

export interface ApiEarningTransaction {
  id: string;
  consultationId: string;
  displayCode: string;
  serviceLabel: string;
  gross: number;
  commission: number;
  net: number;
  status: 'pending' | 'available';
  earnedAt: string;
}

export interface ApiEarnings {
  period: string;
  periodLabel: string;
  periods: { value: string; label: string }[];
  balances: { pending: number; available: number; reserved: number; paidOut: number };
  totals: { gross: number; commission: number; net: number };
  transactions: ApiEarningTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
  withdrawals: ApiWithdrawal[];
  history: ApiWithdrawal[];
  destinations: ApiPayoutDestination[];
}

export interface ApiWithdrawalPage {
  items: ApiWithdrawal[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiWithdrawalAction {
  operationId: string;
  replayed: boolean;
  adapterOutcome: ApiWithdrawal['adapterOutcome'];
  withdrawal: ApiWithdrawal;
}

export interface ApiEarningsQuery {
  period?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ApiWithdrawalQuery { limit?: number; cursor?: string; }

/** Server scopes all records to the active verified session's vet membership. */
export interface ApiEarningsRepository {
  getEarnings(query?: ApiEarningsQuery): Promise<ApiEarnings>;
  getTransaction(id: string): Promise<ApiEarningTransaction>;
  getDestinations(): Promise<ApiPayoutDestination[]>;
  getWithdrawals(query?: ApiWithdrawalQuery): Promise<ApiWithdrawalPage>;
  getWithdrawal(id: string): Promise<ApiWithdrawal>;
  createWithdrawal(operation: { idempotencyKey: string; payload: { amount: number; destinationId: string } }): Promise<ApiWithdrawalAction>;
}
