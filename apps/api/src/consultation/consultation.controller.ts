import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  CompleteConsultationDto,
  CancelConsultationDto,
  ConsultationListQueryDto,
  CreateConsultationDto,
  CreateConsultationQuoteDto,
  ExpectedVersionDto,
  RejectConsultationDto,
  RespondScheduleProposalDto,
  ScheduleProposalDto,
  VisitTransitionDto,
} from './consultation.dto.js';
import {
  ConsultationActionResponseDto,
  ConsultationDetailResponseDto,
  ConsultationListItemResponseDto,
  ConsultationQuoteResponseDto,
  ConsultationScheduleProposalActionResponseDto,
  ConsultationScheduleProposalDecisionResponseDto,
  ConsultationVisitActionResponseDto,
  ConsultationVisitResponseDto,
} from './consultation-response.dto.js';
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
  @ApiCreatedResponse({ type: ConsultationQuoteResponseDto, description: 'Quote dan snapshot harga/alamat yang dihitung server.' })
  quote(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateConsultationQuoteDto,
  ) {
    return this.service.createQuote(principal, key, input);
  }

  @Post('consultations')
  @RequireRoles('farmer')
  @ApiCreatedResponse({ type: ConsultationActionResponseDto, description: 'Booking tersimpan dengan status awal awaiting_payment; hasil idempoten memuat proyeksi Consultation terbaru.' })
  create(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateConsultationDto,
  ) {
    return this.service.create(principal, key, input);
  }

  @Get('consultations')
  @ApiQuery({ name: 'status', required: false, enum: ['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress', 'completed', 'rejected', 'cancelled'] })
  @ApiOkResponse({ type: [ConsultationListItemResponseDto], description: 'Daftar owner/assignment-scoped, terbaru lebih dulu; Dokter tidak menerima awaiting_payment.' })
  list(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Query() query: ConsultationListQueryDto) {
    return this.service.list(principal, query);
  }

  @Get('consultations/:consultationId')
  @ApiOkResponse({ type: ConsultationDetailResponseDto, description: 'Detail milik Peternak atau layanan yang ditugaskan ke Dokter aktif.' })
  get(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.service.get(principal, id);
  }

  @Get('consultations/:consultationId/visit')
  @ApiOkResponse({ type: ConsultationVisitResponseDto, description: 'Tahap dan waktu Visit untuk peserta layanan; urutan transisi dijaga server.' })
  visit(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.service.visit(principal, id);
  }

  @Post('consultations/:consultationId/accept')
  @RequireRoles('vet')
  @HttpCode(200)
  @ApiOkResponse({ type: ConsultationActionResponseDto, description: 'Menerima request hanya setelah pemeriksaan Dokter assigned terverifikasi dan syarat layanan terpenuhi.' })
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
  @ApiOkResponse({ type: ConsultationActionResponseDto, description: 'Penolakan tersimpan bersama rejectionReason dan refundStatus bila pembayaran sudah sukses.' })
  reject(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RejectConsultationDto,
  ) {
    return this.service.reject(principal, id, key, input);
  }

  @Post('consultations/:consultationId/cancel')
  @RequireRoles('farmer')
  @HttpCode(200)
  @ApiOkResponse({ type: ConsultationActionResponseDto, description: 'Peternak membatalkan layanan sebelum dimulai; pembayaran sukses hanya ditandai refund_needed dan tidak ditransfer.' })
  cancel(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CancelConsultationDto,
  ) {
    return this.service.cancel(principal, id, key, input);
  }

  @Post('consultations/:consultationId/schedule-proposals')
  @RequireRoles('vet')
  @HttpCode(200)
  @ApiOkResponse({ type: ConsultationScheduleProposalActionResponseDto, description: 'Mengembalikan proposal tersimpan dan Consultation terbaru.' })
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
  @ApiOkResponse({ type: ConsultationScheduleProposalDecisionResponseDto, description: 'Mengembalikan keputusan yang tersimpan dan Consultation terbaru.' })
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
  @ApiOkResponse({ type: ConsultationActionResponseDto, description: 'Memulai chat terjadwal setelah pembayaran cocok dan Dokter assigned masih terverifikasi.' })
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
  @ApiOkResponse({ type: ConsultationVisitActionResponseDto, description: 'Mengubah Visit hanya dari scheduled ke en_route.' })
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
  @ApiOkResponse({ type: ConsultationVisitActionResponseDto, description: 'Mengubah Visit hanya dari en_route ke arrived.' })
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
  @ApiOkResponse({ type: ConsultationVisitActionResponseDto, description: 'Mengubah Visit hanya dari arrived ke examining dan memulai Consultation.' })
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
  @ApiOkResponse({ type: ConsultationActionResponseDto, description: 'Mengembalikan Consultation selesai hanya setelah note final, status layanan, pembayaran, konfirmasi, dan Visit examining bila berlaku tersimpan.' })
  complete(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CompleteConsultationDto,
  ) {
    return this.service.complete(principal, id, key, input);
  }
}
