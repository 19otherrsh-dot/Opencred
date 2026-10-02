import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  Public,
  clientIp,
  type AuthPrincipal,
  type AuthenticatedRequest,
} from '../../common/request-context';
import { loadConfig } from '../../config';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import {
  loginSchema,
  magicLinkConsumeSchema,
  magicLinkRequestSchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  switchOrgSchema,
  verifyEmailSchema,
} from './auth.dto';

const REFRESH_COOKIE = 'opencred_refresh';

@ApiTags('Authentication')
@Controller('v1/auth')
export class AuthController {
  private readonly config = loadConfig();

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Refresh tokens go in an httpOnly cookie *and* the response body.
   *
   * The cookie is what the first-party dashboard uses, because a token in
   * JavaScript-reachable storage is one XSS away from a stolen session. The
   * body copy is what a CLI, a mobile client or a test script uses, because
   * those have no cookie jar. Both are the same token; neither is a fallback
   * for a broken version of the other.
   */
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: this.tokens.refreshTokenTtlSeconds * 1000,
    });
  }

  private meta(req: AuthenticatedRequest) {
    return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create a workspace and its first owner (FR-ID-01)' })
  async register(
    @Body(zodPipe(registerSchema)) dto: ReturnType<typeof registerSchema.parse>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.register(dto, this.meta(req));
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange email and password for a session' })
  async login(
    @Body(zodPipe(loginSchema)) dto: ReturnType<typeof loginSchema.parse>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token for a new session' })
  async refresh(
    @Body(zodPipe(refreshSchema)) dto: ReturnType<typeof refreshSchema.parse>,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      dto.refreshToken ??
      (req as unknown as { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('no refresh token supplied');

    const session = await this.auth.refresh(token, this.meta(req), dto.organizationId);
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }

  @Get('me')
  @ApiOperation({ summary: 'The current principal, workspace and plan features' })
  async me(@CurrentPrincipal() principal: AuthPrincipal) {
    if (principal.type === 'api_key') {
      return {
        principal: { type: 'api_key', id: principal.id, label: principal.label, role: principal.role },
        organizationId: principal.organizationId,
      };
    }
    return this.auth.me(principal.id, principal.organizationId);
  }

  @Post('switch-organization')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue a session for another workspace the user belongs to' })
  async switchOrg(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(switchOrgSchema)) dto: { organizationId: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (principal.type !== 'user') {
      throw new UnauthorizedException('API keys are bound to a single workspace');
    }
    const session = await this.auth.switchOrganization(
      principal.id,
      dto.organizationId,
      this.meta(req),
    );
    this.setRefreshCookie(res, session.refreshToken);
    return session;
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body(zodPipe(verifyEmailSchema)) dto: { token: string }) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request a password-reset link',
    description:
      'Always returns 202 regardless of whether the address has an account, so that this endpoint cannot be used to enumerate users.',
  })
  async requestReset(@Body(zodPipe(requestPasswordResetSchema)) dto: { email: string }) {
    await this.auth.requestPasswordReset(dto.email);
    return { accepted: true };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @Body(zodPipe(resetPasswordSchema)) dto: { token: string; password: string },
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('wallet/request-link')
  @HttpCode(202)
  @ApiOperation({ summary: 'Email a recipient a passwordless link to their credentials (FR-DEL-02)' })
  async requestWalletLink(@Body(zodPipe(magicLinkRequestSchema)) dto: { email: string }) {
    await this.auth.requestRecipientMagicLink(dto.email);
    return { accepted: true };
  }

  @Public()
  @Post('wallet/consume-link')
  @HttpCode(200)
  async consumeWalletLink(@Body(zodPipe(magicLinkConsumeSchema)) dto: { token: string }) {
    return this.auth.consumeRecipientMagicLink(dto.token);
  }
}
