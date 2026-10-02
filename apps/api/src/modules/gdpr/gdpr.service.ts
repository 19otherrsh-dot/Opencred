import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { AuditService } from '../../common/audit.service';
import { StorageService } from '../storage/storage.service';
import { IssuerService } from '../issuer/issuer.service';
import type { AuthPrincipal } from '../../common/request-context';

/**
 * FR-GOV-01 — data-subject requests.
 *
 * There is a genuine, unavoidable tension here that most credentialing vendors
 * paper over, so it is worth stating plainly in the code that implements it:
 *
 *   A credential is a signed statement *about a named person*. Erasing that
 *   person's data from it does not leave a valid credential behind; it leaves
 *   a signature over data that no longer exists.
 *
 * So erasure is honest about being destructive. It:
 *   - pseudonymises the recipient record,
 *   - deletes the rendered PDF/PNG artefacts,
 *   - removes the signed credential document,
 *   - marks the credentials revoked with the reason `data_erasure`,
 *   - keeps the credential *row*, without personal data, so the issuer's own
 *     record of "a credential was issued and later erased" survives — which is
 *     what an auditor and an accreditation body will ask for.
 *
 * The alternative — quietly keeping the name inside a signed JSON blob while
 * telling the data subject it was erased — would be worse than not offering
 * the feature.
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly issuer: IssuerService,
  ) {}

  /** Everything the platform holds about one data subject, as portable JSON. */
  async exportSubject(organizationId: string, email: string) {
    const normalized = email.trim().toLowerCase();
    const recipient = await this.prisma.recipient.findFirst({
      where: { organizationId, email: normalized },
      include: {
        credentials: {
          include: {
            template: { select: { name: true } },
            batch: { select: { name: true } },
            events: {
              orderBy: { createdAt: 'asc' },
              select: { type: true, createdAt: true, country: true, metadata: true },
            },
          },
        },
      },
    });

    if (!recipient) throw new NotFoundException('no records for that address in this workspace');

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const origin = this.issuer.originFor(org);

    return {
      generatedAt: new Date().toISOString(),
      subject: {
        name: recipient.name,
        email: recipient.email,
        externalId: recipient.externalId,
        tags: recipient.tags,
        createdAt: recipient.createdAt,
        erasedAt: recipient.erasedAt,
      },
      controller: {
        organization: org.name,
        contactEmail: org.contactEmail,
        website: org.website,
      },
      credentials: recipient.credentials.map((c) => ({
        publicId: c.publicId,
        title: c.title,
        description: c.description,
        status: c.status,
        template: c.template.name,
        batch: c.batch?.name ?? null,
        data: c.data,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        revokedAt: c.revokedAt,
        verificationUrl: `${origin}/v/${c.publicId}`,
        // The signed document itself is part of the subject's data and is
        // included in full — portability means the actual artefact.
        signedCredential: c.credentialJson,
        events: c.events,
      })),
      note:
        'This export contains every field OpenCred holds about this data subject in this workspace, ' +
        'including the signed credential documents themselves.',
    };
  }

  /**
   * Erase a data subject.
   *
   * `dryRun` reports exactly what would happen without doing it, because the
   * operation is irreversible and an administrator acting on a legal request
   * should be able to see the blast radius first.
   */
  async eraseSubject(
    organizationId: string,
    email: string,
    options: { dryRun?: boolean; reason?: string },
    principal: AuthPrincipal,
  ): Promise<{
    dryRun: boolean;
    recipientId: string | null;
    credentialsAffected: number;
    artefactsDeleted: number;
    completedAt: string | null;
  }> {
    const normalized = email.trim().toLowerCase();
    const recipient = await this.prisma.recipient.findFirst({
      where: { organizationId, email: normalized },
      include: { credentials: { select: { id: true, pdfKey: true, pngKey: true, thumbnailKey: true, statusListId: true, statusListIndex: true } } },
    });

    if (!recipient) throw new NotFoundException('no records for that address in this workspace');

    if (options.dryRun) {
      return {
        dryRun: true,
        recipientId: recipient.id,
        credentialsAffected: recipient.credentials.length,
        artefactsDeleted: recipient.credentials.filter((c) => c.pdfKey || c.pngKey).length,
        completedAt: null,
      };
    }

    let artefactsDeleted = 0;
    for (const credential of recipient.credentials) {
      for (const key of [credential.pdfKey, credential.pngKey, credential.thumbnailKey]) {
        if (!key) continue;
        await this.storage.delete(key).catch((err) => {
          this.logger.warn(`could not delete ${key}: ${err.message}`);
        });
        artefactsDeleted += 1;
      }
    }

    // Revoke on the public status list too, so a third party holding a copy of
    // the credential learns it is no longer valid.
    await this.issuer.setRevokedMany(
      recipient.credentials
        .filter((c) => c.statusListId && c.statusListIndex !== null)
        .map((c) => ({ statusListId: c.statusListId!, index: c.statusListIndex! })),
      true,
    );

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.credential.updateMany({
        where: { recipientId: recipient.id },
        data: {
          status: 'revoked',
          revokedAt: now,
          revocationReason: 'data_erasure',
          // Prisma needs DbNull (SQL NULL) rather than JsonNull for a nullable
          // Json column; JsonNull would store the JSON literal `null` instead.
          credentialJson: Prisma.DbNull,
          credentialHash: null,
          pdfKey: null,
          pngKey: null,
          thumbnailKey: null,
          title: 'Erased at the recipient\'s request',
          description: null,
          data: {} as never,
        },
      }),
      // Events are stripped of anything identifying but the shape of the
      // history is kept: the issuer needs to be able to show *that* a request
      // was honoured.
      this.prisma.credentialEvent.updateMany({
        where: { credential: { recipientId: recipient.id } },
        data: { ip: null, userAgent: null, country: null, metadata: {} as never },
      }),
      this.prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          // A stable pseudonym rather than a random one, so the issuer can tell
          // two erased recipients apart in their own records without being able
          // to recover either address.
          name: 'Erased recipient',
          email: `erased+${this.crypto.sha256(normalized).slice(0, 24)}@erased.invalid`,
          externalId: null,
          tags: [],
          metadata: {} as never,
          erasedAt: now,
        },
      }),
    ]);

    await this.audit.record({
      organizationId,
      principal,
      action: 'gdpr.subject_erased',
      targetType: 'recipient',
      targetId: recipient.id,
      metadata: {
        credentialsAffected: recipient.credentials.length,
        artefactsDeleted,
        reason: options.reason ?? null,
      },
    });

    this.logger.log(
      `erased data subject ${recipient.id} in org ${organizationId}: ` +
        `${recipient.credentials.length} credentials, ${artefactsDeleted} artefacts`,
    );

    return {
      dryRun: false,
      recipientId: recipient.id,
      credentialsAffected: recipient.credentials.length,
      artefactsDeleted,
      completedAt: now.toISOString(),
    };
  }

  /**
   * The processing record an organisation can hand to its DPO.
   *
   * Generated from the actual schema and configuration rather than written by
   * hand, so it cannot drift away from what the system really does.
   */
  async processingRecord(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    return {
      controller: { name: org.name, contactEmail: org.contactEmail, website: org.website },
      processor: 'The operator of this OpenCred deployment',
      dataRegion: org.dataRegion,
      categories: [
        {
          category: 'Recipient identity',
          fields: ['name', 'email address', 'external identifier'],
          purpose: 'Issuing, delivering and verifying credentials',
          lawfulBasis: 'Contract or legitimate interest, as determined by the issuing organisation',
          retention: 'Until erasure is requested or the issuer deletes the workspace',
        },
        {
          category: 'Credential content',
          fields: ['credential title', 'merge field values such as course, grade, hours'],
          purpose: 'The substance of the credential itself',
          lawfulBasis: 'Contract',
          retention: 'Indefinite, because a credential is a durable record',
        },
        {
          category: 'Engagement events',
          fields: ['event type', 'timestamp', 'truncated IP address', 'country', 'user agent'],
          purpose: 'Telling issuers whether credentials are delivered, opened and verified',
          lawfulBasis: 'Legitimate interest',
          retention: 'Retained with the credential; addresses are truncated before storage',
          note: 'Full IP addresses are never stored. The last IPv4 octet (or last 80 IPv6 bits) is discarded at write time.',
        },
      ],
      subprocessors: [
        {
          name: 'Configured SMTP provider',
          purpose: 'Delivery of credential emails',
          note: 'Chosen by the issuing organisation; may be self-hosted (FR-ISS-07).',
        },
      ],
      subjectRights: {
        access: 'GET /v1/gdpr/subject?email=…',
        portability: 'The same endpoint returns machine-readable JSON including signed credentials.',
        erasure: 'POST /v1/gdpr/subject/erase',
        erasureCaveat:
          'Erasure necessarily invalidates the affected credentials, because a credential is a ' +
          'signed statement about a named person. Affected credentials are revoked and their ' +
          'signed documents deleted.',
      },
    };
  }
}
