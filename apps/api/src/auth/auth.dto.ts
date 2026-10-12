import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES, type UserRole } from './auth.types.js';

export class RegisterRequestDto {
  @ApiProperty({ example: 'peternak@example.invalid', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Nama Pengguna Fiktif', minLength: 1, maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 256 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: UserRole;
}

export class LoginRequestDto {
  @ApiProperty({ example: 'peternak@example.invalid', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 256 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  activeRole!: UserRole;
}

export class RefreshTokenRequestDto {
  @ApiProperty({ writeOnly: true, minLength: 40, maxLength: 128 })
  @IsString()
  @MinLength(40)
  @MaxLength(128)
  refreshToken!: string;
}

export class PasswordResetRequestDto {
  @ApiProperty({ example: 'peternak@example.invalid', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordResetConfirmationRequestDto {
  @ApiProperty({ writeOnly: true, minLength: 40, maxLength: 128 })
  @IsString()
  @MinLength(40)
  @MaxLength(128)
  token!: string;

  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 256 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword!: string;
}

export class PasswordResetAcceptedResponseDto {
  @ApiProperty({ example: 'Jika akun terdaftar, instruksi reset akan dikirim.' })
  message!: string;
}

export class AuthUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'peternak@example.invalid' })
  email!: string;

  @ApiProperty({ example: 'Nama Pengguna Fiktif' })
  fullName!: string;

  @ApiProperty({ enum: USER_ROLES, isArray: true })
  roles!: UserRole[];
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: AuthUserResponseDto })
  user!: AuthUserResponseDto;

  @ApiProperty({ enum: USER_ROLES })
  activeRole!: UserRole;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType!: 'Bearer';

  @ApiProperty({ minLength: 40, maxLength: 128, description: 'Opaque bearer token. Server stores its SHA-256 hash.' })
  accessToken!: string;

  @ApiProperty({ minLength: 40, maxLength: 128, description: 'Opaque refresh token. Server stores its SHA-256 hash.' })
  refreshToken!: string;

  @ApiProperty({ format: 'date-time' })
  accessExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  sessionExpiresAt!: string;
}

export class MeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'peternak@example.invalid' })
  email!: string;

  @ApiProperty({ example: 'Nama Pengguna Fiktif' })
  fullName!: string;

  @ApiProperty({ enum: USER_ROLES, isArray: true })
  roles!: UserRole[];

  @ApiProperty({ enum: USER_ROLES })
  activeRole!: UserRole;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;
}
