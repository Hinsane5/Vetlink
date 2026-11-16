import type { ServerAuthRepository, ServerAuthResponse, ServerMeResponse } from '../../application/ports/ServerAuthRepository';
import type { AccountRole } from '../../domain/auth';
import { ApiClient } from './ApiClient';

export class HttpServerAuthRepository implements ServerAuthRepository {
  constructor(private readonly api: ApiClient) {}

  register(input: { email: string; fullName: string; password: string; role: AccountRole }): Promise<ServerAuthResponse> {
    return this.api.request('/v1/auth/register', {
      method: 'POST',
      authenticated: false,
      body: { email: input.email, fullName: input.fullName, password: input.password, role: input.role },
    });
  }

  login(input: { email: string; password: string; activeRole: AccountRole }): Promise<ServerAuthResponse> {
    return this.api.request('/v1/auth/login', {
      method: 'POST',
      authenticated: false,
      body: { email: input.email, password: input.password, activeRole: input.activeRole },
    });
  }

  switchActiveRole(activeRole: AccountRole): Promise<ServerAuthResponse> {
    return this.api.request('/v1/auth/active-role', {
      method: 'POST',
      body: { activeRole },
    });
  }

  me(): Promise<ServerMeResponse> {
    return this.api.request('/v1/me');
  }

  logout(refreshToken: string): Promise<void> {
    return this.api.request('/v1/auth/logout', {
      method: 'POST',
      authenticated: false,
      body: { refreshToken },
    });
  }
}
