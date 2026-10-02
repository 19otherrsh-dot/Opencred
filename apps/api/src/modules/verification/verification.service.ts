import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  credentialHash,
  verifyCredential,
  verifyDocument,
  type SecuredDocument,
  type StatusListCredential,
} from '@opencred/credentials';
import { brandingSettingsSchema, type VerificationResult } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { normalizePublicId } from '../../common/ids';
import { IssuerService } from '../issuer/issuer.service';
import { EventsService } from '../analytics/events.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { UsageService } from '../billing/usage.service';
import type { AuthenticatedRequest } from '../../common/request-context';

/**
 * FR-VER-01 / FR-VER-03 / FR-VER-05 — public verification.
 *
 * Three distinct answers, all served here:
 *
 *  - the human answer (the page a recipient's employer scans a QR code into),
 *  - the machine answer (`GET /v1/public/credentials/:id`, versioned JSON),
 *  - the *independent* answer (`POST /v1/public/verify`, which checks a
 *    credential document handed to us without consulting our database at all).
 *
 * The third one is the one that matters strategically. It means an OpenCred
 * credential is checkable by anybody, with any conformant verifier, without
 * our cooperation — the opposite of a closed network where the vendor's
 * continued existence is load-bearing.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issuer: IssuerService,
    private readonly events: EventsService,
    private readonly webhooks: WebhooksService,
    private readonly usage: UsageService,
  ) {}

  /** Look up a credential and produce the full verification answer. */
  async verifyByPublicId(
    rawPublicId: string,
    options: { request?: AuthenticatedRequest; recordEvent?: boolean } = {},
  ): Promise<VerificationResult & { badgeUrl: string; downloadUrl: string; thumbnailUrl: string | null }> {
    const id = normalizePublicId(rawPublicId);

    const credential = await this.prisma.credential.findUnique({
      where: { publicId: id },
      include: { organization: true, recipient: true, template: { select: { kind: true } } },
    });

    if (!credential || credential.status === 'draft') {
      // A draft is indistinguishable from a non-existent credential to the
      // public: an unissued batch must not be enumerable.
      throw new NotFoundException({
        error: 'credential_not_found',
        message: 'No credential exists with that identifier.',
      });
    }

    const org = credential.organization;
    const branding = brandingSettingsSchema.parse(org.branding ?? {});
    const origin = this.issuer.originFor(org);
    const now = new Date();

    // --- Cryptographic check ------------------------------------------------
    let signatureValid = false;
    const errors: string[] = [];

    if (credential.credentialJson) {
      const key = await this.issuer.ensureKey(org.id).catch(() => null);
      const proofResult = await verifyDocument(
        credential.credentialJson as unknown as SecuredDocument,
        // Verified against the locally held key: this endpoint must answer well
        // inside the p95 500 ms budget and must not depend on an outbound
        // fetch of our own DID document.
        key ? { publicKeyBytes: this.issuerPublicKey(key.publicKeyMultibase) } : {},
      );
      signatureValid = proofResult.verified;
      if (!proofResult.verified) errors.push(...proofResult.errors);
    } else {
      errors.push('this credential has not finished issuing');
    }

    const expired =
      credential.status === 'expired' ||
      Boolean(credential.expiresAt && credential.expiresAt.getTime() < now.getTime());
    const revoked = credential.status === 'revoked';

    if (revoked) errors.push('this credential has been revoked by the issuer');
    if (expired) errors.push('this credential has expired');

    const valid = signatureValid && !revoked && !expired;

    if (options.recordEvent !== false) {
      await this.events.record({
        organizationId: org.id,
        credentialId: credential.id,
        type: 'verified',
        request: options.request,
        metadata: { valid },
      });
      await this.usage.recordVerification(org.id);
      await this.webhooks.dispatch(org.id, 'credential.verified', {
        credentialId: credential.id,
        publicId: credential.publicId,
        valid,
      });
    }

    return {
      credentialId: credential.id,
      publicId: credential.publicId,
      status: credential.status as VerificationResult['status'],
      valid,
      kind: (credential.kind === 'badge' ? 'badge' : 'certificate') as 'badge' | 'certificate',
      checks: {
        exists: true,
        signatureValid,
        notRevoked: !revoked,
        notExpired: !expired,
        // The issuer's DID resolves within this deployment by construction;
        // an external verifier resolving it over HTTPS is the stronger check
        // and is what `POST /verify` performs.
        issuerTrusted: true,
        // Phase 2 (§9.3). Explicitly null rather than false: "we did not check"
        // and "we checked and there is none" are different claims.
        anchored: null,
      },
      issuer: {
        name: org.name,
        url: org.website,
        did: this.issuer.didFor(org),
        verified: true,
      },
      recipient: {
        name: credential.recipient.name,
        // Recipient addresses are shown only where the issuer opts in. The
        // default is off: a public page is a public page.
        email: branding.verificationPage.showRecipientEmail ? credential.recipient.email : null,
      },
      credential: {
        title: credential.title,
        description: credential.description,
        issuedAt: credential.issuedAt.toISOString(),
        expiresAt: credential.expiresAt?.toISOString() ?? null,
        revokedAt: credential.revokedAt?.toISOString() ?? null,
        revocationReason: credential.revocationReason,
      },
      errors,
      verifiedAt: now.toISOString(),
      badgeUrl: `${origin}/v1/public/credentials/${credential.publicId}/credential.json`,
      downloadUrl: `${origin}/v1/public/credentials/${credential.publicId}/download`,
      thumbnailUrl: credential.thumbnailKey
        ? `${origin}/v1/public/credentials/${credential.publicId}/thumbnail`
        : null,
    };
  }

  private issuerPublicKey(multibase: string): Uint8Array {
    return this.issuer.publicKeyBytesFromMultibase(multibase);
  }

  /** The signed Open Badges 3.0 document itself. */
  async credentialDocument(rawPublicId: string): Promise<Record<string, unknown>> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(rawPublicId) },
      select: { credentialJson: true, status: true },
    });
    if (!credential?.credentialJson || credential.status === 'draft') {
      throw new NotFoundException('no issued credential with that identifier');
    }
    return credential.credentialJson as Record<string, unknown>;
  }

  /**
   * FR-VER-05 — bulk lookup.
   *
   * Built for the actual use case: a background-check tool holding a column of
   * credential ids from candidate CVs. Capped, and it returns a row for every
   * requested id including the unknown ones, because "we have no record of
   * this" is exactly the answer that tool needs.
   */
  async verifyMany(
    publicIds: string[],
  ): Promise<Array<{ publicId: string; found: boolean; valid: boolean; status: string; title?: string; issuer?: string; issuedAt?: string }>> {
    const normalised = [...new Set(publicIds.map(normalizePublicId))].slice(0, 1_000);

    const credentials = await this.prisma.credential.findMany({
      where: { publicId: { in: normalised }, status: { not: 'draft' } },
      include: { organization: { select: { name: true } } },
    });

    const byId = new Map(credentials.map((c) => [c.publicId, c]));
    const now = Date.now();

    return normalised.map((publicId) => {
      const credential = byId.get(publicId);
      if (!credential) {
        return { publicId, found: false, valid: false, status: 'not_found' };
      }
      const expired =
        credential.status === 'expired' ||
        Boolean(credential.expiresAt && credential.expiresAt.getTime() < now);
      const valid = credential.status === 'issued' && !expired && Boolean(credential.credentialJson);
      return {
        publicId,
        found: true,
        valid,
        status: expired && credential.status === 'issued' ? 'expired' : credential.status,
        title: credential.title,
        issuer: credential.organization.name,
        issuedAt: credential.issuedAt.toISOString(),
      };
    });
  }

  /**
   * Verify a credential document supplied by the caller.
   *
   * No database lookup for the signature check — this is the offline-capable
   * path, and it deliberately works for credentials we did not issue.
   */
  async verifyDocumentPayload(
    document: SecuredDocument,
    options: { checkStatus?: boolean } = {},
  ) {
    const result = await verifyCredential(document, {
      fetchDocument: async (url) => {
        const response = await fetch(url, {
          headers: { accept: 'application/json,application/did+json' },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`DID document fetch returned ${response.status}`);
        return response.json();
      },
      ...(options.checkStatus === false
        ? {}
        : {
            fetchStatusList: async (url) => {
              const response = await fetch(url, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(5_000),
              });
              if (!response.ok) throw new Error(`status list fetch returned ${response.status}`);
              return (await response.json()) as StatusListCredential;
            },
          }),
    });

    return { ...result, hash: credentialHash(document) };
  }

  /** Branding and display settings for the public verification page. */
  async publicPageContext(rawPublicId: string) {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(rawPublicId) },
      include: { organization: true },
    });
    if (!credential) throw new NotFoundException('credential not found');

    const branding = brandingSettingsSchema.parse(credential.organization.branding ?? {});
    return {
      whiteLabel: branding.whiteLabel,
      headline: branding.verificationPage.headline,
      supportUrl: branding.verificationPage.supportUrl,
      showIssuerContact: branding.verificationPage.showIssuerContact,
      brand: {
        logo: branding.brandKit.logo,
        primary: branding.brandKit.palette.primary,
      },
      issuerContact: branding.verificationPage.showIssuerContact
        ? credential.organization.contactEmail
        : null,
    };
  }

  async recordEvent(
    rawPublicId: string,
    type: 'viewed' | 'downloaded' | 'shared' | 'linkedin_added' | 'wallet_added' | 'email_opened',
    request?: AuthenticatedRequest,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(rawPublicId) },
      select: { id: true, organizationId: true, publicId: true },
    });
    if (!credential) return;

    await this.events.record({
      organizationId: credential.organizationId,
      credentialId: credential.id,
      type,
      request,
      metadata,
    });

    if (type === 'viewed' || type === 'downloaded') {
      await this.webhooks.dispatch(
        credential.organizationId,
        type === 'viewed' ? 'credential.viewed' : 'credential.downloaded',
        { credentialId: credential.id, publicId: credential.publicId },
      );
    }
  }
}
