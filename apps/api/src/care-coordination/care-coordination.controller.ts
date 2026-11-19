import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  CareCompletionResponseDto,
  CompleteCareDto,
  CreateFollowUpDto,
  CreateProgressReportDto,
  CreateReminderDto,
  FollowUpListResponseDto,
  FollowUpResponseDto,
  ProgressReportListResponseDto,
  ProgressReportResponseDto,
  ReminderListResponseDto,
  ReminderResponseDto,
  UpdateFollowUpDto,
  UpdateReminderDto,
} from './care-coordination.dto.js';
import { CareCoordinationService } from './care-coordination.service.js';

@ApiTags('Tindak lanjut, laporan perkembangan, dan pengingat')
@ApiBearerAuth('bearer')
@Controller()
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class CareCoordinationController {
  constructor(private readonly service: CareCoordinationService) {}

  @Get('consultations/:consultationId/follow-ups')
  @ApiOkResponse({ type: FollowUpListResponseDto })
  listFollowUps(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) consultationId: string) {
    return this.service.listFollowUps(principal, consultationId);
  }

  @Get('follow-ups/:followUpId')
  @ApiOkResponse({ type: FollowUpResponseDto })
  getFollowUp(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('followUpId', ParseUUIDPipe) followUpId: string) {
    return this.service.getFollowUp(principal, followUpId);
  }

  @Post('consultations/:consultationId/follow-ups')
  @RequireRoles('vet')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Retry memakai key dan payload yang sama.' })
  @ApiCreatedResponse({ type: FollowUpResponseDto })
  createFollowUp(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateFollowUpDto,
  ) {
    return this.service.createFollowUp(principal, consultationId, key, input);
  }

  @Patch('follow-ups/:followUpId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: FollowUpResponseDto })
  updateFollowUp(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('followUpId', ParseUUIDPipe) followUpId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: UpdateFollowUpDto,
  ) {
    return this.service.updateFollowUp(principal, followUpId, key, input);
  }

  @Get('follow-ups/:followUpId/progress-reports')
  @ApiOkResponse({ type: ProgressReportListResponseDto })
  listProgressReports(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('followUpId', ParseUUIDPipe) followUpId: string) {
    return this.service.listProgressReports(principal, followUpId);
  }

  @Get('progress-reports/:reportId')
  @ApiOkResponse({ type: ProgressReportResponseDto })
  getProgressReport(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.service.getProgressReport(principal, reportId);
  }

  @Post('follow-ups/:followUpId/progress-reports')
  @RequireRoles('farmer')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ProgressReportResponseDto })
  createProgressReport(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('followUpId', ParseUUIDPipe) followUpId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateProgressReportDto,
  ) {
    return this.service.createProgressReport(principal, followUpId, key, input);
  }

  @Get('reminders')
  @ApiOkResponse({ type: ReminderListResponseDto })
  listReminders(@AuthenticatedUser() principal: AuthenticatedPrincipal) {
    return this.service.listReminders(principal);
  }

  @Get('reminders/:reminderId')
  @ApiOkResponse({ type: ReminderResponseDto })
  getReminder(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('reminderId', ParseUUIDPipe) reminderId: string) {
    return this.service.getReminder(principal, reminderId);
  }

  @Post('reminders')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ReminderResponseDto })
  createReminder(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateReminderDto,
  ) {
    return this.service.createReminder(principal, key, input);
  }

  @Patch('reminders/:reminderId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ReminderResponseDto, description: 'Mencoba ulang delivery adapter untuk reminder yang gagal.' })
  retryReminderDelivery(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('reminderId', ParseUUIDPipe) reminderId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: UpdateReminderDto,
  ) {
    return this.service.retryReminderDelivery(principal, reminderId, key, input);
  }

  @Post('reminders/:reminderId/complete')
  @RequireRoles('farmer')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: CareCompletionResponseDto, description: 'Mencatat care done dan satu HealthEvent; deliveryStatus tetap terpisah.' })
  completeCare(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('reminderId', ParseUUIDPipe) reminderId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CompleteCareDto,
  ) {
    return this.service.completeCare(principal, reminderId, key, input);
  }
}
