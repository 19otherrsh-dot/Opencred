import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { defaultBranding, planFor, roleSchema, type Role } from '@opencred/schema';
import { getTemplate } from '@opencred/templates';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { AuditService } from '../../common/audit.service';
import { randomToken, slugify } from '../../common/ids';
import { loadConfig } from '../../config';
import { IssuerService } from '../issuer/issuer.service';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';
import type { LoginDto, RegisterDto } from './auth.dto';

/** Starter templates copied into every new workspace, so the first issuance
 *  needs no design work at all — the success metric is under ten minutes from
 *  signup to first credential sent. */
const STARTER_TEMPLATE_SLUGS = [
  'modern-minimal-cobalt',
  'classic-ornate-oxford',
  'badge-circle-violet',
];

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; emailVerified: boolean };
  organization: { id: string; slug: string; name: string; plan: string; role: Role };
  organizations: Array<{ id: string; slug: string; name: string; role: Role }>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly issuer: IssuerService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration (FR-ID-01)
  // -------------------------------------------------------------------------

  async register(dto: RegisterDto, meta: { userAgent?: string; ip?: string }): Promise<SessionResult> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser?.passwordHash) {
      // Do not reveal whether the address is registered on a *login* path, but
      // registration must fail loudly or the user is left with no way forward.
      throw new ConflictException({
        error: 'email_in_use',
        message: 'An account with that email already exists. Sign in instead.',
      });
    }

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const slug = await this.uniqueSlug(dto.organizationName);

    // Self-hosted installs are on the Community plan by definition: there is no
    // billing relationship, and metering a self-hosted install would be exactly
    // the "trust us" behaviour the whole product argues against.
    const plan = this.config.isSelfHosted ? 'community' : dto.plan;

    const { organization, user } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          slug,
          name: dto.organizationName.trim(),
          contactEmail: email,
          plan,
          branding: defaultBranding() as never,
        },
      });

      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: { passwordHash, name: dto.name.trim() },
          })
        : await tx.user.create({
            data: { email, name: dto.name.trim(), passwordHash },
          });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'owner',
          acceptedAt: new Date(),
        },
      });

      const periodEnd = new Date();
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
      await tx.subscription.create({
        data: { organizationId: organization.id, plan, currentPeriodEnd: periodEnd },
      });

      return { organization, user };
    });

    // Everything below is recoverable and must not fail the signup itself: a
    // workspace with no starter templates is a minor annoyance, a failed
    // registration is a lost customer.
    await this.issuer.ensureKey(organization.id).catch((err) => {
      this.logger.error(`issuer key creation failed for ${organization.id}: ${err.message}`);
    });
    await this.seedStarterTemplates(organization.id, user.id).catch((err) => {
      this.logger.warn(`starter templates not seeded for ${organization.id}: ${err.message}`);
    });

    await this.sendVerificationEmail(user.email, user.name, organization.id);

    await this.audit.record({
      organizationId: organization.id,
      action: 'organization.created',
      targetType: 'organization',
      targetId: organization.id,
      actorLabel: user.email,
      metadata: { plan, slug },
    });

    return this.buildSession(user.id, organization.id, meta);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    for (let i = 2; i < 200; i += 1) {
      const clash = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
      candidate = `${base}-${i}`;
    }
    return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  private async seedStarterTemplates(organizationId: string, userId: string): Promise<void> {
    for (const slug of STARTER_TEMPLATE_SLUGS) {
      const entry = getTemplate(slug);
      await this.prisma.template.create({
        data: {
          organizationId,
          name: entry.name,
          description: `Starter template from the OpenCred library (${entry.license}).`,
          kind: entry.kind,
          document: entry.document as never,
          librarySlug: entry.slug,
          createdById: userId,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }): Promise<SessionResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });

    // Always run a verification, even with no user, so that response time does
    // not disclose whether an address is registered.
    const hash = user?.passwordHash ?? DUMMY_ARGON2_HASH;
    const ok = await this.crypto.verifyPassword(hash, dto.password);

    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      });
    }

    const memberships = user.memberships.filter((m) => m.acceptedAt);
    if (memberships.length === 0) {
      throw new UnauthorizedException({
        error: 'no_organization',
        message: 'This account is not a member of any workspace.',
      });
    }

    const membership = dto.organizationId
      ? memberships.find((m) => m.organizationId === dto.organizationId)
      : memberships[0];

    if (!membership) throw new UnauthorizedException('not a member of that workspace');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildSession(user.id, membership.organizationId, meta);
  }

  async refresh(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string },
    organizationId?: string,
  ): Promise<SessionResult> {
    const rotated = await this.tokens.rotateRefreshToken(refreshToken, meta);
    const memberships = await this.prisma.membership.findMany({
      where: { userId: rotated.userId, acceptedAt: { not: null } },
    });
    if (memberships.length === 0) throw new UnauthorizedException('no active workspace membership');

    const requested = organizationId
      ? memberships.find((m) => m.organizationId === organizationId)
      : undefined;
    const target = requested ?? memberships[0];

    return this.buildSession(rotated.userId, target.organizationId, meta, rotated.token);
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
  }

  async switchOrganization(
    userId: string,
    organizationId: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<SessionResult> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership?.acceptedAt) throw new NotFoundException('not a member of that workspace');
    return this.buildSession(userId, organizationId, meta);
  }

  private async buildSession(
    userId: string,
    organizationId: string,
    meta: { userAgent?: string; ip?: string },
    existingRefreshToken?: string,
  ): Promise<SessionResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { organization: true } } },
    });

    const membership = user.memberships.find((m) => m.organizationId === organizationId);
    if (!membership) throw new UnauthorizedException('not a member of that workspace');

    const role = roleSchema.parse(membership.role);
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      org: organizationId,
      role,
      email: user.email,
      name: user.name,
    });

    const refreshToken =
      existingRefreshToken ?? (await this.tokens.issueRefreshToken(user.id, meta)).token;

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTokenTtlSeconds,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
      organization: {
        id: membership.organization.id,
        slug: membership.organization.slug,
        name: membership.organization.name,
        plan: membership.organization.plan,
        role,
      },
      organizations: user.memberships
        .filter((m) => m.acceptedAt)
        .map((m) => ({
          id: m.organization.id,
          slug: m.organization.slug,
          name: m.organization.name,
          role: roleSchema.parse(m.role),
        })),
    };
  }

  // -------------------------------------------------------------------------
  // Email verification, password reset, recipient magic links
  // -------------------------------------------------------------------------

  private async createSingleUseToken(
    purpose: string,
    email: string,
    ttlMinutes: number,
    organizationId?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const token = randomToken(32);
    await this.prisma.singleUseToken.create({
      data: {
        purpose,
        email,
        tokenHash: this.crypto.hashToken(token),
        organizationId,
        metadata: metadata as never,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });
    return token;
  }

  private async consumeSingleUseToken(purpose: string, token: string) {
    const record = await this.prisma.singleUseToken.findUnique({
      where: { tokenHash: this.crypto.hashToken(token) },
    });
    if (!record || record.purpose !== purpose) throw new BadRequestException('invalid token');
    if (record.consumedAt) throw new BadRequestException('this link has already been used');
    if (record.expiresAt.getTime() < Date.now()) throw new BadRequestException('this link has expired');

    await this.prisma.singleUseToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record;
  }

  async sendVerificationEmail(email: string, name: string, organizationId?: string): Promise<void> {
    const token = await this.createSingleUseToken('verify_email', email, 60 * 24, organizationId);
    await this.mail
      .sendSystemEmail({
        to: email,
        subject: 'Confirm your email address',
        heading: `Welcome to OpenCred, ${name.split(' ')[0]}`,
        body:
          'Confirm your email address to finish setting up your workspace. ' +
          'This link is valid for 24 hours.',
        actionLabel: 'Confirm email',
        actionUrl: `${this.config.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`,
      })
      .catch((err) => this.logger.warn(`verification email not sent: ${err.message}`));
  }

  async verifyEmail(token: string): Promise<{ email: string }> {
    const record = await this.consumeSingleUseToken('verify_email', token);
    await this.prisma.user.updateMany({
      where: { email: record.email, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    return { email: record.email };
  }

  /**
   * Password reset request.
   *
   * Always reports success. Whether an address has an account is not something
   * an unauthenticated caller gets to enumerate.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return;

    const token = await this.createSingleUseToken('reset_password', normalized, 60);
    await this.mail
      .sendSystemEmail({
        to: normalized,
        subject: 'Reset your OpenCred password',
        heading: 'Password reset',
        body: 'Use the link below to choose a new password. It is valid for one hour.',
        actionLabel: 'Choose a new password',
        actionUrl: `${this.config.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`,
      })
      .catch((err) => this.logger.warn(`reset email not sent: ${err.message}`));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.consumeSingleUseToken('reset_password', token);
    const user = await this.prisma.user.findUnique({ where: { email: record.email } });
    if (!user) throw new BadRequestException('invalid token');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.crypto.hashPassword(password), emailVerifiedAt: new Date() },
    });

    // A password reset ends every other session; that is the entire point of
    // resetting a password you believe was compromised.
    await this.tokens.revokeAllForUser(user.id);
  }

  /**
   * FR-DEL-02 — recipient portal sign-in.
   *
   * Recipients never chose a password with us and should not have to. They
   * receive a link, click it, and see every credential ever issued to their
   * address across every issuing organisation.
   */
  async requestRecipientMagicLink(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const hasCredentials = await this.prisma.recipient.findFirst({
      where: { email: normalized },
      select: { id: true },
    });
    if (!hasCredentials) return; // silent, for the same enumeration reason

    const token = await this.createSingleUseToken('recipient_login', normalized, 30);
    await this.mail
      .sendSystemEmail({
        to: normalized,
        subject: 'Your credential wallet sign-in link',
        heading: 'Sign in to your credentials',
        body: 'Use the link below to view and download your credentials. Valid for 30 minutes.',
        actionLabel: 'Open my credentials',
        actionUrl: `${this.config.PUBLIC_URL}/wallet/enter?token=${encodeURIComponent(token)}`,
      })
      .catch((err) => this.logger.warn(`recipient magic link not sent: ${err.message}`));
  }

  async consumeRecipientMagicLink(token: string): Promise<{ token: string; email: string }> {
    const record = await this.consumeSingleUseToken('recipient_login', token);
    // Recipient sessions are scoped by email and carry no organisation role:
    // the portal reads only credentials issued *to* that address.
    const sessionToken = this.tokens.signAccessToken({
      sub: `recipient:${record.email}`,
      org: 'recipient',
      role: 'viewer',
      email: record.email,
      name: record.email,
      typ: 'recipient',
    });
    return { token: sessionToken, email: record.email };
  }

  async me(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: true, organization: true },
    });
    if (!membership) throw new NotFoundException('membership not found');

    const plan = planFor(membership.organization.plan);
    return {
      user: {
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.name,
        emailVerified: Boolean(membership.user.emailVerifiedAt),
        locale: membership.user.locale,
      },
      organization: {
        id: membership.organization.id,
        slug: membership.organization.slug,
        name: membership.organization.name,
        plan: plan.id,
        planName: plan.name,
        did: this.issuer.didFor(membership.organization),
      },
      role: roleSchema.parse(membership.role),
      features: plan.features,
      edition: this.config.edition,
    };
  }
}

/**
 * A real Argon2id hash of a random value, compared against when no user exists
 * so that the "unknown email" path costs the same as the "wrong password" one.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Xy0Yq1WgYyGZ0nCJvVQvHwzKxMLwXcJ7X0m0PQxK5vE';
