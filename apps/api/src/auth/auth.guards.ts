import {
  CanActivate,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { AUTH_ROLES_KEY } from './auth.decorators.js';
import type { AuthenticatedPrincipal, RequestWithPrincipal, UserRole } from './auth.types.js';

interface SessionPrincipalRow {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string;
  active_role: UserRole;
  roles: UserRole[];
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{40,128})$/i.exec(authorization) : null;
    if (!match) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication is required' });

    let result;
    try {
      result = await this.database.query<SessionPrincipalRow>(
        `SELECT s.id AS session_id, u.id AS user_id, u.email, u.full_name,
                s.active_role, array_agg(m.role ORDER BY m.role) AS roles
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN role_memberships m ON m.user_id = u.id
         WHERE s.access_token_hash = $1
           AND s.status = 'active'
           AND s.access_expires_at > now()
           AND s.expires_at > now()
           AND u.status = 'active'
         GROUP BY s.id, u.id, u.email, u.full_name, s.active_role`,
        [tokenHash(match[1])],
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service is not ready',
      });
    }
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication is required' });

    const principal: AuthenticatedPrincipal = {
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      roles: row.roles,
      activeRole: row.active_role,
      sessionId: row.session_id,
    };
    request.authPrincipal = principal;
    return true;
  }
}

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { authPrincipal?: AuthenticatedPrincipal }>();
    const principal = request.authPrincipal;
    if (!principal || !principal.roles.includes(principal.activeRole) || !allowedRoles.includes(principal.activeRole)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'The active role is not authorized for this action' });
    }
    return true;
  }
}
