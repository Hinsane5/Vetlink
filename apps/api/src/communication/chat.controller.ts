import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import {
  MessagePageQueryDto,
  MessagePageResponseDto,
  MessageResponseDto,
  SendMessageDto,
} from './communication.dto.js';
import { CommunicationService } from './communication.service.js';

@ApiTags('Chat')
@ApiBearerAuth('bearer')
@Controller('consultations/:consultationId/messages')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class ChatController {
  constructor(private readonly communication: CommunicationService) {}

  @Get()
  @ApiParam({ name: 'consultationId', format: 'uuid' })
  @ApiOkResponse({ type: MessagePageResponseDto, description: 'Pesan diurutkan lama ke baru pada setiap halaman; cursor mengambil halaman yang lebih lama.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  list(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query() query: MessagePageQueryDto,
  ): Promise<MessagePageResponseDto> {
    return this.communication.listMessages(principal, consultationId, query);
  }

  @Post()
  @ApiParam({ name: 'consultationId', format: 'uuid' })
  @ApiBody({ type: SendMessageDto })
  @ApiCreatedResponse({ type: MessageResponseDto, description: 'Pesan tersimpan; deliveryStatus menunjukkan hasil transport polling.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  send(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() input: SendMessageDto,
  ): Promise<MessageResponseDto> {
    return this.communication.sendMessage(principal, consultationId, input);
  }

  @Post(':messageId/retry')
  @HttpCode(200)
  @ApiParam({ name: 'consultationId', format: 'uuid' })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOkResponse({ type: MessageResponseDto, description: 'Mengulangi attempt untuk record yang sama; tidak membuat message baru.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  retry(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageResponseDto> {
    return this.communication.retryMessage(principal, consultationId, messageId);
  }
}
