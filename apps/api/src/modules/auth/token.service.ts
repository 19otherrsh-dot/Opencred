import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { loadConfig } from '../../config';
import { CryptoService } from '../../common/crypto.service';
import { PrismaService } from '../../common/prisma.service';
import { randomToken } from '../../common/ids';
import type { Role } from '@opencred/schema';

export interface AccessTokenClaims {
  sub: string;
  org: string;
  role: Role;
  email: string;
  name: string;
  typ: 'access' | 'recipient';
}

/**
 * Session tokens.
 *
 * Short-lived stateless access tokens plus long-lived, database-backed,
 * single-use refresh tokens. The split matters for a specific requirement:
 * FR-ID-02 says role changes are enforced at the API layer. A stateless token
 * that lived for a month would let a demoted admin keep admin rights for a
 * month; a fifteen-minute one bounds that to fifteen minutes, and revoking the
 * refresh token ends the session immediately.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly issuer: string;

  readonly accessTokenTtlSeconds = 15 * 60;
  readonly refreshTokenTtlSeconds = 30 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    const config = loadConfig();
    this.secret = config.JWT_SECRET;
    this.issuer = config.API_URL;
  }

  signAccessToken(claims: Omit<AccessTokenClaims, 'typ'> & { typ?: AccessTokenClaims['typ'] }): string {
    return jwt.sign({ ...claims, typ: claims.typ ?? 'access' }, this.secret, {
      algorithm: 'HS256',
      expiresIn: this.accessTokenTtlSeconds,
      issuer: this.issuer,
      audience: 'opencred-api',
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      return jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: 'opencred-api',
      }) as AccessTokenClaims;
    } catch (err) {
      throw new UnauthorizedException(
        (err as Error).name === 'TokenExpiredError' ? 'access token expired' : 'invalid access token',
      );
    }
  }

  async issueRefreshToken(
    userId: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(48);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlSeconds * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.crypto.hashToken(token),
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Exchange a refresh token for a new pair, invalidating the old one.
   *
   * Rotation is unconditional. If a token that has already been used shows up
   * again, that is either a race or a stolen token, and we cannot tell which —
   * so every outstanding session for that user is revoked. Losing a session is
   * a minor annoyance; leaving a thief's session alive is not.
   */
  async rotateRefreshToken(
    token: string,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<{ userId: string; token: string; expiresAt: Date }> {
    const tokenHash = this.crypto.hashToken(token);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) throw new UnauthorizedException('invalid refresh token');

    if (existing.revokedAt) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('refresh token reuse detected; all sessions revoked');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const next = await this.issueRefreshToken(existing.userId, meta);
    return { userId: existing.userId, ...next };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.crypto.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Housekeeping for expired rows; called by the scheduled maintenance job. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return result.count;
  }
}
