import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, roleSchema, type Permission } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import {
  PUBLIC_ROUTE,
  REQUIRED_PERMISSIONS,
  type AuthPrincipal,
  type AuthenticatedRequest,
} from '../../common/request-context';
import { TokenService } from './token.service';

/**
 * The single authentication and authorisation gate.
 *
 * Registered globally, so a new controller is protected by default and has to
 * opt *out* with `@Public()`. The inverse — protect-by-annotation — is how
 * endpoints end up unauthenticated by accident, and on this product an
 * accidentally public endpoint is somebody's cohort of student records.
 *
 * Both credential types resolve to the same `AuthPrincipal`, so authorisation
 * downstream never branches on how the caller authenticated (FR-ID-02).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // On a public route a bad credential is not an error — a verification page
    // must render for someone whose dashboard session happens to have expired,
    // and the recipient wallet authenticates with its own token type.
    let principal: AuthPrincipal | null = null;
    try {
      principal = await this.resolvePrincipal(request);
    } catch (err) {
      if (!isPublic) throw err;
    }

    if (principal) request.principal = principal;

    if (isPublic) return true;
    if (!principal) throw new UnauthorizedException('authentication required');

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required && required.length > 0) {
      const missing = required.filter((p) => !roleHasPermission(principal.role, p));
      if (missing.length > 0) {
        throw new ForbiddenException({
          error: 'insufficient_permissions',
          message: `Role "${principal.role}" is missing: ${missing.join(', ')}`,
          required: missing,
        });
      }
    }

    return true;
  }

  private async resolvePrincipal(
    request: AuthenticatedRequest,
  ): Promise<AuthPrincipal | null> {
    const header = request.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      return this.principalFromBearer(header.slice(7).trim());
    }

    // API keys may also arrive in a dedicated header, which is friendlier for
    // no-code tools whose HTTP nodes reserve Authorization for their own use.
    const apiKeyHeader = request.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
      return this.principalFromApiKey(apiKeyHeader.trim());
    }

    const cookie = (request as unknown as { cookies?: Record<string, string> }).cookies
      ?.opencred_access;
    if (cookie) return this.principalFromBearer(cookie);

    return null;
  }

  private async principalFromBearer(token: string): Promise<AuthPrincipal | null> {
    // API keys are also accepted as bearer tokens; the prefix disambiguates.
    if (token.startsWith('ock_')) return this.principalFromApiKey(token);

    const claims = this.tokens.verifyAccessToken(token);
    if (claims.typ !== 'access') throw new UnauthorizedException('wrong token type');

    // The role is re-read from the database rather than trusted from the token.
    // A token minted before a demotion must not outlive the demotion.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: claims.sub, organizationId: claims.org } },
      include: { user: true },
    });

    if (!membership || !membership.acceptedAt) {
      throw new UnauthorizedException('membership no longer valid');
    }

    return {
      type: 'user',
      id: membership.userId,
      label: membership.user.email,
      organizationId: membership.organizationId,
      role: roleSchema.parse(membership.role),
      email: membership.user.email,
    };
  }

  private async principalFromApiKey(rawKey: string): Promise<AuthPrincipal> {
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.crypto.hashToken(rawKey) },
    });

    if (!record || record.revokedAt) throw new UnauthorizedException('invalid API key');
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API key expired');
    }

    // `lastUsedAt` is intentionally fire-and-forget: it is an operator
    // convenience for spotting dormant keys, not something worth adding a
    // synchronous write to every API request for.
    void this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      type: 'api_key',
      id: record.id,
      label: `api-key:${record.name}`,
      organizationId: record.organizationId,
      role: roleSchema.parse(record.role),
      apiKeyId: record.id,
    };
  }
}
