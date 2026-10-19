import type { CommerceRepository } from '../../../application/ports/CommerceRepository';
import type { ShipmentStatusProvider, ShipmentStatusSnapshot } from '../../../application/ports/ShipmentStatusProvider';
import type { ShipmentEventSnapshot } from '../../../domain/commerce';
import { DomainError } from '../../../domain/errors';

const statuses = new Set(['processing', 'shipped', 'delivered', 'failed']);

/** Reads only persisted shipment rows; it never advances delivery state itself. */
export class LocalShipmentStatusAdapter implements ShipmentStatusProvider {
  constructor(private readonly storage: CommerceRepository) {}

  async getForOrder(ownerId: string, orderId: string): Promise<ShipmentStatusSnapshot | null> {
    const order = await this.storage.read.findById('order', orderId);
    if (!order || order.ownerId !== ownerId || order.payload.farmerId !== ownerId) {
      throw new DomainError('NOT_FOUND', 'Pesanan tidak ditemukan.');
    }
    const records = await this.storage.read.listByOwner('shipment', ownerId);
    const shipment = records.find((item) => item.payload.orderId === orderId);
    if (!shipment) return null;
    const status = shipment.payload.status;
    if (typeof status !== 'string' || !statuses.has(status)) {
      throw new DomainError('INVALID_STATE', 'Status pengiriman belum dapat dibaca.');
    }
    const rawEvents = shipment.payload.events;
    const events: ShipmentEventSnapshot[] = Array.isArray(rawEvents) ? rawEvents.flatMap((event) => {
      if (!event || typeof event !== 'object') return [];
      const value = event as Record<string, unknown>;
      if (typeof value.status !== 'string' || typeof value.time !== 'string' || typeof value.description !== 'string') return [];
      return [{ status: value.status, time: value.time, description: value.description }];
    }) : [];
    return {
      status: status as ShipmentStatusSnapshot['status'],
      trackingCode: typeof shipment.payload.trackingCode === 'string' ? shipment.payload.trackingCode : null,
      events,
    };
  }
}
