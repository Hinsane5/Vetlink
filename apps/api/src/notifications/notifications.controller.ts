import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { NotificationListResponseDto, NotificationReadResponseDto, PatchPreferencesDto, PreferencesResponseDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifikasi dan preferensi')
@ApiBearerAuth('bearer')
@Controller()
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('me/notifications')
  @ApiOkResponse({ type: NotificationListResponseDto, description: 'Inbox akun aktif; link konteks hanya disertakan jika dapat diakses dengan peran aktif.' })
  list(@AuthenticatedUser() principal: AuthenticatedPrincipal) {
    return this.service.list(principal);
  }

  @Post('me/notifications/:id/read')
  @HttpCode(200)
  @ApiOkResponse({ type: NotificationReadResponseDto, description: 'Read state idempoten; sebelum membuka tujuan, server memeriksa akses resource dengan peran aktif.' })
  markRead(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(principal, id);
  }

  @Get('me/preferences')
  @ApiOkResponse({ type: PreferencesResponseDto })
  getPreferences(@AuthenticatedUser() principal: AuthenticatedPrincipal) {
    return this.service.getPreferences(principal);
  }

  @Patch('me/preferences')
  @ApiOkResponse({ type: PreferencesResponseDto, description: 'Perubahan parsial kategori; inbox yang tersimpan tetap ada.' })
  patchPreferences(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Body() input: PatchPreferencesDto) {
    return this.service.patchPreferences(principal, input);
  }
}
