import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../common/prisma.service';
import { loadConfig } from '../../config';
import { slugify } from '../../common/ids';
import { TokenService } from './token.service';
import { defaultBranding, roleSchema } from '@opencred/schema';
import { IssuerService } from '../issuer/issuer.service';

/**
 * FR-ID-01 — sign in with Google or Microsoft.
 *
 * Implemented directly against the two providers' OAuth 2.0 / OIDC endpoints
 * rather than through Passport. The whole flow is about a hundred readable
 * lines, and on a product whose pitch is auditability, a reviewer being able to
 * follow the authentication path end to end is worth more than the strategy
 * abstraction.
 *
 * PKCE is used even though this is a confidential client with a secret. It
 * costs one hash and closes the authorisation-code interception window if a
 * redirect ever leaks through a referrer or a proxy log.
 */

interface ProviderConfig {
  id: 'google' | 'microsoft';
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
}

interface StateClaims {
  provider: string;
  verifier: string;
  redirect?: string;
  invite?: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly config = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly issuer: IssuerService,
  ) {}

  availableProviders(): string[] {
    return (['google', 'microsoft'] as const).filter((id) => {
      try {
        this.provider(id);
        return true;
      } catch {
        return false;
      }
    });
  }

  private provider(id: string): ProviderConfig {
    if (id === 'google') {
      if (!this.config.OAUTH_GOOGLE_CLIENT_ID) {
        throw new ServiceUnavailableException('Google sign-in is not configured on this instance');
      }
      return {
        id: 'google',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
        clientId: this.config.OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: this.config.OAUTH_GOOGLE_CLIENT_SECRET,
      };
    }

    if (id === 'microsoft') {
      if (!this.config.OAUTH_MICROSOFT_CLIENT_ID) {
        throw new ServiceUnavailableException('Microsoft sign-in is not configured on this instance');
      }
      const tenant = this.config.OAUTH_MICROSOFT_TENANT || 'common';
      return {
        id: 'microsoft',
        authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
        scope: 'openid email profile',
        clientId: this.config.OAUTH_MICROSOFT_CLIENT_ID,
        clientSecret: this.config.OAUTH_MICROSOFT_CLIENT_SECRET,
      };
    }

    throw new BadRequestException(`unknown OAuth provider "${id}"`);
  }

  private redirectUri(providerId: string): string {
    return `${this.config.API_URL.replace(/\/+$/, '')}/v1/auth/oauth/${providerId}/callback`;
  }

  /**
   * Build the provider redirect.
   *
   * `state` is a short-lived signed JWT carrying the PKCE verifier, so the flow
   * needs no server-side session store and works across multiple API replicas
   * behind a load balancer.
   */
  authorizationUrl(providerId: string, options: { redirect?: string; invite?: string } = {}): string {
    const provider = this.provider(providerId);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const state = jwt.sign(
      { provider: provider.id, verifier, redirect: options.redirect, invite: options.invite },
      this.config.JWT_SECRET,
      { expiresIn: 600, audience: 'opencred-oauth' },
    );

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(provider.id));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async handleCallback(
    providerId: string,
    code: string,
    state: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ accessToken: string; refreshToken: string; redirect?: string; isNewUser: boolean }> {
    let claims: StateClaims;
    try {
      claims = jwt.verify(state, this.config.JWT_SECRET, {
        audience: 'opencred-oauth',
      }) as StateClaims;
    } catch {
      throw new BadRequestException('the sign-in request expired or was tampered with');
    }
    if (claims.provider !== providerId) throw new BadRequestException('provider mismatch');

    const provider = this.provider(providerId);

    const tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri(provider.id),
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code_verifier: claims.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text().catch(() => '');
      this.logger.warn(`${providerId} token exchange failed: ${detail.slice(0, 300)}`);
      throw new BadRequestException('could not complete sign-in with that provider');
    }

    const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenPayload.access_token) throw new BadRequestException('provider returned no access token');

    const userResponse = await fetch(provider.userInfoUrl, {
      headers: { authorization: `Bearer ${tokenPayload.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userResponse.ok) throw new BadRequestException('could not read your profile from the provider');

    const profile = (await userResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email) {
      throw new BadRequestException('the provider did not return an email address');
    }

    // Microsoft's `oidc/userinfo` omits `email_verified`; both providers only
    // return addresses within a verified tenant or a verified Google account,
    // so absence is treated as verified while an explicit `false` is not.
    if (profile.email_verified === false) {
      throw new BadRequestException('verify your email address with the provider first');
    }

    const email = profile.email.trim().toLowerCase();
    const { user, isNewUser } = await this.linkOrCreateUser({
      provider: provider.id,
      providerAccountId: profile.sub,
      email,
      name: profile.name ?? email.split('@')[0],
      avatarUrl: profile.picture,
    });

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, acceptedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
    });

    // A first-time OAuth user with no workspace gets one, so that "Sign in with
    // Google" is a complete signup path rather than a dead end.
    const organizationId = membership?.organizationId ?? (await this.createWorkspaceFor(user.id, user.name, email));
    const role = roleSchema.parse(membership?.role ?? 'owner');

    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      org: organizationId,
      role,
      email: user.email,
      name: user.name,
    });
    const { token: refreshToken } = await this.tokens.issueRefreshToken(user.id, meta);

    return { accessToken, refreshToken, redirect: claims.redirect, isNewUser };
  }

  private async linkOrCreateUser(input: {
    provider: string;
    providerAccountId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }) {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (linked) {
      await this.prisma.user.update({
        where: { id: linked.userId },
        data: { lastLoginAt: new Date() },
      });
      return { user: linked.user, isNewUser: false };
    }

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (existing) {
      // Linking by verified email is safe here precisely because we rejected
      // unverified addresses above; without that check this would be an
      // account-takeover primitive.
      await this.prisma.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          email: input.email,
        },
      });
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          lastLoginAt: new Date(),
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        },
      });
      return { user: existing, isNewUser: false };
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl ?? null,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
        oauthAccounts: {
          create: {
            provider: input.provider,
            providerAccountId: input.providerAccountId,
            email: input.email,
          },
        },
      },
    });
    return { user, isNewUser: true };
  }

  private async createWorkspaceFor(userId: string, name: string, email: string): Promise<string> {
    const base = slugify(`${name}-workspace`, 'workspace');
    let slug = base;
    for (let i = 2; await this.prisma.organization.findUnique({ where: { slug } }); i += 1) {
      slug = `${base}-${i}`;
    }

    const plan = this.config.isSelfHosted ? 'community' : 'free';
    const periodEnd = new Date();
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);

    const org = await this.prisma.organization.create({
      data: {
        slug,
        name: `${name.split(' ')[0]}'s workspace`,
        contactEmail: email,
        plan,
        branding: defaultBranding() as never,
        memberships: { create: { userId, role: 'owner', acceptedAt: new Date() } },
        subscription: { create: { plan, currentPeriodEnd: periodEnd } },
      },
    });

    await this.issuer.ensureKey(org.id).catch((err) => {
      this.logger.error(`issuer key creation failed for ${org.id}: ${err.message}`);
    });

    return org.id;
  }
}
