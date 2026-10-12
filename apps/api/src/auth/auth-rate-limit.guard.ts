import { CanActivate, HttpException, HttpStatus, Injectable, type ExecutionContext } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

interface Bucket {
  windowEndsAt: number;
  count: number;
}

interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class AuthRateLimitService {
  private readonly identityPepper = randomBytes(32);
  private readonly buckets = new Map<string, Bucket>();
  private callsSinceSweep = 0;
  private readonly maxBuckets = 50_000;

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    this.callsSinceSweep += 1;
    if (this.callsSinceSweep >= 256 || this.buckets.size >= this.maxBuckets) {
      this.sweep(now);
      this.callsSinceSweep = 0;
    }

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.windowEndsAt <= now) {
      if (this.buckets.size >= this.maxBuckets) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1_000) };
      }
      bucket = { windowEndsAt: now + windowMs, count: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowEndsAt - now) / 1_000)),
      };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  identityKey(value: string): string {
    return createHmac('sha256', this.identityPepper).update(value.trim().toLowerCase()).digest('hex');
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowEndsAt <= now) this.buckets.delete(key);
    }
  }
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limits: AuthRateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const path = (request.originalUrl || request.path).split('?')[0].replace(/\/+$/, '') || '/';
    const scope = `${request.method}:${path}`;
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const policy = this.policyFor(path);
    let retryAfterSeconds = 0;

    const ipDecision = this.limits.consume(`ip:${scope}:${ip}`, policy.ipLimit, policy.ipWindowMs);
    if (!ipDecision.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, ipDecision.retryAfterSeconds);

    const body = request.body as Record<string, unknown> | undefined;
    const identity = typeof body?.email === 'string'
      ? body.email
      : typeof body?.token === 'string'
        ? body.token
        : undefined;
    if (identity && policy.identityLimit) {
      const identityHash = this.limits.identityKey(identity);
      const identityDecision = this.limits.consume(
        `identity:${scope}:${identityHash}`,
        policy.identityLimit,
        policy.identityWindowMs,
      );
      if (!identityDecision.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, identityDecision.retryAfterSeconds);
    }

    if (retryAfterSeconds > 0) {
      const response = (request as Request & { res?: Response }).res;
      response?.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many authentication requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private policyFor(path: string): {
    ipLimit: number;
    ipWindowMs: number;
    identityLimit?: number;
    identityWindowMs: number;
  } {
    if (path.endsWith('/register')) return { ipLimit: 5, ipWindowMs: 60 * 60_000, identityWindowMs: 60 * 60_000 };
    if (path.endsWith('/login')) return { ipLimit: 20, ipWindowMs: 15 * 60_000, identityLimit: 5, identityWindowMs: 15 * 60_000 };
    if (path.endsWith('/password-reset')) return { ipLimit: 10, ipWindowMs: 60 * 60_000, identityLimit: 3, identityWindowMs: 60 * 60_000 };
    if (path.endsWith('/password-reset/confirm')) return { ipLimit: 10, ipWindowMs: 60 * 60_000, identityLimit: 5, identityWindowMs: 60 * 60_000 };
    if (path.endsWith('/refresh')) return { ipLimit: 30, ipWindowMs: 60_000, identityWindowMs: 60_000 };
    return { ipLimit: 30, ipWindowMs: 60_000, identityWindowMs: 60_000 };
  }
}
