import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { PrismaService } from '../../common/prisma.service';

/**
 * FR-ANA-01 to FR-ANA-03 — analytics.
 *
 * The competitive research called out "thin analytics" as a recurring buyer
 * complaint, and the thinness is usually not the charts — it is that the
 * numbers are trapped in a dashboard. Everything here is available through the
 * API and as CSV, and the dashboard is one consumer of it rather than the
 * source of truth.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string, range: { from?: Date; to?: Date } = {}) {
    const from = range.from ?? new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const to = range.to ?? new Date();

    const [byStatus, issuedInRange, eventCounts, topTemplates, deliveries] = await Promise.all([
      this.prisma.credential.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.credential.count({
        where: { organizationId, issuedAt: { gte: from, lte: to }, status: { not: 'draft' } },
      }),
      this.prisma.credentialEvent.groupBy({
        by: ['type'],
        where: { organizationId, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.credential.groupBy({
        by: ['templateId'],
        where: { organizationId, status: { not: 'draft' } },
        _count: { _all: true },
        orderBy: { _count: { templateId: 'desc' } },
        take: 5,
      }),
      this.prisma.credential.groupBy({
        by: ['emailStatus'],
        where: { organizationId, status: { not: 'draft' } },
        _count: { _all: true },
      }),
    ]);

    const events = Object.fromEntries(eventCounts.map((e) => [e.type, e._count._all]));
    const templates = await this.prisma.template.findMany({
      where: { id: { in: topTemplates.map((t) => t.templateId) } },
      select: { id: true, name: true },
    });
    const templateNames = new Map(templates.map((t) => [t.id, t.name]));

    const delivered = events.email_sent ?? 0;
    const opened = events.email_opened ?? 0;
    const downloaded = events.downloaded ?? 0;
    const verified = events.verified ?? 0;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      credentials: {
        total: byStatus.reduce((sum, s) => sum + s._count._all, 0),
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
        issuedInRange,
      },
      engagement: {
        delivered,
        opened,
        downloaded,
        shared: events.shared ?? 0,
        linkedInAdded: events.linkedin_added ?? 0,
        verified,
        // Rates are computed here rather than in the UI so the API, the export
        // and the dashboard can never disagree about them.
        openRate: rate(opened, delivered),
        downloadRate: rate(downloaded, delivered),
        verificationRate: rate(verified, delivered),
      },
      delivery: Object.fromEntries(deliveries.map((d) => [d.emailStatus, d._count._all])),
      topTemplates: topTemplates.map((t) => ({
        templateId: t.templateId,
        name: templateNames.get(t.templateId) ?? 'Unknown template',
        count: t._count._all,
      })),
    };
  }

  /** Issuance and verification volume per day, for the dashboard chart. */
  async timeseries(
    organizationId: string,
    options: { days?: number } = {},
  ): Promise<Array<{ date: string; issued: number; verified: number; viewed: number }>> {
    const days = Math.min(Math.max(options.days ?? 30, 1), 365);
    const from = new Date(Date.now() - days * 24 * 60 * 60_000);

    // Grouped in SQL: pulling a year of rows into Node to bucket them is the
    // kind of thing that works in a demo and falls over on a real account.
    const issued = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "issuedAt") AS day, COUNT(*)::bigint AS count
      FROM credentials
      WHERE "organizationId" = ${organizationId}
        AND "issuedAt" >= ${from}
        AND status <> 'draft'
      GROUP BY 1 ORDER BY 1
    `;

    const events = await this.prisma.$queryRaw<Array<{ day: Date; type: string; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, type, COUNT(*)::bigint AS count
      FROM credential_events
      WHERE "organizationId" = ${organizationId}
        AND "createdAt" >= ${from}
        AND type IN ('verified', 'viewed')
      GROUP BY 1, 2 ORDER BY 1
    `;

    const buckets = new Map<string, { issued: number; verified: number; viewed: number }>();
    for (let i = 0; i < days; i += 1) {
      const date = new Date(from.getTime() + i * 24 * 60 * 60_000).toISOString().slice(0, 10);
      buckets.set(date, { issued: 0, verified: 0, viewed: 0 });
    }

    for (const row of issued) {
      const key = row.day.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.issued = Number(row.count);
    }
    for (const row of events) {
      const key = row.day.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (row.type === 'verified') bucket.verified = Number(row.count);
      if (row.type === 'viewed') bucket.viewed = Number(row.count);
    }

    return [...buckets.entries()].map(([date, values]) => ({ date, ...values }));
  }

  /** FR-ANA-02 — per-batch rollup. */
  async batchReport(organizationId: string, batchId: string) {
    const [batch, credentials, events] = await Promise.all([
      this.prisma.batch.findFirst({
        where: { id: batchId, organizationId },
        include: { template: { select: { name: true } } },
      }),
      this.prisma.credential.groupBy({
        by: ['status'],
        where: { organizationId, batchId },
        _count: { _all: true },
      }),
      this.prisma.credentialEvent.groupBy({
        by: ['type'],
        where: { organizationId, credential: { batchId } },
        _count: { _all: true },
      }),
    ]);

    if (!batch) return null;

    const eventCounts = Object.fromEntries(events.map((e) => [e.type, e._count._all]));
    const total = credentials.reduce((sum, c) => sum + c._count._all, 0);

    return {
      batch: {
        id: batch.id,
        name: batch.name,
        template: batch.template.name,
        status: batch.status,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      },
      total,
      byStatus: Object.fromEntries(credentials.map((c) => [c.status, c._count._all])),
      engagement: {
        delivered: eventCounts.email_sent ?? 0,
        opened: eventCounts.email_opened ?? 0,
        downloaded: eventCounts.downloaded ?? 0,
        verified: eventCounts.verified ?? 0,
        openRate: rate(eventCounts.email_opened ?? 0, eventCounts.email_sent ?? 0),
      },
    };
  }

  /** FR-ANA-03 — every event, as CSV. */
  async exportEvents(
    organizationId: string,
    range: { from?: Date; to?: Date } = {},
  ): Promise<string> {
    const events = await this.prisma.credentialEvent.findMany({
      where: {
        organizationId,
        ...(range.from || range.to
          ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100_000,
      include: {
        credential: {
          select: {
            publicId: true,
            title: true,
            recipient: { select: { name: true, email: true } },
          },
        },
      },
    });

    return stringify(
      events.map((e) => [
        e.createdAt.toISOString(),
        e.type,
        e.credential.publicId,
        e.credential.title,
        e.credential.recipient.name,
        e.credential.recipient.email,
        e.country ?? '',
        JSON.stringify(e.metadata ?? {}),
      ]),
      {
        header: true,
        columns: [
          'occurred_at',
          'event',
          'credential_id',
          'credential_title',
          'recipient_name',
          'recipient_email',
          'country',
          'metadata',
        ],
      },
    );
  }
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}
