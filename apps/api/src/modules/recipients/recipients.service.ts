import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { QueueService } from '../queue/queue.service';
import type { AuthPrincipal } from '../../common/request-context';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async list(
    organizationId: string,
    query: { q?: string; tag?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(query.limit ?? 25, 200);
    const where: Prisma.RecipientWhereInput = {
      organizationId,
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q.toLowerCase() } },
              { externalId: { contains: query.q } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.recipient.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { _count: { select: { credentials: true } } },
    });

    const hasMore = rows.length > limit;
    return {
      data: rows.slice(0, limit).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        externalId: r.externalId,
        tags: r.tags,
        credentialCount: r._count.credentials,
        erasedAt: r.erasedAt,
        createdAt: r.createdAt,
      })),
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  async get(organizationId: string, id: string) {
    const recipient = await this.prisma.recipient.findFirst({
      where: { id, organizationId },
      include: {
        credentials: {
          orderBy: { issuedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            publicId: true,
            title: true,
            status: true,
            issuedAt: true,
            expiresAt: true,
            emailStatus: true,
          },
        },
      },
    });
    if (!recipient) throw new NotFoundException('recipient not found');
    return recipient;
  }

  async update(
    organizationId: string,
    id: string,
    input: { name?: string; email?: string; externalId?: string | null; tags?: string[] },
    principal: AuthPrincipal,
  ) {
    const recipient = await this.prisma.recipient.findFirst({ where: { id, organizationId } });
    if (!recipient) throw new NotFoundException('recipient not found');

    if (input.email && !EMAIL_RE.test(input.email)) {
      throw new BadRequestException('invalid email address');
    }

    const updated = await this.prisma.recipient.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
        ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'recipient.updated',
      targetType: 'recipient',
      targetId: id,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  /**
   * FR-REC-03 — tag-based segmentation.
   *
   * Tags exist to make re-sends targetable ("bounced emails only"), so the API
   * that applies them is bulk by default rather than one recipient at a time.
   */
  async tag(
    organizationId: string,
    recipientIds: string[],
    add: string[],
    remove: string[],
  ): Promise<{ updated: number }> {
    const recipients = await this.prisma.recipient.findMany({
      where: { organizationId, id: { in: recipientIds } },
      select: { id: true, tags: true },
    });

    for (const recipient of recipients) {
      const next = new Set(recipient.tags);
      for (const t of add) next.add(t);
      for (const t of remove) next.delete(t);
      await this.prisma.recipient.update({
        where: { id: recipient.id },
        data: { tags: [...next] },
      });
    }

    return { updated: recipients.length };
  }

  /** Recipients whose most recent delivery failed — the segment issuers want. */
  async bouncedSegment(organizationId: string): Promise<string[]> {
    const failed = await this.prisma.credential.findMany({
      where: { organizationId, emailStatus: { in: ['failed', 'bounced'] } },
      select: { recipientId: true },
      distinct: ['recipientId'],
      take: 5_000,
    });
    return failed.map((c) => c.recipientId);
  }

  async resendTo(organizationId: string, recipientIds: string[]): Promise<{ queued: number }> {
    const credentials = await this.prisma.credential.findMany({
      where: { organizationId, recipientId: { in: recipientIds }, status: 'issued' },
      select: { id: true },
      take: 10_000,
    });
    for (const credential of credentials) {
      await this.queue.enqueueEmail({ credentialId: credential.id, organizationId });
    }
    return { queued: credentials.length };
  }

  /**
   * Import recipients without issuing anything.
   *
   * Useful for pre-loading a roster before a cohort finishes. De-duplicates on
   * the same keys as issuance does (FR-REC-02), so importing an overlapping
   * list twice does not create a second row.
   */
  async import(
    organizationId: string,
    file: Buffer,
    mapping: { name: string; email: string; externalId?: string; tags?: string },
    principal: AuthPrincipal,
  ): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
    let rows: Array<Record<string, string>>;
    try {
      rows = parse(file, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw new BadRequestException(`could not parse the CSV: ${(err as Error).message}`);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [index, row] of rows.entries()) {
      const name = (row[mapping.name] ?? '').trim();
      const email = (row[mapping.email] ?? '').trim().toLowerCase();
      const externalId = mapping.externalId ? (row[mapping.externalId] ?? '').trim() : '';
      const tags = mapping.tags
        ? (row[mapping.tags] ?? '')
            .split(/[;,]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      if (!name || !EMAIL_RE.test(email)) {
        skipped += 1;
        if (errors.length < 100) {
          errors.push(`row ${index + 2}: missing name or invalid email ("${email}")`);
        }
        continue;
      }

      const existing = await this.prisma.recipient.findFirst({
        where: {
          organizationId,
          OR: [{ email }, ...(externalId ? [{ externalId }] : [])],
        },
      });

      if (existing) {
        await this.prisma.recipient.update({
          where: { id: existing.id },
          data: {
            name,
            externalId: externalId || existing.externalId,
            tags: [...new Set([...existing.tags, ...tags])],
          },
        });
        updated += 1;
      } else {
        await this.prisma.recipient.create({
          data: { organizationId, name, email, externalId: externalId || null, tags },
        });
        created += 1;
      }
    }

    await this.audit.record({
      organizationId,
      principal,
      action: 'recipients.imported',
      metadata: { created, updated, skipped },
    });

    return { created, updated, skipped, errors };
  }

  /** FR-REC-04 — export every recipient, no support ticket required. */
  async exportCsv(organizationId: string): Promise<string> {
    const recipients = await this.prisma.recipient.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { credentials: true } } },
    });

    return stringify(
      recipients.map((r) => [
        r.id,
        r.name,
        r.email,
        r.externalId ?? '',
        r.tags.join(';'),
        r._count.credentials,
        r.createdAt.toISOString(),
        r.erasedAt?.toISOString() ?? '',
      ]),
      {
        header: true,
        columns: [
          'recipient_id',
          'name',
          'email',
          'external_id',
          'tags',
          'credential_count',
          'created_at',
          'erased_at',
        ],
      },
    );
  }
}
