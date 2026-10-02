import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, clientIp, type AuthenticatedRequest } from '../../common/request-context';
import { loadConfig } from '../../config';
import { OAuthService } from './oauth.service';

/**
 * OAuth sign-in (FR-ID-01).
 *
 * The callback finishes by redirecting into the web app with the session in a
 * cookie plus a one-time fragment, rather than returning JSON: the browser
 * arrives here from the provider, not from our own fetch, so a JSON body would
 * simply be displayed to the user.
 */
@ApiTags('Authentication')
@Public()
@Controller('v1/auth/oauth')
export class OAuthController {
  private readonly config = loadConfig();

  constructor(private readonly oauth: OAuthService) {}

  @Get()
  @ApiOperation({ summary: 'Which OAuth providers this instance has configured' })
  providers() {
    return {
      providers: this.oauth.availableProviders(),
      note:
        'Providers appear here only when this deployment has credentials for them. A self-hosted ' +
        'install with none configured uses local email and password, which is fully supported.',
    };
  }

  @Get(':provider')
  @ApiOperation({ summary: 'Begin the OAuth flow' })
  start(
    @Res() res: Response,
    @Param('provider') provider: string,
    @Query('redirect') redirect: string | undefined,
    @Query('invite') invite: string | undefined,
  ): void {
    // Only relative paths are honoured as post-login redirects: accepting an
    // absolute URL here would make this an open redirect.
    const safeRedirect = redirect && redirect.startsWith('/') && !redirect.startsWith('//')
      ? redirect
      : undefined;
    res.redirect(this.oauth.authorizationUrl(provider, { redirect: safeRedirect, invite }));
  }

  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth redirect target' })
  async callback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
  ): Promise<void> {
    const web = this.config.PUBLIC_URL.replace(/\/+$/, '');

    if (error || !code || !state) {
      res.redirect(`${web}/login?error=${encodeURIComponent(error ?? 'oauth_cancelled')}`);
      return;
    }

    try {
      const result = await this.oauth.handleCallback(provider, code, state, {
        userAgent: req.headers['user-agent'],
        ip: clientIp(req),
      });

      res.cookie('opencred_refresh', result.refreshToken, {
        httpOnly: true,
        secure: this.config.isProduction,
        sameSite: 'lax',
        path: '/v1/auth',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      const destination = result.redirect ?? (result.isNewUser ? '/onboarding' : '/dashboard');
      // The access token travels in the fragment so it never reaches a server
      // log or a Referer header; the web app reads it and clears the hash.
      res.redirect(`${web}${destination}#access_token=${encodeURIComponent(result.accessToken)}`);
    } catch (err) {
      res.redirect(
        `${web}/login?error=${encodeURIComponent((err as Error).message.slice(0, 200))}`,
      );
    }
  }
}
