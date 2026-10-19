import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  CompleteConsultationDto,
  ConsultationListQueryDto,
  CreateConsultationDto,
  CreateConsultationQuoteDto,
  ExpectedVersionDto,
  RejectConsultationDto,
  RespondScheduleProposalDto,
  ScheduleProposalDto,
  VisitTransitionDto,
} from './consultation.dto.js';
import { ConsultationService } from './consultation.service.js';

@ApiTags('Consultations')
@ApiBearerAuth('bearer')
@Controller()
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class ConsultationController {
  constructor(private readonly service: ConsultationService) {}

  @Post('consultation-quotes')
  @RequireRoles('farmer')
  quote(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateConsultationQuoteDto,
  ) {
    return this.service.createQuote(principal, key, input);
  }

  @Post('consultations')
  @RequireRoles('farmer')
  create(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateConsultationDto,
  ) {
    return this.service.create(principal, key, input);
  }

  @Get('consultations')
  list(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Query() query: ConsultationListQueryDto) {
    return this.service.list(principal, query);
  }

  @Get('consultations/:consultationId')
  get(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.service.get(principal, id);
  }

  @Get('consultations/:consultationId/visit')
  visit(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.service.visit(principal, id);
  }

  @Post('consultations/:consultationId/accept')
  @RequireRoles('vet')
  @HttpCode(200)
  accept(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ExpectedVersionDto,
  ) {
    return this.service.accept(principal, id, key, input);
  }

  @Post('consultations/:consultationId/reject')
  @RequireRoles('vet')
  @HttpCode(200)
  reject(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RejectConsultationDto,
  ) {
    return this.service.reject(principal, id, key, input);
  }

  @Post('consultations/:consultationId/schedule-proposals')
  @RequireRoles('vet')
  @HttpCode(200)
  proposeSchedule(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ScheduleProposalDto,
  ) {
    return this.service.proposeSchedule(principal, id, key, input);
  }

  @Post('consultations/:consultationId/schedule-proposals/:proposalId/respond')
  @RequireRoles('farmer')
  @HttpCode(200)
  respondScheduleProposal(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RespondScheduleProposalDto,
  ) {
    return this.service.respondScheduleProposal(principal, consultationId, proposalId, key, input);
  }

  @Post('consultations/:consultationId/start')
  @RequireRoles('vet')
  @HttpCode(200)
  startChat(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ExpectedVersionDto,
  ) {
    return this.service.startChat(principal, id, key, input);
  }

  @Post('consultations/:consultationId/visit/depart')
  @RequireRoles('vet')
  @HttpCode(200)
  depart(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: VisitTransitionDto,
  ) {
    return this.service.advanceVisit(principal, id, 'depart', key, input);
  }

  @Post('consultations/:consultationId/visit/arrive')
  @RequireRoles('vet')
  @HttpCode(200)
  arrive(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: VisitTransitionDto,
  ) {
    return this.service.advanceVisit(principal, id, 'arrive', key, input);
  }

  @Post('consultations/:consultationId/visit/start-examination')
  @RequireRoles('vet')
  @HttpCode(200)
  startExamination(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: VisitTransitionDto,
  ) {
    return this.service.advanceVisit(principal, id, 'start-examination', key, input);
  }

  @Post('consultations/:consultationId/complete')
  @RequireRoles('vet')
  @HttpCode(200)
  complete(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CompleteConsultationDto,
  ) {
    return this.service.complete(principal, id, key, input);
  }
}
