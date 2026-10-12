import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthRateLimitGuard, AuthRateLimitService } from './auth-rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard, RoleGuard } from './auth.guards.js';
import { MeController } from './me.controller.js';
import { PasswordHasher } from './password-hasher.js';
import {
  PASSWORD_RESET_DELIVERY,
  UnconfiguredPasswordResetDeliveryAdapter,
} from './password-reset-delivery.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordHasher,
    AuthRateLimitService,
    AuthRateLimitGuard,
    AccessTokenGuard,
    RoleGuard,
    {
      provide: PASSWORD_RESET_DELIVERY,
      useClass: UnconfiguredPasswordResetDeliveryAdapter,
    },
  ],
  exports: [AuthService, AccessTokenGuard, RoleGuard],
})
export class AuthModule {}
