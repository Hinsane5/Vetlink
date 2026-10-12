import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');

export interface AdapterFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type AdapterOperationResult =
  | { operationId: string; status: 'pending' | 'succeeded'; occurredAt: string }
  | { operationId: string; status: 'failed'; occurredAt: string; error: AdapterFailure };

export interface PasswordResetDeliveryAdapter {
  deliver(email: string, resetToken: string): Promise<AdapterOperationResult>;
}

@Injectable()
export class UnconfiguredPasswordResetDeliveryAdapter implements PasswordResetDeliveryAdapter {
  async deliver(_email: string, _resetToken: string): Promise<AdapterOperationResult> {
    return {
      operationId: randomUUID(),
      status: 'failed',
      occurredAt: new Date().toISOString(),
      error: {
        code: 'RESET_DELIVERY_NOT_CONFIGURED',
        message: 'Password reset delivery is not configured',
        retryable: false,
      },
    };
  }
}
