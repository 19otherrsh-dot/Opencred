import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import { PrismaService } from '../../common/prisma.service';
import { IssuerService } from '../issuer/issuer.service';
import { EventsService } from '../analytics/events.service';

export interface CredentialQuery {
  status?: string;
  templateId?: string;
  batchId?: string;
  recipientId?: string;
  q?: string;
  issuedAfter?: string;
  issuedBefore?: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuer: IssuerService,
    private readonly events: EventsService,
  ) {}

  private where(organizationId: string, query: CredentialQuery): Prisma.CredentialWhereInput {
    return {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.recipientId ? { recipientId: query.recipientId } : {}),
      ...(query.issuedAfter || query.issuedBefore
        ? {
            issuedAt: {
              ...(query.issuedAfter ? { gte: new Date(query.issuedAfter) } : {}),
              ...(query.issuedBefore ? { lte: new Date(query.issuedBefore) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { publicId: { contains: query.q.toLowerCase() } },
              { recipient: { name: { contains: query.q, mode: 'insensitive' } } },
              { recipient: { email: { contains: query.q.toLowerCase() } } },
            ],
          }
        : {}),
    };
  }

  async list(organizationId: string, query: CredentialQuery) {
    const limit = Math.min(query.limit ?? 25, 200);
    const rows = await this.prisma.credential.findMany({
      where: this.where(organizationId, query),
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        recipient: { select: { id: true, name: true, email: true, externalId: true } },
        template: { select: { id: true, name: true } },
      },
    });

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const origin = this.issuer.originFor(org);
    const hasMore = rows.length > limit;

    return {
      data: rows.slice(0, limit).map((c) => ({
        id: c.id,
        publicId: c.publicId,
        title: c.title,
        kind: c.kind,
        status: c.status,
        recipient: c.recipient,
        template: c.template,
        batchId: c.batchId,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        revokedAt: c.revokedAt,
        emailStatus: c.emailStatus,
        verificationUrl: `${origin}/v/${c.publicId}`,
        thumbnailUrl: c.thumbnailKey ? `${origin}/v1/public/credentials/${c.publicId}/thumbnail` : null,
      })),
      nextCursor: hasMore ? rows[limit - 1].id : null,
    };
  }

  async get(organizationId: string, id: string) {
    const credential = await this.prisma.credential.findFirst({
      where: { OR: [{ id }, { publicId: id }], organizationId },
      include: {
        recipient: true,
        template: { select: { id: true, name: true, kind: true, version: true } },
        batch: { select: { id: true, name: true } },
      },
    });
    if (!credential) throw new NotFoundException('credential not found');

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const origin = this.issuer.originFor(org);

    return {
      ...credential,
      verificationUrl: `${origin}/v/${credential.publicId}`,
      badgeUrl: `${origin}/v1/public/credentials/${credential.publicId}/credential.json`,
      linkedInUrl: this.linkedInAddUrl({
        origin,
        name: credential.title,
        organizationName: org.name,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
        publicId: credential.publicId,
      }),
      events: await this.events.timeline(credential.id, 50),
    };
  }

  /**
   * FR-STD-05 — the "Add to LinkedIn profile" deep link.
   *
   * LinkedIn's documented certification-import parameters. `certUrl` points at
   * the public verification page rather than at a file, so a profile visitor
   * who follows it lands on a page that proves the credential is still valid
   * — which a static PDF cannot do.
   */
  linkedInAddUrl(params: {
    origin: string;
    name: string;
    organizationName: string;
    issuedAt: Date;
    expiresAt: Date | null;
    publicId: string;
  }): string {
    const url = new URL('https://www.linkedin.com/profile/add');
    url.searchParams.set('startTask', 'CERTIFICATION_NAME');
    url.searchParams.set('name', params.name);
    url.searchParams.set('organizationName', params.organizationName);
    url.searchParams.set('issueYear', String(params.issuedAt.getUTCFullYear()));
    url.searchParams.set('issueMonth', String(params.issuedAt.getUTCMonth() + 1));
    if (params.expiresAt) {
      url.searchParams.set('expirationYear', String(params.expiresAt.getUTCFullYear()));
      url.searchParams.set('expirationMonth', String(params.expiresAt.getUTCMonth() + 1));
    }
    url.searchParams.set('certUrl', `${params.origin}/v/${params.publicId}`);
    url.searchParams.set('certId', params.publicId);
    return url.toString();
  }

  /**
   * FR-REC-04 — full export, on demand, with no support ticket.
   *
   * Streams as CSV in pages rather than loading a year of issuance into
   * memory. The point of this endpoint is that leaving is easy; making it
   * fall over on large accounts would quietly defeat that.
   */
  async *exportCsv(organizationId: string, query: CredentialQuery): AsyncGenerator<string> {
    yield stringify([
      [
        'credential_id',
        'public_id',
        'status',
        'title',
        'recipient_name',
        'recipient_email',
        'recipient_external_id',
        'template',
        'batch',
        'issued_at',
        'expires_at',
        'revoked_at',
        'revocation_reason',
        'email_status',
        'verification_url',
        'credential_hash',
      ],
    ]);

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const origin = this.issuer.originFor(org);

    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.credential.findMany({
        where: this.where(organizationId, query),
        orderBy: { id: 'asc' },
        take: 1_000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          recipient: { select: { name: true, email: true, externalId: true } },
          template: { select: { name: true } },
          batch: { select: { name: true } },
        },
      });
      if (rows.length === 0) break;

      yield stringify(
        rows.map((c) => [
          c.id,
          c.publicId,
          c.status,
          c.title,
          c.recipient.name,
          c.recipient.email,
          c.recipient.externalId ?? '',
          c.template.name,
          c.batch?.name ?? '',
          c.issuedAt.toISOString(),
          c.expiresAt?.toISOString() ?? '',
          c.revokedAt?.toISOString() ?? '',
          c.revocationReason ?? '',
          c.emailStatus,
          `${origin}/v/${c.publicId}`,
          c.credentialHash ?? '',
        ]),
      );

      cursor = rows[rows.length - 1].id;
      if (rows.length < 1_000) break;
    }
  }

  /** FR-DEL-02 — every credential issued to one email address, across issuers. */
  async walletFor(email: string) {
    const normalized = email.trim().toLowerCase();
    const credentials = await this.prisma.credential.findMany({
      where: {
        recipient: { email: normalized },
        status: { in: ['issued', 'expired', 'revoked'] },
      },
      orderBy: { issuedAt: 'desc' },
      take: 500,
      include: {
        organization: { select: { id: true, name: true, website: true, slug: true, branding: true } },
      },
    });

    return credentials.map((c) => {
      const origin = this.issuer.originFor(c.organization);
      return {
        id: c.id,
        publicId: c.publicId,
        title: c.title,
        description: c.description,
        kind: c.kind,
        status: c.status,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        issuer: { name: c.organization.name, website: c.organization.website },
        verificationUrl: `${origin}/v/${c.publicId}`,
        downloadUrl: `${origin}/v1/public/credentials/${c.publicId}/download`,
        badgeUrl: `${origin}/v1/public/credentials/${c.publicId}/credential.json`,
        thumbnailUrl: c.thumbnailKey
          ? `${origin}/v1/public/credentials/${c.publicId}/thumbnail`
          : null,
      };
    });
  }
}
