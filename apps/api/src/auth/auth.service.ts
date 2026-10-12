import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type {
  LoginRequestDto,
  PasswordResetConfirmationRequestDto,
  PasswordResetRequestDto,
  RegisterRequestDto,
} from './auth.dto.js';
import { PasswordHasher } from './password-hasher.js';
import {
  PASSWORD_RESET_DELIVERY,
  type AdapterOperationResult,
  type PasswordResetDeliveryAdapter,
} from './password-reset-delivery.js';
import type { AuthSessionResponse, AuthUser, SessionTokenPair, UserRole } from './auth.types.js';

const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const RESET_TOKEN_TTL_MS = 60 * 60_000;
const RESET_ACCEPTED_MESSAGE = 'Jika akun terdaftar, instruksi reset akan dikirim.';

interface UserCredentialRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  password_hash: string;
  roles: UserRole[];
}

interface CurrentRefreshSessionRow {
  session_id: string;
  user_id: string;
  active_role: UserRole;
  email: string;
  full_name: string;
  account_status: string;
  session_status: 'active' | 'revoked';
  unexpired: boolean;
}

interface RefreshHistoryRow {
  session_id: string;
  session_status: 'active' | 'revoked';
}

interface NewUserRow {
  id: string;
  email: string;
  full_name: string;
}

type RefreshOutcome =
  | { kind: 'invalid' }
  | { kind: 'success'; user: AuthUser; activeRole: UserRole; sessionId: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createTokenPair(): SessionTokenPair {
  const now = Date.now();
  return {
    accessToken: randomBytes(32).toString('base64url'),
    refreshToken: randomBytes(32).toString('base64url'),
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
    sessionExpiresAt: new Date(now + SESSION_TTL_MS),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function rethrowDatabaseFailure(error: unknown): never {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
  if (/^(08|28|3D000|3F000|42P01|57P0[123]|ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)/.test(code)) {
    throw new ServiceUnavailableException({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service is not ready',
    });
  }
  throw error;
}

function failedDelivery(): AdapterOperationResult {
  return {
    operationId: randomUUID(),
    status: 'failed',
    occurredAt: new Date().toISOString(),
    error: {
      code: 'RESET_DELIVERY_FAILED',
      message: 'Password reset delivery could not be completed',
      retryable: true,
    },
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwordHasher: PasswordHasher,
    @Inject(PASSWORD_RESET_DELIVERY)
    private readonly passwordResetDelivery: PasswordResetDeliveryAdapter,
  ) {}

  async register(input: RegisterRequestDto): Promise<AuthSessionResponse> {
    const email = normalizeEmail(input.email);
    const fullName = input.fullName.trim();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const tokens = createTokenPair();

    try {
      return await this.database.transaction(async (client) => {
        const created = await client.query<NewUserRow>(
          `INSERT INTO users (email, full_name)
           VALUES ($1, $2)
           RETURNING id, email, full_name`,
          [email, fullName],
        );
        const user = created.rows[0];

        await client.query(
          `INSERT INTO role_memberships (user_id, role)
           VALUES ($1, $2)`,
          [user.id, input.role],
        );
        await client.query(
          `INSERT INTO user_credentials (user_id, password_hash, password_hash_scheme)
           VALUES ($1, $2, 'scrypt')`,
          [user.id, passwordHash],
        );
        if (input.role === 'farmer') {
          await client.query('INSERT INTO farmer_profiles (user_id) VALUES ($1)', [user.id]);
        } else {
          await client.query('INSERT INTO vet_profiles (user_id) VALUES ($1)', [user.id]);
        }

        const sessionId = await this.insertSession(client, user.id, input.role, tokens);
        return this.toSessionResponse(
          { id: user.id, email: user.email, fullName: user.full_name, roles: [input.role] },
          input.role,
          sessionId,
          tokens,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: 'CONFLICT', message: 'An account with this email already exists' });
      }
      rethrowDatabaseFailure(error);
    }
  }

  async login(input: LoginRequestDto): Promise<AuthSessionResponse> {
    const email = normalizeEmail(input.email);
    let result;
    try {
      result = await this.database.query<UserCredentialRow>(
        `SELECT u.id, u.email, u.full_name, u.status, c.password_hash,
                array_agg(m.role ORDER BY m.role) AS roles
         FROM users u
         JOIN user_credentials c ON c.user_id = u.id
         JOIN role_memberships m ON m.user_id = u.id
         WHERE lower(btrim(u.email)) = $1
         GROUP BY u.id, u.email, u.full_name, u.status, c.password_hash`,
        [email],
      );
    } catch (error) {
      rethrowDatabaseFailure(error);
    }
    const user = result.rows[0];

    if (!user) {
      await this.passwordHasher.verifyUnknownAccount(input.password);
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' });
    }

    const passwordMatches = await this.passwordHasher.verify(input.password, user.password_hash);
    if (!passwordMatches || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' });
    }
    if (!user.roles.includes(input.activeRole)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'The account does not have the selected role' });
    }

    const tokens = createTokenPair();
    let sessionId: string;
    try {
      sessionId = await this.database.transaction((client) =>
        this.insertSession(client, user.id, input.activeRole, tokens),
      );
    } catch (error) {
      rethrowDatabaseFailure(error);
    }
    return this.toSessionResponse(
      { id: user.id, email: user.email, fullName: user.full_name, roles: user.roles },
      input.activeRole,
      sessionId,
      tokens,
    );
  }

  async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const previousHash = tokenHash(refreshToken);
    const tokens = createTokenPair();
    let outcome: RefreshOutcome;
    try {
      outcome = await this.database.transaction<RefreshOutcome>(async (client) => {
        const currentResult = await client.query<CurrentRefreshSessionRow>(
          `SELECT s.id AS session_id, s.user_id, s.active_role, s.status AS session_status,
                  s.expires_at > now() AS unexpired, u.email, u.full_name,
                  u.status AS account_status
           FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.refresh_token_hash = $1
           FOR UPDATE OF s`,
          [previousHash],
        );
        const current = currentResult.rows[0];

        if (current) {
          if (current.session_status !== 'active' || !current.unexpired || current.account_status !== 'active') {
            if (current.session_status === 'active') await this.revokeSession(client, current.session_id);
            return { kind: 'invalid' as const };
          }

          await client.query(
            `INSERT INTO auth_refresh_token_history (session_id, token_hash, consumed_at)
             VALUES ($1, $2, now())`,
            [current.session_id, previousHash],
          );
          await client.query(
            `UPDATE auth_sessions
             SET access_token_hash = $2,
                 refresh_token_hash = $3,
                 access_expires_at = $4,
                 last_used_at = now(),
                 updated_at = now()
             WHERE id = $1 AND status = 'active'`,
            [current.session_id, tokenHash(tokens.accessToken), tokenHash(tokens.refreshToken), tokens.accessExpiresAt],
          );

          const rolesResult = await client.query<{ role: UserRole }>(
            'SELECT role FROM role_memberships WHERE user_id = $1 ORDER BY role',
            [current.user_id],
          );
          return {
            kind: 'success' as const,
            user: {
              id: current.user_id,
              email: current.email,
              fullName: current.full_name,
              roles: rolesResult.rows.map((row) => row.role),
            },
            activeRole: current.active_role,
            sessionId: current.session_id,
          };
        }

        const historyResult = await client.query<RefreshHistoryRow>(
          `SELECT s.id AS session_id, s.status AS session_status
           FROM auth_refresh_token_history h
           JOIN auth_sessions s ON s.id = h.session_id
           WHERE h.token_hash = $1
           FOR UPDATE OF s`,
          [previousHash],
        );
        const replay = historyResult.rows[0];
        if (replay?.session_status === 'active') await this.revokeSession(client, replay.session_id);
        return { kind: 'invalid' as const };
      });
    } catch (error) {
      rethrowDatabaseFailure(error);
    }

    if (outcome.kind !== 'success') {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Refresh token is invalid or expired' });
    }
    return this.toSessionResponse(outcome.user, outcome.activeRole, outcome.sessionId, tokens);
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = tokenHash(refreshToken);
    try {
      await this.database.transaction(async (client) => {
        const currentResult = await client.query<{ id: string }>(
          `SELECT id FROM auth_sessions WHERE refresh_token_hash = $1 FOR UPDATE`,
          [hash],
        );
        const current = currentResult.rows[0];
        if (current) {
          await this.revokeSession(client, current.id);
          return;
        }

        const historyResult = await client.query<{ session_id: string; status: 'active' | 'revoked' }>(
          `SELECT s.id AS session_id, s.status
           FROM auth_refresh_token_history h
           JOIN auth_sessions s ON s.id = h.session_id
           WHERE h.token_hash = $1
           FOR UPDATE OF s`,
          [hash],
        );
        const previous = historyResult.rows[0];
        if (previous?.status === 'active') await this.revokeSession(client, previous.session_id);
      });
    } catch (error) {
      rethrowDatabaseFailure(error);
    }
  }

  async requestPasswordReset(input: PasswordResetRequestDto): Promise<{ message: string }> {
    const email = normalizeEmail(input.email);
    const resetToken = randomBytes(32).toString('base64url');

    try {
      const userResult = await this.database.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(btrim(email)) = $1 AND status = \'active\'',
        [email],
      );
      const user = userResult.rows[0];
      if (!user) return { message: RESET_ACCEPTED_MESSAGE };

      const resetId = randomUUID();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await this.database.transaction(async (client) => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
        await client.query(
          `UPDATE password_reset_requests
           SET delivery_status = 'failed', delivered_at = NULL
           WHERE user_id = $1
             AND consumed_at IS NULL
             AND delivery_status IN ('pending', 'succeeded')`,
          [user.id],
        );
        await client.query(
          `INSERT INTO password_reset_requests (id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [resetId, user.id, tokenHash(resetToken), expiresAt],
        );
      });

      let delivery: AdapterOperationResult;
      try {
        delivery = await this.passwordResetDelivery.deliver(email, resetToken);
      } catch {
        delivery = failedDelivery();
      }
      await this.database.query(
        `UPDATE password_reset_requests
         SET delivery_status = $2,
             delivery_operation_id = $3,
             delivered_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE NULL END
         WHERE id = $1 AND delivery_status = 'pending'`,
        [resetId, delivery.status, delivery.operationId],
      );
    } catch {
      // The same response is returned for unknown accounts and unavailable dependencies.
    }

    return { message: RESET_ACCEPTED_MESSAGE };
  }

  async confirmPasswordReset(input: PasswordResetConfirmationRequestDto): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    let applied: boolean;
    try {
      applied = await this.database.transaction(async (client) => {
        const requestResult = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id
           FROM password_reset_requests
           WHERE token_hash = $1
             AND delivery_status = 'succeeded'
             AND consumed_at IS NULL
             AND expires_at > now()
           FOR UPDATE`,
          [tokenHash(input.token)],
        );
        const resetRequest = requestResult.rows[0];
        if (!resetRequest) return false;

        await client.query(
          'UPDATE password_reset_requests SET consumed_at = now() WHERE id = $1',
          [resetRequest.id],
        );
        await client.query(
          `INSERT INTO user_credentials (user_id, password_hash, password_hash_scheme)
           VALUES ($1, $2, 'scrypt')
           ON CONFLICT (user_id) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               password_hash_scheme = EXCLUDED.password_hash_scheme,
               updated_at = now(),
               version = user_credentials.version + 1`,
          [resetRequest.user_id, passwordHash],
        );
        await client.query(
          `UPDATE password_reset_requests
           SET delivery_status = 'failed', delivered_at = NULL
           WHERE user_id = $1
             AND id <> $2
             AND consumed_at IS NULL
             AND delivery_status IN ('pending', 'succeeded')`,
          [resetRequest.user_id, resetRequest.id],
        );
        await client.query(
          `UPDATE auth_sessions
           SET status = 'revoked',
               access_token_hash = NULL,
               refresh_token_hash = NULL,
               access_expires_at = NULL,
               revoked_at = now(),
               updated_at = now()
           WHERE user_id = $1 AND status = 'active'`,
          [resetRequest.user_id],
        );
        return true;
      });
    } catch (error) {
      rethrowDatabaseFailure(error);
    }

    if (!applied) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Reset token is invalid or expired' });
    }
  }

  private async insertSession(
    client: PoolClient,
    userId: string,
    activeRole: UserRole,
    tokens: SessionTokenPair,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions (
         user_id, active_role, access_token_hash, refresh_token_hash, access_expires_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        activeRole,
        tokenHash(tokens.accessToken),
        tokenHash(tokens.refreshToken),
        tokens.accessExpiresAt,
        tokens.sessionExpiresAt,
      ],
    );
    return result.rows[0].id;
  }

  private async revokeSession(client: PoolClient, sessionId: string): Promise<void> {
    await client.query(
      `UPDATE auth_sessions
       SET status = 'revoked',
           access_token_hash = NULL,
           refresh_token_hash = NULL,
           access_expires_at = NULL,
           revoked_at = now(),
           updated_at = now()
       WHERE id = $1 AND status = 'active'`,
      [sessionId],
    );
  }

  private toSessionResponse(
    user: AuthUser,
    activeRole: UserRole,
    sessionId: string,
    tokens: SessionTokenPair,
  ): AuthSessionResponse {
    return {
      user,
      activeRole,
      sessionId,
      tokenType: 'Bearer',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt.toISOString(),
      sessionExpiresAt: tokens.sessionExpiresAt.toISOString(),
    };
  }
}
