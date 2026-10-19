import { Injectable } from '@nestjs/common';
import { adapterFailed, adapterPending, adapterSucceeded, type AdapterResult } from '../communication/adapter-result.js';

export const EARNING_SETTLEMENT_ADAPTER = Symbol('EARNING_SETTLEMENT_ADAPTER');
export const WITHDRAWAL_SUBMISSION_ADAPTER = Symbol('WITHDRAWAL_SUBMISSION_ADAPTER');

export interface EarningSettlementAdapter {
  settle(earningId: string, operationKey: string): Promise<AdapterResult<{ reference: string }>>;
}

/** Local-only settlement stays pending until an internal result is recorded. */
@Injectable()
export class LocalEarningSettlementAdapter implements EarningSettlementAdapter {
  constructor(private readonly outcome: 'pending' | 'succeeded' | 'failed' = 'pending') {}

  async settle(earningId: string, operationKey: string): Promise<AdapterResult<{ reference: string }>> {
    const value = { reference: `LOCAL-LEDGER-${earningId}-${operationKey}` };
    if (this.outcome === 'failed') return adapterFailed('LOCAL_SETTLEMENT_FAILED', 'Adapter settlement lokal gagal.', true);
    if (this.outcome === 'succeeded') return adapterSucceeded(value);
    return adapterPending(value);
  }
}

export interface PayoutDestinationSnapshot {
  id: string;
  label: string;
  bankLabel: string;
  accountMasked: string;
  accountHolder: string;
}

export interface WithdrawalSubmissionAdapter {
  submit(input: {
    withdrawalId: string;
    operationKey: string;
    amountIdr: number;
    destination: PayoutDestinationSnapshot;
  }): Promise<AdapterResult<{ reference: string }>>;
}

/** A local acknowledgement only; it never sends or transfers funds. */
@Injectable()
export class LocalWithdrawalSubmissionAdapter implements WithdrawalSubmissionAdapter {
  constructor(private readonly outcome: 'pending' | 'succeeded' | 'failed' = 'succeeded') {}

  async submit(input: {
    withdrawalId: string;
    operationKey: string;
    amountIdr: number;
    destination: PayoutDestinationSnapshot;
  }): Promise<AdapterResult<{ reference: string }>> {
    void input.amountIdr;
    void input.destination;
    const value = { reference: `LOCAL-WITHDRAWAL-${input.withdrawalId}-${input.operationKey}` };
    if (this.outcome === 'failed') return adapterFailed('LOCAL_WITHDRAWAL_FAILED', 'Adapter pencairan lokal gagal.', true);
    if (this.outcome === 'pending') return adapterPending(value);
    return adapterSucceeded(value);
  }
}
