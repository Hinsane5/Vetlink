import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { CreateReviewDto, ReviewListQueryDto, ReviewPageResponseDto, ReviewResponseDto } from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('Ulasan')
@ApiBearerAuth('bearer')
@Controller()
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('consultations/:consultationId/review')
  @RequireRoles('farmer')
  @ApiCreatedResponse({ type: ReviewResponseDto, description: 'Ulasan immutable tersimpan; pengiriman ulang dengan isi sama mengembalikan record yang sama.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  create(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() input: CreateReviewDto,
  ) {
    return this.reviews.create(principal, consultationId, input);
  }

  @Get('vets/:id/reviews')
  @ApiOkResponse({ type: ReviewPageResponseDto, description: 'Ulasan dari konsultasi selesai yang relasi pemilik dan Dokternya valid.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  list(@Param('id', ParseUUIDPipe) vetId: string, @Query() query: ReviewListQueryDto) {
    return this.reviews.listForVet(vetId, query);
  }
}
