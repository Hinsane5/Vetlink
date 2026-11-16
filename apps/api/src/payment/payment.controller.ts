import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import {
  CreatePaymentDto,
  PaymentAttemptListResponseDto,
  PaymentLookupQueryDto,
  PaymentResponseDto,
  PaymentStatusResponseDto,
} from './payment.dto.js';
import { PaymentsService } from './payment.service.js';

@ApiTags('Payments')
@ApiBearerAuth('bearer')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer')
@Controller()
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get('payment-quotes/:payableType/:payableId')
  @ApiOkResponse({ description: 'Quote amount integer IDR dari snapshot server.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  quote(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('payableType') type: string,
    @Param('payableId', ParseUUIDPipe) id: string,
  ) {
    if (type !== 'consultation' && type !== 'order') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Jenis kewajiban pembayaran tidak valid.' });
    }
    return this.service.quote(principal, type, id);
  }

  @Get('payments')
  @ApiQuery({ name: 'payableType', enum: ['consultation', 'order'], required: true })
  @ApiQuery({ name: 'payableId', type: String, format: 'uuid', required: true })
  @ApiOkResponse({ type: PaymentStatusResponseDto, description: 'Payment dan status Attempt untuk payable milik sesi Peternak.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Payment belum ada atau payable bukan milik akun.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  getForPayable(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Query() query: PaymentLookupQueryDto,
  ): Promise<PaymentStatusResponseDto> {
    return this.service.getForPayable(principal, query.payableType, query.payableId);
  }

  @Get('payments/:id/attempts')
  @ApiOkResponse({ type: PaymentAttemptListResponseDto, description: 'Riwayat Attempt tersimpan secara urut untuk Payment milik Peternak.' })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  getAttempts(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentAttemptListResponseDto> {
    return this.service.getAttempts(principal, id);
  }

  @Get('payments/:id')
  @ApiOkResponse({ type: PaymentStatusResponseDto, description: 'Status Payment dan Attempt berdasarkan ID yang tersimpan.' })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  getById(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentStatusResponseDto> {
    return this.service.getById(principal, id);
  }

  @Post('payments')
  @ApiCreatedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  create(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string,
    @Body() body: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.service.create(principal, key, body);
  }
}
