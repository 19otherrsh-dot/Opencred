import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { planFor } from '@opencred/schema';
import { PrismaService } from './prisma.service';
import { QueueService } from '../modules/queue/queue.service';
import { clientIp, type AuthenticatedRequest } from './request-context';
import { loadConfig } from '../config';

/**
 * Per-principal rate limiting, backed by Valkey.
 *
 * The limit comes from the caller's plan, so the published pricing table is
 * also the published rate-limit table — there is no separate, undocumented
 * throttle. Unauthenticated traffic (verification pages) is limited by IP at a
 * fixed, generous rate: an employer checking twenty candidates must not be
 * throttled, but an enumeration attempt against public identifiers should be.
 *
 * If Valkey is unreachable the limiter fails *open*. A cache outage taking down
 * credential verification would be a worse failure than a brief window of
 * unlimited requests.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly config = loadConfig();
  private readonly planCache = new Map<string, { plan: string; at: number }>();
  private redis: ReturnType<QueueService['createConnection']> | null = null;

  private static readonly ANONYMOUS_LIMIT_PER_MINUTE = 120;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  private connection() {
    if (!this.redis) this.redis = this.queue.createConnection();
    return this.redis;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // Health and metrics endpoints are scraped on a schedule and must never be
    // throttled — a rate-limited readiness probe removes a healthy node.
    if (/^\/(healthz|readyz|metrics)$/.test(request.path)) return true;

    const principal = request.principal;
    const { key, limit } = principal
      ? {
          key: `rl:${principal.type}:${principal.id}`,
          limit: await this.limitFor(principal.organizationId),
        }
      : {
          key: `rl:ip:${clientIp(request) ?? 'unknown'}`,
          limit: RateLimitGuard.ANONYMOUS_LIMIT_PER_MINUTE,
        };

    try {
      const window = Math.floor(Date.now() / 60_000);
      const bucket = `${key}:${window}`;
      const connection = this.connection();

      const count = await connection.incr(bucket);
      if (count === 1) await connection.expire(bucket, 120);

      const remaining = Math.max(0, limit - count);
      response.setHeader('x-ratelimit-limit', String(limit));
      response.setHeader('x-ratelimit-remaining', String(remaining));
      response.setHeader('x-ratelimit-reset', String((window + 1) * 60));

      if (count > limit) {
        const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
        response.setHeader('retry-after', String(retryAfter));
        throw new HttpException(
          {
            error: 'rate_limited',
            message: `Rate limit of ${limit} requests per minute exceeded.`,
            limit,
            retryAfterSeconds: retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`rate limiter unavailable, allowing request: ${(err as Error).message}`);
      return true;
    }
  }

  private async limitFor(organizationId: string): Promise<number> {
    const cached = this.planCache.get(organizationId);
    if (cached && Date.now() - cached.at < 60_000) {
      return planFor(cached.plan).features.apiRateLimitPerMinute;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    const plan = org?.plan ?? 'free';
    this.planCache.set(organizationId, { plan, at: Date.now() });

    // Self-hosted installs are not rate limited in any meaningful sense; the
    // ceiling exists only to stop a runaway loop from exhausting the process.
    return this.config.isSelfHosted
      ? 60_000
      : planFor(plan).features.apiRateLimitPerMinute;
  }
}
