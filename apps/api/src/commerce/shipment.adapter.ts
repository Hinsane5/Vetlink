import { Injectable } from '@nestjs/common';
import type { AdapterResult } from '../communication/adapter-result.js';

export const SHIPMENT_ADAPTER = Symbol('SHIPMENT_ADAPTER');

export type SuccessfulShipmentStatus = 'processing' | 'shipped' | 'delivered';

export interface ShipmentAdapterInput {
  orderId: string;
  shipmentId: string;
}

export interface ShipmentAdapterValue {
  eventId: string;
  status: SuccessfulShipmentStatus;
  trackingCode: string;
  description: string;
}

export interface ShipmentAdapter {
  start(input: ShipmentAdapterInput): Promise<AdapterResult<ShipmentAdapterValue>>;
}

/** Fictional local adapter; it never contacts a courier or claims a delivery. */
@Injectable()
export class LocalShipmentAdapter implements ShipmentAdapter {
  async start(input: ShipmentAdapterInput): Promise<AdapterResult<ShipmentAdapterValue>> {
    const trackingCode = `LOCAL-${input.orderId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    return {
      operationId: input.shipmentId,
      status: 'succeeded',
      occurredAt: new Date().toISOString(),
      value: {
        eventId: `${input.shipmentId}:processing`,
        status: 'processing',
        trackingCode,
        description: 'Pesanan fiktif sedang diproses untuk pengiriman lokal.',
      },
    };
  }
}
