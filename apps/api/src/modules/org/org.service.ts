import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as dns } from 'node:dns';
import {
  brandingSettingsSchema,
  hostnameSchema,
  planFor,
  roleSchema,
  type Role,
} from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { AuditService } from '../../common/audit.service';
import { randomToken, uuid } from '../../common/ids';
import { loadConfig } from '../../config';
import { IssuerService } from '../issuer/issuer.service';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import type { AuthPrincipal } from '../../common/request-context';

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly issuer: IssuerService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
  ) {}

  async get(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { subscription: true, _count: { select: { memberships: true, credentials: true } } },
    });

    const plan = planFor(org.plan);
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      description: org.description,
      website: org.website,
      contactEmail: org.contactEmail,
      plan: plan.id,
      planName: plan.name,
      features: plan.features,
      dataRegion: org.dataRegion,
      did: this.issuer.didFor(org),
      didDocumentUrl: `${this.issuer.originFor(org)}/v1/public/issuers/${org.slug}/did.json`,
      verificationOrigin: this.issuer.originFor(org),
      memberCount: org._count.memberships,
      credentialCount: org._count.credentials,
      createdAt: org.createdAt,
      edition: this.config.edition,
    };
  }

  async update(
    organizationId: string,
    input: {
      name?: string;
      description?: string | null;
      website?: string | null;
      contactEmail?: string | null;
    },
    principal: AuthPrincipal,
  ) {
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
    });
    await this.audit.record({
      organizationId,
      principal,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { fields: Object.keys(input) },
    });
    return org;
  }

  // --- Branding (FR-DES-04, FR-BRD-01, FR-BRD-02) ---------------------------

  async branding(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const branding = brandingSettingsSchema.parse(org.branding ?? {});
    const plan = planFor(org.plan);

    return {
      ...branding,
      // Surfaced so the UI can explain a disabled control rather than just
      // greying it out.
      available: {
        customDomain: plan.features.customDomain,
        whiteLabel: plan.features.fullWhiteLabel,
      },
      dnsInstructions: branding.customDomain
        ? this.dnsInstructions(branding.customDomain, org.slug)
        : null,
    };
  }

  async updateBranding(
    organizationId: string,
    input: unknown,
    principal: AuthPrincipal,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const plan = planFor(org.plan);
    const current = brandingSettingsSchema.parse(org.branding ?? {});
    const incoming = brandingSettingsSchema.parse({ ...current, ...(input as object) });

    if (incoming.whiteLabel && !plan.features.fullWhiteLabel) {
      throw new ForbiddenException({
        error: 'plan_required',
        message: `Full white-labelling is available on Cloud Scale and above; you are on ${plan.name}.`,
      });
    }

    if (incoming.customDomain && !plan.features.customDomain) {
      throw new ForbiddenException({
        error: 'plan_required',
        message:
          `A custom verification domain is included on every paid tier; you are on ${plan.name}. ` +
          'Self-hosting the Community Edition also includes it.',
      });
    }

    // Changing the domain invalidates the previous verification — and with it
    // the issuer's DID, so this is not a cosmetic setting.
    if (incoming.customDomain !== current.customDomain) {
      if (incoming.customDomain) hostnameSchema.parse(incoming.customDomain);
      incoming.customDomainVerifiedAt = null;
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { branding: incoming as never },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'organization.branding_updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        customDomain: incoming.customDomain,
        whiteLabel: incoming.whiteLabel,
      },
    });

    return this.branding(organizationId);
  }

  private dnsInstructions(domain: string, slug: string) {
    const target = new URL(this.config.PUBLIC_URL).hostname;
    return {
      records: [
        {
          type: 'CNAME',
          name: domain,
          value: target,
          purpose: 'Routes verification pages on your domain to OpenCred.',
        },
        {
          type: 'TXT',
          name: `_opencred.${domain}`,
          value: `opencred-verification=${slug}`,
          purpose: 'Proves you control this domain before we issue under it.',
        },
      ],
      note:
        'Verification is required before credentials are issued under this domain, because the ' +
        'domain becomes part of the issuer DID that recipients and employers rely on.',
    };
  }

  /**
   * FR-BRD-01 — confirm a custom domain.
   *
   * Both records are checked: the TXT record proves control, and the CNAME
   * proves the domain actually routes here. Accepting one without the other
   * would let an issuer publish a DID at a hostname that does not serve their
   * DID document, which is a broken credential rather than a branding problem.
   */
  async verifyCustomDomain(organizationId: string, principal: AuthPrincipal) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const branding = brandingSettingsSchema.parse(org.branding ?? {});
    if (!branding.customDomain) throw new BadRequestException('no custom domain configured');

    const expected = `opencred-verification=${org.slug}`;
    const target = new URL(this.config.PUBLIC_URL).hostname;

    const checks = { txt: false, cname: false, errors: [] as string[] };

    try {
      const records = await dns.resolveTxt(`_opencred.${branding.customDomain}`);
      checks.txt = records.some((chunks) => chunks.join('').trim() === expected);
      if (!checks.txt) checks.errors.push(`TXT record not found or does not equal "${expected}"`);
    } catch (err) {
      checks.errors.push(`TXT lookup failed: ${(err as Error).message}`);
    }

    try {
      const cname = await dns.resolveCname(branding.customDomain);
      checks.cname = cname.some((c) => c.replace(/\.$/, '') === target);
      if (!checks.cname) checks.errors.push(`CNAME does not point at ${target}`);
    } catch (err) {
      checks.errors.push(`CNAME lookup failed: ${(err as Error).message}`);
    }

    const verified = checks.txt && checks.cname;
    if (verified) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          branding: {
            ...branding,
            customDomainVerifiedAt: new Date().toISOString(),
          } as never,
        },
      });
      await this.audit.record({
        organizationId,
        principal,
        action: 'organization.domain_verified',
        metadata: { domain: branding.customDomain },
      });
    }

    return { verified, domain: branding.customDomain, checks };
  }

  // --- SMTP (FR-ISS-07) -----------------------------------------------------

  async emailSettings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const settings = (org.emailSettings ?? {}) as Record<string, unknown>;
    return {
      enabled: Boolean(settings.enabled),
      host: settings.host ?? '',
      port: settings.port ?? 587,
      secure: Boolean(settings.secure),
      user: settings.user ?? '',
      from: settings.from ?? '',
      // The password is never returned, only whether one is stored.
      hasPassword: Boolean(settings.passwordEncrypted),
    };
  }

  async updateEmailSettings(
    organizationId: string,
    input: {
      enabled: boolean;
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      password?: string;
      from: string;
    },
    principal: AuthPrincipal,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const existing = (org.emailSettings ?? {}) as Record<string, unknown>;

    const settings = {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user ?? '',
      from: input.from,
      // An omitted password means "keep the stored one", so an admin can edit
      // the host without re-entering a secret they may not have.
      passwordEncrypted: input.password
        ? this.crypto.encrypt(input.password)
        : (existing.passwordEncrypted ?? null),
    };

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { emailSettings: settings as never },
    });
    this.mail.invalidateOrgTransport(organizationId);

    await this.audit.record({
      organizationId,
      principal,
      action: 'organization.smtp_updated',
      metadata: { host: input.host, enabled: input.enabled },
    });

    const verification = input.enabled
      ? await this.mail.verifyOrgSmtp(settings as never)
      : { ok: true };

    return { ...(await this.emailSettings(organizationId)), verification };
  }

  // --- Members (FR-ID-02) ---------------------------------------------------

  async members(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role as Role,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      lastLoginAt: m.user.lastLoginAt,
      pending: !m.acceptedAt,
    }));
  }

  async invite(
    organizationId: string,
    input: { email: string; name?: string; role: Role },
    principal: AuthPrincipal,
  ) {
    const email = input.email.trim().toLowerCase();
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const plan = planFor(org.plan);
    if (plan.features.seats !== null) {
      const count = await this.prisma.membership.count({ where: { organizationId } });
      if (count >= plan.features.seats) {
        throw new ForbiddenException({
          error: 'seat_limit_reached',
          message: `${plan.name} includes ${plan.features.seats} seats.`,
        });
      }
    }

    const user =
      (await this.prisma.user.findUnique({ where: { email } })) ??
      (await this.prisma.user.create({
        data: { email, name: input.name ?? email.split('@')[0] },
      }));

    const existing = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (existing) throw new ConflictException('that person is already a member');

    const membership = await this.prisma.membership.create({
      data: {
        userId: user.id,
        organizationId,
        role: input.role,
        invitedById: principal.type === 'user' ? principal.id : null,
        invitedAt: new Date(),
        // Invitees who already have an account join immediately; new accounts
        // are activated when they set a password through the invite link.
        acceptedAt: user.passwordHash ? new Date() : null,
      },
    });

    const token = randomToken(32);
    await this.prisma.singleUseToken.create({
      data: {
        purpose: 'reset_password',
        email,
        tokenHash: this.crypto.hashToken(token),
        organizationId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      },
    });

    await this.mail
      .sendSystemEmail({
        to: email,
        subject: `You have been invited to ${org.name} on OpenCred`,
        heading: `Join ${org.name}`,
        body: `${principal.label} invited you as ${input.role}. Set a password to accept.`,
        actionLabel: 'Accept invitation',
        actionUrl: `${this.config.PUBLIC_URL}/accept-invite?token=${encodeURIComponent(token)}`,
      })
      .catch((err) => this.logger.warn(`invite email not sent: ${err.message}`));

    await this.audit.record({
      organizationId,
      principal,
      action: 'member.invited',
      targetType: 'user',
      targetId: user.id,
      metadata: { email, role: input.role },
    });

    return { id: membership.id, email, role: input.role, pending: !membership.acceptedAt };
  }

  async setRole(
    organizationId: string,
    membershipId: string,
    role: Role,
    principal: AuthPrincipal,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException('member not found');

    // An organisation without an owner cannot be recovered through the UI, so
    // demoting the last one is refused rather than warned about.
    if (membership.role === 'owner' && role !== 'owner') {
      const owners = await this.prisma.membership.count({
        where: { organizationId, role: 'owner' },
      });
      if (owners <= 1) {
        throw new BadRequestException('the workspace must keep at least one owner');
      }
    }

    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role: roleSchema.parse(role) },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'member.role_changed',
      targetType: 'user',
      targetId: membership.userId,
      metadata: { from: membership.role, to: role },
    });

    return { id: membershipId, role };
  }

  async removeMember(organizationId: string, membershipId: string, principal: AuthPrincipal) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException('member not found');

    if (membership.role === 'owner') {
      const owners = await this.prisma.membership.count({
        where: { organizationId, role: 'owner' },
      });
      if (owners <= 1) throw new BadRequestException('the workspace must keep at least one owner');
    }

    await this.prisma.membership.delete({ where: { id: membershipId } });
    await this.audit.record({
      organizationId,
      principal,
      action: 'member.removed',
      targetType: 'user',
      targetId: membership.userId,
    });

    return { removed: true };
  }

  // --- API keys (FR-INT-01) -------------------------------------------------

  async apiKeys(organizationId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        role: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return keys;
  }

  /**
   * Mint an API key.
   *
   * The plaintext is returned exactly once and only the hash is stored. That
   * costs a little support friction ("I lost my key") and buys the property
   * that a database dump does not hand out working credentials.
   */
  async createApiKey(
    organizationId: string,
    input: { name: string; role: Role; expiresInDays?: number },
    principal: AuthPrincipal,
  ) {
    const secret = `ock_${this.config.isProduction ? 'live' : 'test'}_${randomToken(24)}`;
    const prefix = secret.slice(0, 16);

    const key = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: input.name,
        prefix,
        keyHash: this.crypto.hashToken(secret),
        role: input.role,
        createdById: principal.type === 'user' ? principal.id : null,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60_000)
          : null,
      },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'apikey.created',
      targetType: 'api_key',
      targetId: key.id,
      metadata: { name: input.name, role: input.role },
    });

    return {
      id: key.id,
      name: key.name,
      role: key.role,
      prefix,
      /** Shown once. There is no endpoint that can return this again. */
      secret,
      expiresAt: key.expiresAt,
    };
  }

  async revokeApiKey(organizationId: string, keyId: string, principal: AuthPrincipal) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, organizationId } });
    if (!key) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      organizationId,
      principal,
      action: 'apikey.revoked',
      targetType: 'api_key',
      targetId: keyId,
      metadata: { name: key.name },
    });
    return { revoked: true };
  }

  // --- Brand assets ---------------------------------------------------------

  async uploadAsset(
    organizationId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    purpose: string,
    principal: AuthPrincipal,
  ) {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(`unsupported image type "${file.mimetype}"`);
    }
    if (file.buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('images are limited to 8 MB');
    }

    const id = uuid();
    const extension = file.originalname.split('.').pop()?.toLowerCase().slice(0, 5) ?? 'png';
    const key = this.storage.assetKey(organizationId, id, extension);
    await this.storage.put(key, file.buffer, file.mimetype);

    const asset = await this.prisma.asset.create({
      data: {
        id,
        organizationId,
        key,
        filename: file.originalname.slice(0, 200),
        contentType: file.mimetype,
        size: file.buffer.length,
        purpose,
        createdById: principal.type === 'user' ? principal.id : null,
      },
    });

    return {
      id: asset.id,
      // Templates and brand kits store this reference, not a URL: the renderer
      // resolves it to bytes, so an asset never has to be publicly fetchable.
      reference: `opencred://asset/${key}`,
      filename: asset.filename,
      contentType: asset.contentType,
      size: asset.size,
    };
  }

  async listAssets(organizationId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return assets.map((a) => ({
      id: a.id,
      reference: `opencred://asset/${a.key}`,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      purpose: a.purpose,
      createdAt: a.createdAt,
    }));
  }

  async assetBytes(organizationId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });
    if (!asset) throw new NotFoundException('asset not found');
    return { buffer: await this.storage.get(asset.key), contentType: asset.contentType };
  }
}
