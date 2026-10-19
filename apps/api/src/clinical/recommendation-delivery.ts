import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type RecommendationDeliveryResult =
  | { status: 'succeeded'; operationId: string; occurredAt: string }
  | { status: 'failed'; operationId: string; occurredAt: string; error: { code: string; message: string; retryable: boolean } };

export interface RecommendationDeliveryAdapter {
  send(input: { consultationId: string; recommendationId: string; farmerId: string }): Promise<RecommendationDeliveryResult>;
}

export const RECOMMENDATION_DELIVERY_ADAPTER = Symbol('RECOMMENDATION_DELIVERY_ADAPTER');

@Injectable()
export class LocalRecommendationDeliveryAdapter implements RecommendationDeliveryAdapter {
  async send(): Promise<RecommendationDeliveryResult> {
    return { status: 'succeeded', operationId: randomUUID(), occurredAt: new Date().toISOString() };
  }
}
