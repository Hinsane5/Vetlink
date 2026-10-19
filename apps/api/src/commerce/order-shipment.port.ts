export const ORDER_SHIPMENT_START = Symbol('ORDER_SHIPMENT_START');

export interface OrderShipmentStartPort {
  ensureStarted(orderId: string, farmerId: string): Promise<void>;
}
