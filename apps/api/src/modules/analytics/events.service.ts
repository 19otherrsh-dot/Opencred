import { Injectable, Logger } from '@nestjs/common';
import type { CredentialEventType } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { truncateIp, type AuthenticatedRequest } from '../../common/request-context';
import { clientIp } from '../../common/request-context';

/**
 * FR-ANA-01 — recipient-level event history.
 *
 * Every event is a row, and every row is exportable (FR-ANA-03). Competitors
 * routinely surface this in a dashboard and nowhere else; here the dashboard is
 * a view over the same data the export and the analytics API return.
 *
 * What is deliberately *not* recorded: full IP addresses, precise geolocation,
 * device fingerprints. Truncated addresses answer the question issuers actually
 * ask ("is anyone verifying these?") without turning a verification page into a
 * tracking surface for the people whose credentials they are.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    organizationId: string;
    credentialId: string;
    type: CredentialEventType;
    metadata?: Record<string, unknown>;
    request?: AuthenticatedRequest;
    country?: string;
  }): Promise<void> {
    try {
      await this.prisma.credentialEvent.create({
        data: {
          organizationId: params.organizationId,
          credentialId: params.credentialId,
          type: params.type,
          metadata: (params.metadata ?? {}) as never,
          ip: params.request ? (truncateIp(clientIp(params.request)) ?? null) : null,
          userAgent: params.request?.headers['user-agent']?.slice(0, 300) ?? null,
          country:
            params.country ??
            // Populated by most CDNs and reverse proxies; absent otherwise, and
            // we do not attempt to derive it ourselves.
            (params.request?.headers['cf-ipcountry'] as string | undefined) ??
            null,
        },
      });
    } catch (err) {
      // Analytics must never break issuance or verification.
      this.logger.warn(`event "${params.type}" not recorded: ${(err as Error).message}`);
    }
  }

  async recordMany(
    events: Array<{
      organizationId: string;
      credentialId: string;
      type: CredentialEventType;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.prisma.credentialEvent.createMany({
        data: events.map((e) => ({
          organizationId: e.organizationId,
          credentialId: e.credentialId,
          type: e.type,
          metadata: (e.metadata ?? {}) as never,
        })),
      });
    } catch (err) {
      this.logger.warn(`bulk events not recorded: ${(err as Error).message}`);
    }
  }

  async timeline(credentialId: string, limit = 200) {
    return this.prisma.credentialEvent.findMany({
      where: { credentialId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 1_000),
      select: {
        id: true,
        type: true,
        metadata: true,
        country: true,
        createdAt: true,
      },
    });
  }
}
