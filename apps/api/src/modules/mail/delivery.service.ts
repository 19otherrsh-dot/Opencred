import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { brandingSettingsSchema } from '@opencred/schema';
import { buildMergeContext } from '@opencred/renderer';
import { PrismaService } from '../../common/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IssuerService } from '../issuer/issuer.service';
import { EventsService } from '../analytics/events.service';
import { CredentialsService } from '../credentials/credentials.service';
import { MailService, type OrgSmtpSettings } from './mail.service';

/**
 * FR-DEL-01 — credential delivery.
 *
 * Attaching the PDF *and* linking the verification page is deliberate. The
 * attachment is what recipients actually want (they forward it, they print it);
 * the link is what makes the credential checkable and what generates the
 * verification events issuers care about. Vendors that send only a link get
 * complaints; vendors that send only a file produce unverifiable PDFs.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly issuer: IssuerService,
    private readonly events: EventsService,
    private readonly credentials: CredentialsService,
  ) {}

  async deliver(credentialId: string): Promise<void> {
    const credential = await this.prisma.credential.findUnique({
      where: { id: credentialId },
      include: { organization: true, recipient: true, batch: true },
    });
    if (!credential) throw new NotFoundException(`credential ${credentialId} not found`);

    if (credential.status !== 'issued') {
      this.logger.debug(`skipping delivery for ${credential.publicId}: status ${credential.status}`);
      return;
    }
    if (credential.recipient.erasedAt) {
      this.logger.debug(`skipping delivery for ${credential.publicId}: recipient erased`);
      return;
    }

    const org = credential.organization;
    const branding = brandingSettingsSchema.parse(org.branding ?? {});
    const origin = this.issuer.originFor(org);
    const verificationUrl = `${origin}/v/${credential.publicId}`;

    const context = buildMergeContext({
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

    // Attach the rendered file when it exists and is small enough to be
    // deliverable. Above the threshold the email links instead — a bounced
    // 12 MB attachment helps nobody.
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    const artefactKey = credential.kind === 'badge' ? credential.pngKey : credential.pdfKey;

    if (artefactKey) {
      try {
        const buffer = await this.storage.get(artefactKey);
        if (buffer.length <= 5 * 1024 * 1024) {
          const extension = artefactKey.split('.').pop() ?? 'pdf';
          const safeName =
            credential.recipient.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') ||
            'credential';
          attachments.push({
            filename: `${safeName}-${credential.publicId}.${extension}`,
            content: buffer,
            contentType:
              extension === 'svg'
                ? 'image/svg+xml'
                : extension === 'png'
                  ? 'image/png'
                  : 'application/pdf',
          });
        } else {
          this.logger.warn(
            `credential ${credential.publicId} artefact is ${Math.round(buffer.length / 1024)}KB; sending a link instead`,
          );
        }
      } catch (err) {
        this.logger.warn(`could not attach artefact for ${credential.publicId}: ${(err as Error).message}`);
      }
    }

    const smtp = this.smtpSettings(org.emailSettings);

    try {
      await this.mail.sendCredentialEmail({
        organizationId: org.id,
        smtp,
        branding,
        to: credential.recipient.email,
        context,
        verificationUrl,
        downloadUrl: `${origin}/v1/public/credentials/${credential.publicId}/download`,
        linkedInUrl: this.credentials.linkedInAddUrl({
          origin,
          name: credential.title,
          organizationName: org.name,
          issuedAt: credential.issuedAt,
          expiresAt: credential.expiresAt,
          publicId: credential.publicId,
        }),
        walletUrl: `${origin}/wallet`,
        attachments,
        trackingPixelUrl: `${origin}/v1/public/t/open/${credential.publicId}.gif`,
      });

      await this.prisma.credential.update({
        where: { id: credential.id },
        data: { emailStatus: 'sent', emailSentAt: new Date(), emailError: null },
      });
      await this.events.record({
        organizationId: org.id,
        credentialId: credential.id,
        type: 'email_sent',
        metadata: { to: credential.recipient.email, attached: attachments.length > 0 },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await this.prisma.credential.update({
        where: { id: credential.id },
        data: { emailStatus: 'failed', emailError: message },
      });
      await this.events.record({
        organizationId: org.id,
        credentialId: credential.id,
        type: 'email_failed',
        metadata: { error: message },
      });
      // Rethrown so BullMQ retries with backoff; a transient SMTP failure
      // should not silently drop a recipient's credential.
      throw err;
    }
  }

  private smtpSettings(raw: unknown): OrgSmtpSettings | null {
    const settings = (raw ?? {}) as Record<string, unknown>;
    if (!settings.enabled || !settings.host) return null;
    return {
      enabled: true,
      host: String(settings.host),
      port: Number(settings.port ?? 587),
      secure: Boolean(settings.secure),
      user: settings.user ? String(settings.user) : undefined,
      passwordEncrypted: settings.passwordEncrypted ? String(settings.passwordEncrypted) : undefined,
      from: String(settings.from ?? ''),
    };
  }
}
