import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { adapterFailed, type AdapterResult } from '../communication/adapter-result.js';
import { DatabaseService } from '../database/database.service.js';
import { SHIPMENT_ADAPTER, type ShipmentAdapter, type ShipmentAdapterValue, type SuccessfulShipmentStatus } from './shipment.adapter.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type OrderStatus = 'awaiting_payment' | 'paid' | 'processing' | 'shipped' | 'delivered';
type ShipmentOutcome = 'pending' | 'succeeded' | 'failed';

interface ShipmentRow {
  id: string;
  order_id: string;
  status: string;
}

interface ShipmentWithOrderRow extends ShipmentRow {
  farmer_id: string;
  order_status: OrderStatus;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeResult(result: AdapterResult<ShipmentAdapterValue>) {
  if (!result || !uuidPattern.test(result.operationId) || !Number.isFinite(Date.parse(result.occurredAt))
    || !['pending', 'succeeded', 'failed'].includes(result.status)) {
    throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Adapter pengiriman mengembalikan hasil tidak valid.' });
  }
  if (result.status === 'failed') {
    if (!result.error || typeof result.error.code !== 'string' || result.error.code.trim().length < 1
      || result.error.code.length > 80 || typeof result.error.message !== 'string'
      || result.error.message.trim().length < 1 || result.error.message.length > 500) {
      throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Adapter pengiriman mengembalikan detail kegagalan tidak valid.' });
    }
    const eventId = `operation:${result.operationId}`;
    return {
      operationId: result.operationId,
      eventId,
      outcome: 'failed' as const,
      occurredAt: new Date(result.occurredAt),
      shipmentStatus: null,
      trackingCode: null,
      description: result.error.message,
      errorCode: result.error.code,
      payloadFingerprint: fingerprint({ outcome: result.status, error: result.error }),
    };
  }
  const { value } = result;
  if (!value || typeof value.eventId !== 'string' || value.eventId.length < 1 || value.eventId.length > 128
    || typeof value.description !== 'string' || value.description.trim().length < 1 || value.description.length > 500
    || typeof value.trackingCode !== 'string' || value.trackingCode.trim().length < 1 || value.trackingCode.length > 80) {
    throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Adapter pengiriman mengembalikan data yang tidak valid.' });
  }
  if (result.status === 'succeeded' && !['processing', 'shipped', 'delivered'].includes(value.status)) {
    throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Adapter pengiriman mengembalikan status yang tidak valid.' });
  }
  return {
    operationId: result.operationId,
    eventId: value.eventId,
    outcome: result.status,
    occurredAt: new Date(result.occurredAt),
    shipmentStatus: result.status === 'succeeded' ? value.status : null,
    trackingCode: value.trackingCode.trim(),
    description: value.description.trim(),
    errorCode: null,
    payloadFingerprint: fingerprint({ outcome: result.status, value }),
  };
}

function nextOrderStatus(from: OrderStatus, shipmentStatus: SuccessfulShipmentStatus): Exclude<OrderStatus, 'awaiting_payment'> {
  const expected: Partial<Record<OrderStatus, SuccessfulShipmentStatus>> = {
    paid: 'processing',
    processing: 'shipped',
    shipped: 'delivered',
  };
  if (expected[from] !== shipmentStatus) {
    throw new ConflictException({ code: 'CONFLICT', message: 'Status pengiriman harus bergerak satu tahap dari status pesanan saat ini.' });
  }
  return shipmentStatus;
}

@Injectable()
export class ShipmentService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(SHIPMENT_ADAPTER) private readonly adapter: ShipmentAdapter,
  ) {}

  /** Starts the fictional adapter only for an order whose succeeded payment was committed. */
  async ensureStarted(orderId: string, farmerId: string): Promise<void> {
    const start = await this.db.transaction(async (client) => {
      const orderResult = await client.query<{ order_id: string; farmer_id: string; order_status: OrderStatus }>(
        `SELECT id AS order_id,farmer_id,status AS order_status
         FROM orders WHERE id=$1 AND farmer_id=$2 FOR UPDATE`, [orderId, farmerId],
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pesanan tidak ditemukan.' });
      if (order.order_status !== 'paid') return null;

      const existing = await client.query<ShipmentWithOrderRow>(
        `SELECT s.id,s.order_id,o.farmer_id,s.status,o.status AS order_status
         FROM shipments s JOIN orders o ON o.id=s.order_id
         WHERE s.order_id=$1 FOR UPDATE OF s`, [orderId],
      );
      const shipment = existing.rows[0];
      if (shipment && !['pending', 'failed'].includes(shipment.status)) return null;
      if (shipment) return shipment;

      const id = randomUUID();
      const inserted = await client.query<ShipmentRow>(
        `INSERT INTO shipments(id,order_id,status) VALUES($1,$2,'pending')
         RETURNING id,order_id,status`, [id, orderId],
      );
      return { ...inserted.rows[0], farmer_id: farmerId, order_status: order.order_status };
    });
    if (!start) return;

    let result: AdapterResult<ShipmentAdapterValue>;
    try {
      result = await this.adapter.start({ orderId: start.order_id, shipmentId: start.id });
    } catch {
      result = adapterFailed('SHIPMENT_ADAPTER_UNAVAILABLE', 'Adapter pengiriman lokal belum menyelesaikan hasil.', true);
    }
    await this.recordAdapterResult(start.order_id, start.id, result);
  }

  /** Internal adapter-event ingestion; intentionally not exposed as a public HTTP callback. */
  async recordAdapterResult(
    orderId: string,
    shipmentId: string,
    result: AdapterResult<ShipmentAdapterValue>,
  ): Promise<{ duplicate: boolean; orderStatus: OrderStatus; shipmentStatus: string | null }> {
    const normalized = normalizeResult(result);
    return this.db.transaction(async (client) => {
      const current = await client.query<{ order_status: OrderStatus; shipment_status: string }>(
        `SELECT o.status AS order_status,s.status AS shipment_status
         FROM orders o JOIN shipments s ON s.order_id=o.id
         WHERE o.id=$1 AND s.id=$2 FOR UPDATE OF o,s`, [orderId, shipmentId],
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pesanan atau pengiriman tidak ditemukan.' });

      const prior = await client.query<{
        payload_fingerprint: string;
      }>(
        'SELECT payload_fingerprint FROM shipment_events WHERE shipment_id=$1 AND event_id=$2',
        [shipmentId, normalized.eventId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].payload_fingerprint !== normalized.payloadFingerprint) {
          throw new ConflictException({ code: 'CONFLICT', message: 'Event adapter telah digunakan dengan hasil berbeda.' });
        }
        return { duplicate: true, orderStatus: row.order_status, shipmentStatus: row.shipment_status };
      }

      if (row.order_status === 'awaiting_payment') {
        throw new ConflictException({ code: 'CONFLICT', message: 'Pengiriman hanya dapat diproses setelah pembayaran berhasil tersimpan.' });
      }

      let nextStatus = row.order_status;
      if (normalized.outcome === 'succeeded') {
        nextStatus = nextOrderStatus(row.order_status, normalized.shipmentStatus as SuccessfulShipmentStatus);
      }

      await client.query(
        `INSERT INTO shipment_events
           (id,shipment_id,event_id,adapter_operation_id,outcome,shipment_status,from_order_status,to_order_status,
            tracking_code,description,error_code,payload_fingerprint,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [randomUUID(), shipmentId, normalized.eventId, normalized.operationId, normalized.outcome,
          normalized.shipmentStatus, normalized.outcome === 'succeeded' ? row.order_status : null,
          normalized.outcome === 'succeeded' ? nextStatus : null,
          normalized.trackingCode, normalized.description, normalized.errorCode,
          normalized.payloadFingerprint, normalized.occurredAt],
      );

      if (normalized.outcome === 'succeeded') {
        await client.query(
          `UPDATE orders SET status=$2,updated_at=now(),version=version+1 WHERE id=$1`, [orderId, nextStatus],
        );
        await client.query(
          `UPDATE shipments SET status=$2,tracking_code=$3,updated_at=now(),version=version+1 WHERE id=$1`,
          [shipmentId, normalized.shipmentStatus, normalized.trackingCode],
        );
      } else if (normalized.outcome === 'failed' && row.order_status === 'paid') {
        await client.query(
          `UPDATE shipments SET status='failed',updated_at=now(),version=version+1 WHERE id=$1 AND status IN ('pending','failed')`,
          [shipmentId],
        );
      } else if (normalized.trackingCode) {
        await client.query(
          `UPDATE shipments SET tracking_code=COALESCE(tracking_code,$2),updated_at=now() WHERE id=$1`,
          [shipmentId, normalized.trackingCode],
        );
      }
      const shipmentStatus = normalized.outcome === 'failed' && row.order_status === 'paid' ? 'failed'
        : normalized.outcome === 'succeeded' ? normalized.shipmentStatus : row.shipment_status;
      return { duplicate: false, orderStatus: nextStatus, shipmentStatus };
    });
  }

  async getForOwner(farmerId: string, orderId: string) {
    return this.db.transaction(async (client) => {
      const orderResult = await client.query<{
        id: string; status: OrderStatus; created_at: Date; paid_at: Date | null; payment_id: string | null;
      }>(
        `SELECT id,status,created_at,paid_at,payment_id FROM orders WHERE id=$1 AND farmer_id=$2 FOR SHARE`, [orderId, farmerId],
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pesanan tidak ditemukan.' });
      const shipmentResult = await client.query<{
        id: string; status: string; tracking_code: string | null; version: number;
      }>(
        'SELECT id,status,tracking_code,version FROM shipments WHERE order_id=$1', [orderId],
      );
      const shipment = shipmentResult.rows[0] ?? null;
      const shipmentEvents = shipment ? await client.query<{
        id: string; event_id: string; outcome: ShipmentOutcome; shipment_status: string | null;
        to_order_status: OrderStatus | null; tracking_code: string | null; description: string;
        occurred_at: Date; created_at: Date;
      }>(
        `SELECT id,event_id,outcome,shipment_status,to_order_status,tracking_code,description,occurred_at,created_at
         FROM shipment_events WHERE shipment_id=$1 ORDER BY created_at,id`, [shipment.id],
      ) : { rows: [] };

      const events = [
        {
          id: `order:${order.id}:created`, eventId: null, type: 'order_created' as const, outcome: 'succeeded' as const,
          orderStatus: 'awaiting_payment' as const, shipmentStatus: null, trackingCode: null,
          description: 'Pesanan dibuat dan menunggu pembayaran.', occurredAt: order.created_at,
        },
        ...(order.paid_at ? [{
          id: `payment:${order.payment_id}:succeeded`, eventId: null, type: 'payment_succeeded' as const,
          outcome: 'succeeded' as const, orderStatus: 'paid' as const, shipmentStatus: null, trackingCode: null,
          description: 'Pembayaran berhasil tersimpan.', occurredAt: order.paid_at,
        }] : []),
        ...shipmentEvents.rows.map((event) => ({
          id: event.id, eventId: event.event_id, type: 'shipment_adapter' as const, outcome: event.outcome,
          orderStatus: event.to_order_status, shipmentStatus: event.shipment_status,
          trackingCode: event.tracking_code, description: event.description,
          occurredAt: event.occurred_at,
        })),
      ];

      return {
        orderId: order.id,
        orderStatus: order.status,
        shipment: shipment ? {
          id: shipment.id,
          status: shipment.status,
          trackingCode: shipment.tracking_code,
          version: shipment.version,
        } : null,
        events: events.map((event) => ({ ...event, occurredAt: new Date(event.occurredAt).toISOString() })),
      };
    });
  }
}
