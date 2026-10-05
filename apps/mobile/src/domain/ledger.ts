import { DomainError } from './errors';

export type LedgerEntryKind =
  | 'earn_pending'
  | 'release_pending'
  | 'credit_available'
  | 'reserve_withdrawal'
  | 'release_withdrawal'
  | 'payout_paid';

export interface LedgerMovement {
  kind: LedgerEntryKind;
  amount: number;
}

export interface WalletBalances {
  pending: number;
  available: number;
  reserved: number;
  paidOut: number;
}

export function calculateWalletBalances(entries: readonly LedgerMovement[]): WalletBalances {
  const balances: WalletBalances = { pending: 0, available: 0, reserved: 0, paidOut: 0 };
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) {
      throw new DomainError('VALIDATION_FAILED', 'Nilai ledger harus berupa integer rupiah positif.');
    }
    switch (entry.kind) {
      case 'earn_pending':
        balances.pending += entry.amount;
        break;
      case 'release_pending':
        balances.pending -= entry.amount;
        break;
      case 'credit_available':
        balances.available += entry.amount;
        break;
      case 'reserve_withdrawal':
        balances.available -= entry.amount;
        balances.reserved += entry.amount;
        break;
      case 'release_withdrawal':
        balances.available += entry.amount;
        balances.reserved -= entry.amount;
        break;
      case 'payout_paid':
        balances.reserved -= entry.amount;
        balances.paidOut += entry.amount;
        break;
    }
  }
  if (Object.values(balances).some((amount) => amount < 0)) {
    throw new DomainError('INVALID_STATE', 'Ledger menghasilkan saldo negatif.');
  }
  return balances;
}
