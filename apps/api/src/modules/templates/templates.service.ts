import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  brandingSettingsSchema,
  collectMergeTokens,
  emptyTemplate,
  requiredDataFields,
  templateDocumentSchema,
  type CredentialKind,
} from '@opencred/schema';
import { sampleMergeContext } from '@opencred/renderer';
import { getTemplate, searchTemplates, templateCategories } from '@opencred/templates';
import { PrismaService } from '../../common/prisma.service';
import { RenderService } from '../render/render.service';
import { AuditService } from '../../common/audit.service';
import type { AuthPrincipal } from '../../common/request-context';

/**
 * The design studio's server side.
 *
 * Templates are stored as validated JSON documents and versioned on every
 * save. The version number is copied onto each credential at issuance, which
 * is what lets an issuer redesign a template in March without changing what a
 * credential issued in January looks like when it is re-rendered.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    options: { includeArchived?: boolean; kind?: CredentialKind; q?: string } = {},
  ) {
    const templates = await this.prisma.template.findMany({
      where: {
        organizationId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.q
          ? { name: { contains: options.q, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        librarySlug: true,
        thumbnailKey: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { credentials: true } },
      },
    });

    return templates.map((t) => ({
      ...t,
      credentialCount: t._count.credentials,
      _count: undefined,
    }));
  }

  async get(organizationId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, organizationId },
    });
    if (!template) throw new NotFoundException('template not found');

    const document = templateDocumentSchema.parse(template.document);
    return {
      ...template,
      document,
      mergeFields: collectMergeTokens(document),
      requiredFields: requiredDataFields(document),
    };
  }

  async create(
    organizationId: string,
    input: {
      name: string;
      description?: string;
      kind?: CredentialKind;
      document?: unknown;
      fromLibrary?: string;
    },
    principal: AuthPrincipal,
  ) {
    let document;
    let librarySlug: string | null = null;
    let kind: CredentialKind = input.kind ?? 'certificate';

    if (input.fromLibrary) {
      const entry = getTemplate(input.fromLibrary);
      document = entry.document;
      librarySlug = entry.slug;
      kind = entry.kind;
    } else if (input.document) {
      document = templateDocumentSchema.parse(input.document);
      kind = document.kind;
    } else {
      document = emptyTemplate(kind);
    }

    const template = await this.prisma.template.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description ?? null,
        kind,
        document: document as never,
        librarySlug,
        createdById: principal.type === 'user' ? principal.id : null,
      },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'template.created',
      targetType: 'template',
      targetId: template.id,
      metadata: { name: input.name, fromLibrary: librarySlug },
    });

    return template;
  }

  async update(
    organizationId: string,
    id: string,
    input: { name?: string; description?: string | null; document?: unknown },
    principal: AuthPrincipal,
  ) {
    const existing = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('template not found');

    const document = input.document
      ? templateDocumentSchema.parse(input.document)
      : undefined;

    const template = await this.prisma.template.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(document
          ? { document: document as never, kind: document.kind, version: { increment: 1 } }
          : {}),
      },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'template.updated',
      targetType: 'template',
      targetId: id,
      metadata: { version: template.version, renamed: input.name !== undefined },
    });

    return template;
  }

  async duplicate(organizationId: string, id: string, principal: AuthPrincipal) {
    const source = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (!source) throw new NotFoundException('template not found');

    return this.prisma.template.create({
      data: {
        organizationId,
        name: `${source.name} (copy)`,
        description: source.description,
        kind: source.kind,
        document: source.document as never,
        librarySlug: source.librarySlug,
        createdById: principal.type === 'user' ? principal.id : null,
      },
    });
  }

  /**
   * Archive rather than delete.
   *
   * A template that credentials were issued from is part of the audit record
   * for those credentials. Deleting it would break re-rendering and leave the
   * issued history unreproducible, so the only supported operation is to take
   * it out of circulation.
   */
  async archive(organizationId: string, id: string, principal: AuthPrincipal) {
    const template = await this.prisma.template.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('template not found');

    await this.prisma.template.update({
      where: { id },
      data: { archivedAt: template.archivedAt ? null : new Date() },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: template.archivedAt ? 'template.restored' : 'template.archived',
      targetType: 'template',
      targetId: id,
    });

    return { archived: !template.archivedAt };
  }

  /** FR-DES-02 — live preview against a sample row. */
  async preview(
    organizationId: string,
    input: {
      templateId?: string;
      document?: unknown;
      data?: Record<string, string>;
      format?: 'png' | 'pdf' | 'svg';
      scale?: number;
    },
  ): Promise<{ buffer: Buffer; contentType: string; degraded: boolean }> {
    const document = input.document
      ? templateDocumentSchema.parse(input.document)
      : input.templateId
        ? templateDocumentSchema.parse(
            (
              await this.prisma.template.findFirstOrThrow({
                where: { id: input.templateId, organizationId },
              })
            ).document,
          )
        : (() => {
            throw new BadRequestException('supply either templateId or document');
          })();

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const branding = brandingSettingsSchema.parse(org.branding ?? {});

    const context = sampleMergeContext({
      'issuer.name': org.name,
      'issuer.url': org.website ?? '',
      ...(input.data ?? {}),
    });

    return this.render.preview({
      document,
      context,
      brandKit: this.render.parseBrandKit(branding.brandKit),
      verificationUrl: String(context['credential.verification_url']),
      format: input.format ?? 'png',
      scale: input.scale,
    });
  }

  /** FR-DES-03 — browse the starter library. */
  library(query: { q?: string; category?: string; kind?: CredentialKind; orientation?: 'landscape' | 'portrait' | 'square' }) {
    return {
      categories: templateCategories(),
      templates: searchTemplates(query),
    };
  }

  libraryTemplate(slug: string) {
    return getTemplate(slug);
  }
}
