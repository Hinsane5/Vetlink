import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  CreateWithdrawalDto,
  CreateWithdrawalResponseDto,
  EarningsQueryDto,
  EarningsResponseDto,
  EarningTransactionResponseDto,
  PayoutDestinationResponseDto,
  WithdrawalPageResponseDto,
  WithdrawalResponseDto,
  WithdrawalsQueryDto,
} from './earnings.dto.js';
import { EarningsService } from './earnings.service.js';

@ApiTags('Pendapatan dan pencairan Dokter')
@ApiBearerAuth('bearer')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('vet')
@Controller()
export class EarningsController {
  constructor(private readonly service: EarningsService) {}

  @Get('me/vet/earnings')
  @ApiOperation({ summary: 'Baca pendapatan, saldo ledger, dan riwayat Dokter sendiri.' })
  @ApiOkResponse({ type: EarningsResponseDto })
  getEarnings(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Query() query: EarningsQueryDto) {
    return this.service.earnings(principal, query);
  }

  @Get('me/vet/transactions/:id')
  @ApiOperation({ summary: 'Baca detail earning milik Dokter sendiri.' })
  @ApiOkResponse({ type: EarningTransactionResponseDto })
  getTransaction(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getTransaction(principal, id);
  }

  @Get('me/vet/payout-destinations')
  @ApiOperation({ summary: 'Baca tujuan pencairan fiktif yang tersimpan untuk Dokter sendiri.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/PayoutDestinationResponseDto' } } } } })
  getDestinations(@AuthenticatedUser() principal: AuthenticatedPrincipal) {
    return this.service.payoutDestinations(principal);
  }

  @Get('me/vet/withdrawals')
  @ApiOperation({ summary: 'Baca riwayat pencairan Dokter sendiri.' })
  @ApiOkResponse({ type: WithdrawalPageResponseDto })
  getWithdrawals(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Query() query: WithdrawalsQueryDto) {
    return this.service.withdrawals(principal, query);
  }

  @Post('me/vet/withdrawals')
  @ApiOperation({ summary: 'Ajukan pencairan integer rupiah dengan reservasi ledger dan adapter lokal.' })
  @ApiCreatedResponse({ type: CreateWithdrawalResponseDto, description: 'Adapter lokal menerima permintaan; saldo tetap reserved sampai hasil payout internal.' })
  @ApiAcceptedResponse({ type: CreateWithdrawalResponseDto, description: 'Adapter masih pending; status pengajuan tetap submitting dan saldo sudah direservasi.' })
  async createWithdrawal(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateWithdrawalDto,
    @Res({ passthrough: true }) response: ExpressResponse,
  ) {
    const result = await this.service.createWithdrawal(principal, key, input);
    response.status(result.adapterOutcome === 'pending' ? 202 : 201);
    return result;
  }

  @Get('me/vet/withdrawals/:id')
  @ApiOperation({ summary: 'Baca detail pencairan milik Dokter sendiri.' })
  @ApiOkResponse({ type: WithdrawalResponseDto })
  getWithdrawal(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getWithdrawal(principal, id);
  }
}
