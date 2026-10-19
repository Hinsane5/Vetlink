import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { CreatePaymentDto } from './payment.dto.js';
import { PaymentsService } from './payment.service.js';

@ApiTags('Payments') @ApiBearerAuth('bearer') @UseGuards(AccessTokenGuard,RoleGuard) @RequireRoles('farmer') @Controller()
export class PaymentsController {
 constructor(private readonly service:PaymentsService){}
 @Get('payment-quotes/:payableType/:payableId') quote(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('payableType') type:string,@Param('payableId',ParseUUIDPipe) id:string){if(type!=='consultation'&&type!=='order')throw new BadRequestException({code:'VALIDATION_ERROR',message:'Jenis kewajiban pembayaran tidak valid.'});return this.service.quote(p,type,id);}
 @Post('payments') create(@AuthenticatedUser() p:AuthenticatedPrincipal,@Headers('idempotency-key') key:string,@Body() body:CreatePaymentDto){return this.service.create(p,key,body);}
}
