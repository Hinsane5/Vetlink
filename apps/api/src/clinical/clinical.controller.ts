import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ClinicalNoteInputDto, ExpectedVersionDto, RecommendationInputDto } from './clinical.dto.js';
import { ClinicalService } from './clinical.service.js';

@ApiTags('Catatan klinis dan rekomendasi')
@ApiBearerAuth('bearer')
@Controller('consultations/:consultationId')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @Get('note')
  getNote(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.clinical.getNote(principal, id);
  }

  @Put('note')
  saveNote(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string, @Body() input: ClinicalNoteInputDto) {
    return this.clinical.saveNote(principal, id, input);
  }

  @Post('note/finalize')
  finalizeNote(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string, @Body() input: ExpectedVersionDto) {
    return this.clinical.finalizeNote(principal, id, input.expectedVersion);
  }

  @Get('recommendation')
  getRecommendation(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string) {
    return this.clinical.getRecommendation(principal, id);
  }

  @Put('recommendation')
  saveRecommendation(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string, @Body() input: RecommendationInputDto) {
    return this.clinical.saveRecommendation(principal, id, input);
  }

  @Post('recommendation/send')
  sendRecommendation(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('consultationId', ParseUUIDPipe) id: string, @Body() input: ExpectedVersionDto) {
    return this.clinical.sendRecommendation(principal, id, input.expectedVersion);
  }
}
