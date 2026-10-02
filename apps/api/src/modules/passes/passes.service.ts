import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  createGoogleWalletSaveUrl,
  createPkPass,
  isApplePassConfigured,
  isGoogleWalletConfigured,
  NodeOpenSslPassSigner,
  type ApplePassConfig,
  type CredentialPassInput,
  type GoogleWalletConfig,
  type PassImages,
} from '@opencred/wallet';
import { brandingSettingsSchema } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { normalizePublicId } from '../../common/ids';
import { StorageService } from '../storage/storage.service';
import { IssuerService } from '../issuer/issuer.service';
import { loadConfig } from '../../config';

/**
 * FR-STD-04 — "Add to Apple Wallet" and "Add to Google Wallet".
 *
 * The two platforms are not symmetric and the code should not pretend they are.
 *
 * Google is a signed JWT: we can generate a working save link from a service
 * account alone, so the endpoint returns a redirect and there is nothing to
 * store. Apple needs a `.pkpass` signed with a Pass Type ID certificate that
 * only Apple issues, and the signature is PKCS#7, which Node cannot produce
 * without OpenSSL. Where the deployment has not been enrolled, the endpoint
 * says so plainly rather than handing back a file that fails to install with no
 * explanation — which is what a half-built version of this feature does.
 */
@Injectable()
export class PassesService {
  private readonly logger = new Logger(PassesService.name);
  private readonly config = loadConfig();

  /** Pass images are small and rarely change; re-fetching per request is waste. */
  private readonly imageCache = new Map<string, PassImages>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly issuer: IssuerService,
  ) {}

  /** Which wallets this deployment can actually issue passes for. */
  availability(): { apple: boolean; google: boolean } {
    return {
      apple: isApplePassConfigured(this.appleConfigWithoutImages()),
      google: isGoogleWalletConfigured(this.googleConfig()),
    };
  }

  async googleSaveUrl(rawPublicId: string): Promise<string> {
    const config = this.googleConfig();
    if (!isGoogleWalletConfigured(config)) {
      throw new ServiceUnavailableException({
        error: 'wallet_not_configured',
        message: 'This deployment has no Google Wallet issuer configured.',
      });
    }

    return createGoogleWalletSaveUrl(config, await this.passInput(rawPublicId));
  }

  async applePass(rawPublicId: string): Promise<{ bundle: Buffer; filename: string }> {
    const credential = await this.passInput(rawPublicId);
    const config = await this.appleConfig(credential.organizationId);

    if (!isApplePassConfigured(config)) {
      throw new ServiceUnavailableException({
        error: 'wallet_not_configured',
        message: 'This deployment has no Apple Pass Type ID certificate configured.',
      });
    }

    const signer = new NodeOpenSslPassSigner({
      certificatePath: this.config.WALLET_APPLE_CERT_PATH,
      keyPath: this.config.WALLET_APPLE_KEY_PATH,
      wwdrPath: this.config.WALLET_APPLE_WWDR_PATH,
      keyPassphrase: this.config.WALLET_APPLE_KEY_PASSPHRASE || undefined,
      opensslPath: this.config.WALLET_APPLE_OPENSSL_PATH || undefined,
    });

    const result = await createPkPass(config, credential, { signer });

    // Belt and braces. An unsigned .pkpass installs nowhere, and shipping one
    // produces a support ticket that reads "nothing happens when I tap it".
    if (!result.signed) {
      throw new ServiceUnavailableException({
        error: 'wallet_signing_failed',
        message: 'The pass could not be signed.',
      });
    }

    return { bundle: result.bundle, filename: `${credential.publicId}.pkpass` };
  }

  // --- shared credential shaping --------------------------------------------

  private async passInput(
    rawPublicId: string,
  ): Promise<CredentialPassInput & { organizationId: string }> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(rawPublicId) },
      include: { organization: true, recipient: true },
    });

    // A draft is not a credential yet, and must not be enumerable — the same
    // rule the verification endpoints follow.
    if (!credential || credential.status === 'draft') {
      throw new NotFoundException({ error: 'not_found', message: 'credential not found' });
    }

    const branding = brandingSettingsSchema.parse(credential.organization.branding ?? {});
    // The issuer's own origin when they have a verified custom domain, so the
    // QR code on the pass matches the one on the certificate.
    const origin = this.issuer.originFor(credential.organization).replace(/\/$/, '');

    // Merge-field values become pass rows. Only strings and numbers: a nested
    // object rendered as "[object Object]" on someone's lock screen is worse
    // than not showing the field.
    const details = Object.entries((credential.data ?? {}) as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .slice(0, 4)
      .map(([key, value]) => ({ label: humanise(key), value: String(value) }));

    return {
      organizationId: credential.organizationId,
      publicId: credential.publicId,
      title: credential.title,
      description: credential.description,
      recipientName: credential.recipient.name,
      issuerName: credential.organization.name,
      issuedAt: credential.issuedAt.toISOString(),
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      status: credential.status as CredentialPassInput['status'],
      verificationUrl: `${origin}/v/${credential.publicId}`,
      // Google fetches this over the network from its own servers, so it must
      // be an absolute, publicly reachable URL — a data URI or an
      // `opencred://` reference will not do. The public brand-logo endpoint
      // exists precisely to give Google something to fetch.
      logoUrl: publicLogoUrl(branding.brandKit.logo, origin, credential.publicId),
      heroImageUrl: null,
      backgroundColor: branding.brandKit.palette.primary,
      details,
    };
  }

  // --- configuration ---------------------------------------------------------

  private googleConfig(): Partial<GoogleWalletConfig> {
    const issuerId = this.config.WALLET_GOOGLE_ISSUER_ID;
    return {
      issuerEmail: this.config.WALLET_GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // A service-account key pasted through an environment variable arrives
      // with literal backslash-n rather than newlines, and OpenSSL rejects it
      // with an error that points nowhere useful.
      privateKey: this.config.WALLET_GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      issuerId,
      classId: issuerId ? `${issuerId}.${this.config.WALLET_GOOGLE_CLASS_SUFFIX}` : '',
      origins: [this.config.PUBLIC_URL],
    };
  }

  /** Everything but the images, which is enough to answer "is this on?". */
  private appleConfigWithoutImages(): Partial<ApplePassConfig> {
    return {
      passTypeIdentifier: this.config.WALLET_APPLE_PASS_TYPE_ID,
      teamIdentifier: this.config.WALLET_APPLE_TEAM_ID,
      organizationName: 'OpenCred',
      images: this.config.WALLET_APPLE_CERT_PATH
        ? ({ 'icon.png': Buffer.alloc(1) } as PassImages)
        : ({} as PassImages),
    };
  }

  private async appleConfig(organizationId: string): Promise<Partial<ApplePassConfig>> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, branding: true },
    });
    const branding = brandingSettingsSchema.parse(organization?.branding ?? {});

    return {
      passTypeIdentifier: this.config.WALLET_APPLE_PASS_TYPE_ID,
      teamIdentifier: this.config.WALLET_APPLE_TEAM_ID,
      // Wallet shows this in the pass list, so it must be the issuer the
      // recipient recognises, not the platform running the instance.
      organizationName: organization?.name ?? 'OpenCred',
      backgroundColor: branding.brandKit.palette.primary,
      images: await this.passImages(organizationId, branding.brandKit.logo),
    };
  }

  /**
   * Apple embeds images in the bundle rather than fetching them, so they have
   * to be bytes. A logo the issuer uploaded is used when we have it; otherwise
   * a generated placeholder, because Wallet silently rejects a pass with no
   * `icon.png` and an issuer who has not uploaded a logo should still get a
   * working pass.
   */
  private async passImages(organizationId: string, logo: string | null): Promise<PassImages> {
    const cacheKey = `${organizationId}:${logo ?? ''}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) return cached;

    const icon = (await this.brandLogoPng(organizationId, logo)) ?? FALLBACK_ICON_PNG;

    const images: PassImages = {
      'icon.png': icon,
      'icon@2x.png': icon,
      'logo.png': icon,
      'logo@2x.png': icon,
    };
    this.imageCache.set(cacheKey, images);
    return images;
  }

  /**
   * Fetch the issuer's brand logo as PNG bytes, or null.
   *
   * Brand references are stored as `opencred://asset/<storage key>`, the same
   * indirection the renderer resolves. SVG is excluded rather than converted:
   * Wallet only accepts raster images, and a rasteriser is not worth pulling in
   * for a pass icon when the fallback is already acceptable.
   */
  async brandLogoPng(organizationId: string, logo: string | null): Promise<Buffer | null> {
    if (!logo?.startsWith('opencred://asset/')) return null;

    const key = logo.slice('opencred://asset/'.length);
    if (!/\.(png|jpg|jpeg)$/i.test(key)) return null;

    try {
      const asset = await this.prisma.asset.findFirst({
        where: { organizationId, key },
        select: { id: true },
      });
      // Scoped to the organisation so a crafted branding value cannot read
      // another tenant's assets out of the object store.
      if (!asset) return null;
      return await this.storage.get(key);
    } catch (error) {
      this.logger.warn(
        `Falling back to the default pass icon for ${organizationId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** The org and branding behind a credential, for the public logo endpoint. */
  async brandLogoForCredential(
    rawPublicId: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(rawPublicId) },
      select: { status: true, organizationId: true, organization: { select: { branding: true } } },
    });
    if (!credential || credential.status === 'draft') return null;

    const branding = brandingSettingsSchema.parse(credential.organization.branding ?? {});
    const buffer = await this.brandLogoPng(credential.organizationId, branding.brandKit.logo);
    return buffer ? { buffer, contentType: 'image/png' } : null;
  }
}

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function publicLogoUrl(
  reference: string | null | undefined,
  origin: string,
  publicId: string,
): string | null {
  if (!reference) return null;
  if (/^https?:\/\//i.test(reference)) return reference;
  // Raster assets only; Wallet will not render an SVG and Google will simply
  // show no logo rather than tell us it could not.
  if (/^opencred:\/\/asset\/.+\.(png|jpe?g)$/i.test(reference)) {
    return `${origin}/v1/public/credentials/${publicId}/brand-logo.png`;
  }
  return null;
}

/**
 * A 29×29 solid PNG, so a pass without an issuer logo still installs.
 *
 * Inlined rather than read from disk: this is the fallback path, and a fallback
 * that itself depends on a file being present is not a fallback.
 */
const FALLBACK_ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAALElEQVR42u3NMQkAAAgAMItYyfy20RaC' +
    'sGP3IqvnWkilUqlUKpVKpVLpw3QBFr1rPDdePjsAAAAASUVORK5CYII=',
  'base64',
);
