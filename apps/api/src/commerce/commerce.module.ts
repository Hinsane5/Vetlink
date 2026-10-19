import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommerceController } from './commerce.controller.js';
import { CommerceService } from './commerce.service.js';
import { ORDER_PAYMENT_SUCCEEDED } from './order-payment.port.js';
import { ORDER_SHIPMENT_START } from './order-shipment.port.js';
import { CHECKOUT_SHIPPING_ADAPTER, LocalCheckoutShippingAdapter } from './shipping-quote.adapter.js';
import { LocalShipmentAdapter, SHIPMENT_ADAPTER } from './shipment.adapter.js';
import { ShipmentService } from './shipment.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CommerceController],
  providers: [
    CommerceService,
    ShipmentService,
    { provide: CHECKOUT_SHIPPING_ADAPTER, useClass: LocalCheckoutShippingAdapter },
    { provide: SHIPMENT_ADAPTER, useClass: LocalShipmentAdapter },
    { provide: ORDER_PAYMENT_SUCCEEDED, useExisting: CommerceService },
    { provide: ORDER_SHIPMENT_START, useExisting: ShipmentService },
  ],
  exports: [CommerceService, ORDER_PAYMENT_SUCCEEDED, ORDER_SHIPMENT_START],
})
export class CommerceModule {}
