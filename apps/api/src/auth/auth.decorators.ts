import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal, RequestWithPrincipal, UserRole } from './auth.types.js';

export const AUTH_ROLES_KEY = 'vetlink:auth:roles';

export function RequireRoles(...roles: UserRole[]) {
  return SetMetadata(AUTH_ROLES_KEY, roles);
}

export const AuthenticatedUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    return request.authPrincipal!;
  },
);
