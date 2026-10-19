import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsController } from './payment.controller.js';
import { PAYMENT_SERVICE, LocalPaymentService } from './payment.adapter.js';
import { PaymentsService } from './payment.service.js';
@Module({imports:[AuthModule],controllers:[PaymentsController],providers:[PaymentsService,{provide:PAYMENT_SERVICE,useClass:LocalPaymentService}]})
export class PaymentModule {}
