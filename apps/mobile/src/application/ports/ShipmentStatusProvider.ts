import type { ShipmentEventSnapshot } from '../../domain/commerce';

export interface ShipmentStatusSnapshot {
  status: 'processing' | 'shipped' | 'delivered' | 'failed';
  trackingCode: string | null;
  events: ShipmentEventSnapshot[];
}

/** Read-only boundary for delivery status from persisted local or remote shipment records. */
export interface ShipmentStatusProvider {
  getForOrder(ownerId: string, orderId: string): Promise<ShipmentStatusSnapshot | null>;
}
