import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { clientIp, truncateIp, type AuthPrincipal, type AuthenticatedRequest } from './request-context';

/**
 * FR-ID-05 — the audit log.
 *
 * Append-only by construction: this service exposes `record` and `list`, and
 * nothing anywhere exposes update or delete. That is the whole point — an
 * audit trail an administrator can edit is not an audit trail, and this is one
 * of the properties an institution's security review will actually check.
 *
 * Writes are best-effort with respect to the caller: a failure to log is
 * reported loudly but does not roll back the action that was already taken.
 * The alternative — refusing a legitimate revocation because the log table is
 * full — is worse.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    organizationId: string;
    principal?: AuthPrincipal | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    request?: AuthenticatedRequest;
    /** For system-initiated actions (scheduled expiry sweeps, workers). */
    actorLabel?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          actorType: params.principal?.type ?? 'system',
          actorId: params.principal?.id ?? null,
          actorLabel: params.principal?.label ?? params.actorLabel ?? 'system',
          action: params.action,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          metadata: (params.metadata ?? {}) as never,
          ip: params.request ? (truncateIp(clientIp(params.request)) ?? null) : null,
          userAgent: params.request?.headers['user-agent']?.slice(0, 500) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `failed to write audit record "${params.action}" for org ${params.organizationId}: ${(err as Error).message}`,
      );
    }
  }

  async list(
    organizationId: string,
    options: { limit?: number; cursor?: string; action?: string } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(options.action ? { action: options.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit),
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }
}
