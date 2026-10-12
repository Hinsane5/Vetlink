import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse, ApiForbiddenResponse } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { AuthenticatedUser, RequireRoles } from './auth.decorators.js';
import { AccessTokenGuard, RoleGuard } from './auth.guards.js';
import { MeResponseDto } from './auth.dto.js';
import type { AuthenticatedPrincipal } from './auth.types.js';

@ApiTags('Auth')
@ApiBearerAuth('bearer')
@Controller('me')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeResponseDto, description: 'Akun aktif dan membership sesuai sesi; ID akun tidak dapat ditukar oleh client.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  getMe(@AuthenticatedUser() principal: AuthenticatedPrincipal): MeResponseDto {
    return {
      id: principal.userId,
      email: principal.email,
      fullName: principal.fullName,
      roles: principal.roles,
      activeRole: principal.activeRole,
      sessionId: principal.sessionId,
    };
  }
}
