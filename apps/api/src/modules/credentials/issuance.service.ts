import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Organization, Prisma } from '@prisma/client';
import {
  brandingSettingsSchema,
  requiredDataFields,
  type CredentialKind,
  type IssueRequest,
  type CredentialPatch,
} from '@opencred/schema';
import {
  buildAchievementCredential,
  credentialHash,
  signDocument,
} from '@opencred/credentials';
import { PrismaService } from '../../common/prisma.service';
import { credentialUrn, publicId } from '../../common/ids';
import { loadConfig } from '../../config';
import { IssuerService } from '../issuer/issuer.service';
import { RenderService } from '../render/render.service';
import { QueueService } from '../queue/queue.service';
import { EventsService } from '../analytics/events.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { UsageService } from '../billing/usage.service';
import { StorageService } from '../storage/storage.service';
import type { AuthPrincipal } from '../../common/request-context';

/**
 * The issuance engine.
 *
 * Split deliberately into two phases:
 *
 *   `create*`  — synchronous, transactional, cheap. Validates, de-duplicates
 *                the recipient, reserves the public id and returns. This is
 *                what an API caller waits on, and it is bounded by a database
 *                round trip, not by Chromium.
 *
 *   `process`  — asynchronous, in a worker. Signs, renders, stores, emails,
 *                fans out webhooks.
 *
 * That split is what makes 10,000 credentials in under five minutes a
 * capacity-planning question rather than an HTTP timeout question (FR-ISS-01),
 * and it is why a slow SMTP server cannot make issuance fail.
 */
@Injectable()
export class IssuanceService {
  private readonly logger = new Logger(IssuanceService.name);
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly issuer: IssuerService,
    private readonly render: RenderService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly webhooks: WebhooksService,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------------------
  // Phase 1 — accept
  // -------------------------------------------------------------------------

  /**
   * FR-ISS-02 / FR-ISS-04 — issue a single credential, from the dashboard or
   * from an external event (an LMS course completion, a Zapier/n8n step).
   */
  async issueOne(
    organizationId: string,
    request: IssueRequest,
    principal?: AuthPrincipal,
  ): Promise<{ id: string; publicId: string; status: string; deduplicated: boolean }> {
    // An idempotency key that has been seen before returns the original
    // credential rather than issuing a second one. Event-driven callers retry;
    // without this, one webhook redelivery means one duplicate diploma.
    if (request.idempotencyKey) {
      const existing = await this.prisma.credential.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (existing) {
        return {
          id: existing.id,
          publicId: existing.publicId,
          status: existing.status,
          deduplicated: true,
        };
      }
    }

    const template = await this.prisma.template.findFirst({
      where: { id: request.templateId, organizationId, archivedAt: null },
    });
    if (!template) throw new NotFoundException('template not found');

    const document = this.render.parseDocument(template.document);
    this.assertDataComplete(document, request.data);

    await this.usage.assertCanIssue(organizationId, 1);

    const recipient = await this.upsertRecipient(organizationId, request.recipient);

    const credential = await this.prisma.credential.create({
      data: {
        organizationId,
        publicId: publicId(),
        templateId: template.id,
        templateVersion: template.version,
        recipientId: recipient.id,
        kind: (template.kind as CredentialKind) ?? 'certificate',
        title: request.title ?? request.achievement?.name ?? template.name,
        description: request.description ?? request.achievement?.description ?? null,
        data: request.data as never,
        achievement: (request.achievement ?? {}) as never,
        tags: request.tags ?? [],
        status: 'draft',
        issuedAt: request.issuedAt ? new Date(request.issuedAt) : new Date(),
        expiresAt: request.expiresAt ? new Date(request.expiresAt) : null,
        idempotencyKey: request.idempotencyKey ?? null,
      },
    });

    const runAt = request.scheduledAt ? new Date(request.scheduledAt) : undefined;
    await this.queue.enqueueIssuance(
      {
        credentialId: credential.id,
        organizationId,
        suppressEmail: request.suppressEmail,
      },
      runAt ? { delay: Math.max(0, runAt.getTime() - Date.now()) } : {},
    );

    this.logger.log(
      `queued credential ${credential.publicId} for ${recipient.email} (org ${organizationId})`,
    );

    return {
      id: credential.id,
      publicId: credential.publicId,
      status: credential.status,
      deduplicated: false,
    };
  }

  /**
   * FR-REC-02 — de-duplicate by email, falling back to external id.
   *
   * Re-uploading an overlapping list updates the existing recipient instead of
   * creating a second row, so "bounced emails only" stays a meaningful segment
   * and a recipient's credential history stays in one place.
   */
  async upsertRecipient(
    organizationId: string,
    input: { name: string; email: string; externalId?: string },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const email = input.email.trim().toLowerCase();
    const externalId = input.externalId?.trim() || null;

    const existing = await tx.recipient.findFirst({
      where: {
        organizationId,
        OR: [{ email }, ...(externalId ? [{ externalId }] : [])],
      },
    });

    if (existing) {
      // The newest supplied name wins — a correction ("Priya Raman-Shah") is
      // far more likely than a regression, and post-issuance editing exists for
      // the cases where it is not.
      return tx.recipient.update({
        where: { id: existing.id },
        data: {
          name: input.name.trim() || existing.name,
          email: existing.email === email ? existing.email : email,
          externalId: externalId ?? existing.externalId,
        },
      });
    }

    return tx.recipient.create({
      data: { organizationId, email, name: input.name.trim(), externalId },
    });
  }

  private assertDataComplete(
    document: ReturnType<RenderService['parseDocument']>,
    data: Record<string, unknown>,
  ): void {
    const missing = requiredDataFields(document).filter((field) => {
      const value = data[field];
      return value === undefined || value === null || String(value).trim() === '';
    });

    if (missing.length > 0) {
      throw new BadRequestException({
        error: 'missing_merge_fields',
        message: `The template needs values for: ${missing.join(', ')}`,
        missing,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2 — sign, render, deliver
  // -------------------------------------------------------------------------

  async process(credentialId: string, options: { suppressEmail?: boolean } = {}): Promise<void> {
    const credential = await this.prisma.credential.findUnique({
      where: { id: credentialId },
      include: { organization: true, template: true, recipient: true, batch: true },
    });
    if (!credential) throw new NotFoundException(`credential ${credentialId} not found`);
    if (credential.status === 'revoked') return;

    const org = credential.organization;
    const origin = this.issuer.originFor(org);
    const verificationUrl = `${origin}/v/${credential.publicId}`;

    const context = this.render.buildContext({
      recipient: {
        name: credential.recipient.name,
        email: credential.recipient.email,
        externalId: credential.recipient.externalId,
      },
      credential: {
        id: credential.id,
        publicId: credential.publicId,
        title: credential.title,
        description: credential.description,
        verificationUrl,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt,
      },
      issuer: { name: org.name, url: org.website },
      batch: { name: credential.batch?.name ?? null },
      data: credential.data as Record<string, string | number | null>,
    });

    // --- Sign -------------------------------------------------------------
    // Re-signing after an edit must reuse the existing slot; a new slot would
    // orphan any revocation already published against the old one.
    const status =
      credential.statusListId && credential.statusListIndex !== null
        ? {
            statusListId: credential.statusListId,
            index: credential.statusListIndex,
            entry: await this.issuer.statusEntryFor(
              org,
              credential.statusListId,
              credential.statusListIndex,
            ),
          }
        : await this.issuer.allocateStatusEntry(org.id, org);

    const signed = await this.buildAndSign({
      org,
      credential,
      verificationUrl,
      statusEntry: status.entry,
    });

    // --- Render -----------------------------------------------------------
    const document = this.render.parseDocument(credential.template.document);
    const branding = brandingSettingsSchema.parse(org.branding ?? {});

    let rendered: Record<string, { key: string; contentType: string; degraded: boolean }> = {};
    let thumbnailKey: string | null = null;
    let renderError: string | null = null;

    try {
      rendered = await this.render.renderCredential({
        organizationId: org.id,
        credentialId: credential.id,
        document,
        context,
        brandKit: this.render.parseBrandKit(branding.brandKit),
        verificationUrl,
        formats: ['pdf', 'png'],
      });
      thumbnailKey = await this.render
        .renderThumbnail({
          organizationId: org.id,
          credentialId: credential.id,
          document,
          context,
          brandKit: this.render.parseBrandKit(branding.brandKit),
          verificationUrl,
        })
        .catch(() => null);
    } catch (err) {
      // A rendering failure must not swallow the credential. The signed,
      // verifiable document is the credential of record; the PDF is a
      // representation of it, and it can be regenerated later.
      renderError = (err as Error).message;
      this.logger.error(
        `rendering failed for ${credential.publicId}, issuing without artefacts: ${renderError}`,
      );
    }

    await this.prisma.credential.update({
      where: { id: credential.id },
      data: {
        status: 'issued',
        credentialJson: signed as never,
        credentialHash: credentialHash(signed as never),
        statusListId: status.statusListId,
        statusListIndex: status.index,
        pdfKey: rendered.pdf?.key ?? null,
        pngKey: rendered.png?.key ?? null,
        thumbnailKey,
      },
    });

    await this.events.record({
      organizationId: org.id,
      credentialId: credential.id,
      type: 'created',
      metadata: {
        templateId: credential.templateId,
        batchId: credential.batchId,
        ...(renderError ? { renderError } : {}),
        ...(rendered.pdf?.degraded ? { degradedRendering: true } : {}),
      },
    });
    if (!renderError) {
      await this.events.record({
        organizationId: org.id,
        credentialId: credential.id,
        type: 'rendered',
      });
    }

    await this.usage.recordIssuance(org.id, 1);

    if (!options.suppressEmail) {
      await this.queue.enqueueEmail({ credentialId: credential.id, organizationId: org.id });
    }

    await this.webhooks.dispatch(org.id, 'credential.issued', {
      credentialId: credential.id,
      publicId: credential.publicId,
      title: credential.title,
      status: 'issued',
      verificationUrl,
      recipient: { name: credential.recipient.name, email: credential.recipient.email },
      issuedAt: credential.issuedAt.toISOString(),
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      batchId: credential.batchId,
    });
  }

  private async buildAndSign(params: {
    org: Organization;
    credential: {
      id: string;
      publicId: string;
      title: string;
      description: string | null;
      kind: string;
      issuedAt: Date;
      expiresAt: Date | null;
      achievement: unknown;
      data: unknown;
      recipient: { name: string; email: string; externalId: string | null };
    };
    verificationUrl: string;
    statusEntry: {
      id: string;
      type: 'BitstringStatusListEntry';
      statusPurpose: 'revocation' | 'suspension';
      statusListIndex: string;
      statusListCredential: string;
    };
  }): Promise<Record<string, unknown>> {
    const { org, credential } = params;
    const did = this.issuer.didFor(org);
    const key = await this.issuer.ensureKey(org.id);
    const achievement = (credential.achievement ?? {}) as {
      name?: string;
      description?: string;
      criteriaNarrative?: string;
      criteriaUrl?: string;
      achievementType?: string;
      skills?: string[];
      image?: string;
    };

    // Merge-field values become OB3 `result` entries, so a score or a grade is
    // machine-readable to a consuming system rather than only being painted
    // onto a PDF.
    const results = Object.entries((credential.data ?? {}) as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && String(value) !== '')
      .slice(0, 24)
      .map(([name, value]) => ({ name, value: String(value) }));

    const unsigned = buildAchievementCredential({
      credentialId: credentialUrn(credential.id),
      verificationUrl: params.verificationUrl,
      issuer: {
        id: did,
        name: org.name,
        url: org.website ?? undefined,
        email: org.contactEmail ?? undefined,
        description: org.description ?? undefined,
      },
      recipient: {
        name: credential.recipient.name,
        email: credential.recipient.email,
        externalId: credential.recipient.externalId ?? undefined,
      },
      achievement: {
        name: achievement.name ?? credential.title,
        description: achievement.description ?? credential.description ?? undefined,
        criteriaNarrative: achievement.criteriaNarrative,
        criteriaUrl: achievement.criteriaUrl,
        // Certificates and badges are both AchievementCredentials; the
        // achievementType is what distinguishes them to a consumer.
        achievementType:
          achievement.achievementType ??
          (credential.kind === 'badge' ? 'Badge' : 'Certificate'),
        imageUrl: achievement.image,
        skills: achievement.skills,
      },
      issuedAt: credential.issuedAt.toISOString(),
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      status: params.statusEntry,
      results,
      evidenceUrl: params.verificationUrl,
      name: credential.title,
      description: credential.description ?? undefined,
    });

    return signDocument(unsigned as unknown as Record<string, unknown>, {
      privateKeyBytes: key.privateKeyBytes,
      verificationMethod: `${did}#${key.keyId}`,
      created: credential.issuedAt.toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // FR-ISS-05 — post-issuance editing
  // -------------------------------------------------------------------------

  /**
   * Correct one credential without touching the rest of its batch.
   *
   * The corrected credential is re-signed under the same public id and the same
   * status-list slot, so every QR code already printed, emailed or added to a
   * LinkedIn profile keeps resolving. The old signature is superseded rather
   * than revoked: revoking a credential to fix a spelling mistake would show
   * "Revoked" to anyone who checked in the meantime, which is a far worse
   * outcome than the typo.
   */
  async updateCredential(
    organizationId: string,
    credentialId: string,
    patch: CredentialPatch,
    principal?: AuthPrincipal,
  ): Promise<{ id: string; publicId: string }> {
    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, organizationId },
      include: { recipient: true, template: true },
    });
    if (!credential) throw new NotFoundException('credential not found');
    if (credential.status === 'revoked') {
      throw new BadRequestException('a revoked credential cannot be edited; reissue instead');
    }

    if (patch.templateId && patch.templateId !== credential.templateId) {
      const template = await this.prisma.template.findFirst({
        where: { id: patch.templateId, organizationId },
      });
      if (!template) throw new NotFoundException('template not found');
    }

    if (patch.recipientName || patch.recipientEmail) {
      await this.upsertRecipient(organizationId, {
        name: patch.recipientName ?? credential.recipient.name,
        email: patch.recipientEmail ?? credential.recipient.email,
        externalId: credential.recipient.externalId ?? undefined,
      });
      if (patch.recipientName) {
        await this.prisma.recipient.update({
          where: { id: credential.recipientId },
          data: { name: patch.recipientName },
        });
      }
    }

    await this.prisma.credential.update({
      where: { id: credential.id },
      data: {
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.data
          ? { data: { ...(credential.data as object), ...patch.data } as never }
          : {}),
        ...(patch.expiresAt !== undefined
          ? { expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : null }
          : {}),
        ...(patch.templateId ? { templateId: patch.templateId } : {}),
        // Back to draft only for the duration of the re-render; the public page
        // keeps serving the previous artefacts until the new ones land.
        emailStatus: patch.notify ? 'pending' : credential.emailStatus,
      },
    });

    await this.events.record({
      organizationId,
      credentialId: credential.id,
      type: 'edited',
      metadata: {
        by: principal?.label ?? 'system',
        reason: patch.reason ?? null,
        fields: Object.keys(patch).filter((k) => k !== 'reason' && k !== 'notify'),
      },
    });

    await this.queue.enqueueIssuance({
      credentialId: credential.id,
      organizationId,
      suppressEmail: !patch.notify,
    });

    await this.webhooks.dispatch(organizationId, 'credential.updated', {
      credentialId: credential.id,
      publicId: credential.publicId,
      fields: Object.keys(patch),
    });

    return { id: credential.id, publicId: credential.publicId };
  }

  // -------------------------------------------------------------------------
  // FR-ISS-06 — revocation
  // -------------------------------------------------------------------------

  async revoke(
    organizationId: string,
    credentialId: string,
    reason: string | undefined,
    principal?: AuthPrincipal,
  ): Promise<void> {
    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, organizationId },
    });
    if (!credential) throw new NotFoundException('credential not found');
    if (credential.status === 'revoked') return;

    await this.prisma.credential.update({
      where: { id: credential.id },
      data: { status: 'revoked', revokedAt: new Date(), revocationReason: reason ?? null },
    });

    if (credential.statusListId && credential.statusListIndex !== null) {
      await this.issuer.setRevoked(credential.statusListId, credential.statusListIndex, true);
    }

    await this.events.record({
      organizationId,
      credentialId: credential.id,
      type: 'revoked',
      metadata: { reason: reason ?? null, by: principal?.label ?? 'system' },
    });

    await this.webhooks.dispatch(organizationId, 'credential.revoked', {
      credentialId: credential.id,
      publicId: credential.publicId,
      reason: reason ?? null,
      revokedAt: new Date().toISOString(),
    });
  }

  /**
   * Bulk revocation.
   *
   * Status-list bits for a whole batch are flipped in one write per list, so
   * revoking ten thousand credentials is a handful of updates rather than ten
   * thousand — which is what makes "immediately reflects Revoked" true in
   * practice and not just in principle.
   */
  async revokeBatch(
    organizationId: string,
    batchId: string,
    reason: string | undefined,
    principal?: AuthPrincipal,
  ): Promise<{ revoked: number }> {
    const credentials = await this.prisma.credential.findMany({
      where: { organizationId, batchId, status: { not: 'revoked' } },
      select: { id: true, publicId: true, statusListId: true, statusListIndex: true },
    });
    if (credentials.length === 0) return { revoked: 0 };

    const now = new Date();
    await this.prisma.credential.updateMany({
      where: { id: { in: credentials.map((c) => c.id) } },
      data: { status: 'revoked', revokedAt: now, revocationReason: reason ?? null },
    });

    await this.issuer.setRevokedMany(
      credentials
        .filter((c) => c.statusListId && c.statusListIndex !== null)
        .map((c) => ({ statusListId: c.statusListId!, index: c.statusListIndex! })),
      true,
    );

    await this.events.recordMany(
      credentials.map((c) => ({
        organizationId,
        credentialId: c.id,
        type: 'revoked' as const,
        metadata: { reason: reason ?? null, batchId, by: principal?.label ?? 'system' },
      })),
    );

    await this.webhooks.dispatch(organizationId, 'credential.revoked', {
      batchId,
      count: credentials.length,
      reason: reason ?? null,
      revokedAt: now.toISOString(),
    });

    return { revoked: credentials.length };
  }

  /**
   * Materialise expiry.
   *
   * Verification derives expiry from `expiresAt` on every read, so this sweep
   * is not what makes an expired credential show as expired — it is what keeps
   * list views, analytics and webhooks consistent with that. Belt and braces,
   * on purpose: the read path must never depend on a cron job having run.
   */
  async expireDue(): Promise<number> {
    const due = await this.prisma.credential.findMany({
      where: { status: 'issued', expiresAt: { not: null, lte: new Date() } },
      select: { id: true, organizationId: true, publicId: true },
      take: 5_000,
    });
    if (due.length === 0) return 0;

    await this.prisma.credential.updateMany({
      where: { id: { in: due.map((c) => c.id) } },
      data: { status: 'expired' },
    });

    await this.events.recordMany(
      due.map((c) => ({
        organizationId: c.organizationId,
        credentialId: c.id,
        type: 'expired' as const,
      })),
    );

    for (const credential of due) {
      await this.webhooks.dispatch(credential.organizationId, 'credential.expired', {
        credentialId: credential.id,
        publicId: credential.publicId,
      });
    }

    this.logger.log(`expired ${due.length} credentials`);
    return due.length;
  }

  /** Fetch stored artefact bytes for download endpoints. */
  async artefact(
    organizationId: string,
    credentialId: string,
    format: 'pdf' | 'png',
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, organizationId },
      include: { recipient: true },
    });
    if (!credential) throw new NotFoundException('credential not found');

    const key = format === 'pdf' ? credential.pdfKey : credential.pngKey;
    if (!key) throw new NotFoundException(`no ${format} has been rendered for this credential`);

    const buffer = await this.storage.get(key);
    const extension = key.split('.').pop() ?? format;
    const safeName = credential.recipient.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    return {
      buffer,
      contentType: extension === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png',
      filename: `${safeName || 'credential'}-${credential.publicId}.${extension}`,
    };
  }
}
