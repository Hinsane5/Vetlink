import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTooManyRequestsResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import {
  AuthSessionResponseDto,
  LoginRequestDto,
  PasswordResetAcceptedResponseDto,
  PasswordResetConfirmationRequestDto,
  PasswordResetRequestDto,
  RefreshTokenRequestDto,
  RegisterRequestDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: AuthSessionResponseDto, description: 'Akun, membership, dan sesi dibuat secara atomik.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Email sudah digunakan.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
  register(@Body() body: RegisterRequestDto): Promise<AuthSessionResponseDto> {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
  login(@Body() body: LoginRequestDto): Promise<AuthSessionResponseDto> {
    return this.auth.login(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Sesi yang ditunjuk dicabut. Pengulangan logout tetap aman.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  async logout(@Body() body: RefreshTokenRequestDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionResponseDto, description: 'Refresh token dirotasi; credential sebelumnya tidak dapat dipakai kembali.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorResponseDto })
  refresh(@Body() body: RefreshTokenRequestDto): Promise<AuthSessionResponseDto> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    type: PasswordResetAcceptedResponseDto,
    description: 'Response sama apakah email terdaftar atau tidak. Token reset tidak dikembalikan.',
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  requestPasswordReset(@Body() body: PasswordResetRequestDto): Promise<PasswordResetAcceptedResponseDto> {
    return this.auth.requestPasswordReset(body);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Kata sandi berubah dan seluruh sesi akun dicabut.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'Token reset tidak valid, tidak terkirim, atau sudah kedaluwarsa.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  async confirmPasswordReset(@Body() body: PasswordResetConfirmationRequestDto): Promise<void> {
    await this.auth.confirmPasswordReset(body);
  }
}
