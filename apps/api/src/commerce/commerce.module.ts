import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommerceController } from './commerce.controller.js';
import { CommerceService } from './commerce.service.js';
import { ORDER_PAYMENT_SUCCEEDED } from './order-payment.port.js';
import { CHECKOUT_SHIPPING_ADAPTER, LocalCheckoutShippingAdapter } from './shipping-quote.adapter.js';

@Module({
  imports: [AuthModule],
  controllers: [CommerceController],
  providers: [
    CommerceService,
    { provide: CHECKOUT_SHIPPING_ADAPTER, useClass: LocalCheckoutShippingAdapter },
    { provide: ORDER_PAYMENT_SUCCEEDED, useExisting: CommerceService },
  ],
  exports: [CommerceService, ORDER_PAYMENT_SUCCEEDED],
})
export class CommerceModule {}
