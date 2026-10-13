import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import type { Response } from 'express';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { AttachmentResponseDto, UploadAttachmentDto } from './communication.dto.js';
import { CommunicationService, type IncomingMediaFile } from './communication.service.js';

const MAX_MULTIPART_BYTES = 100 * 1024 * 1024;

@ApiTags('Media')
@ApiBearerAuth('bearer')
@Controller('attachments')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class MediaController {
  constructor(private readonly communication: CommunicationService) {}

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_MULTIPART_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 128 },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['consultationId', 'file'],
      properties: {
        consultationId: { type: 'string', format: 'uuid' },
        file: { type: 'string', format: 'binary' },
      },
      additionalProperties: false,
    },
  })
  @ApiCreatedResponse({ type: AttachmentResponseDto, description: 'Media disimpan privat sebagai uploaded; commit sebelum dapat dipasang pada pesan.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  upload(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: UploadAttachmentDto,
    @UploadedFile() file: IncomingMediaFile | undefined,
  ): Promise<AttachmentResponseDto> {
    return this.communication.uploadAttachment(principal, input, idempotencyKey, file);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AttachmentResponseDto, description: 'Commit idempotent hanya untuk file milik actor dan layanan terkait.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  commit(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) attachmentId: string,
  ): Promise<AttachmentResponseDto> {
    return this.communication.commitAttachment(principal, attachmentId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AttachmentResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  attachment(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) attachmentId: string,
  ): Promise<AttachmentResponseDto> {
    return this.communication.attachmentMetadata(principal, attachmentId);
  }

  @Get(':id/content')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Berkas media privat; scope diperiksa ulang untuk setiap unduhan.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  async content(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('id', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const opened = await this.communication.openAttachment(principal, attachmentId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const disposition = `inline; filename*=UTF-8''${encodeURIComponent(opened.row.filename)}`;
      return new StreamableFile(opened.media.stream, {
        type: opened.row.mime_type,
        length: opened.media.byteSize,
        disposition,
      });
    } catch {
      opened.media.stream.destroy();
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Berkas media tidak dapat dibaca.' });
    }
  }
}
