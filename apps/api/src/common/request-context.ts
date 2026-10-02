import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission, Role } from '@opencred/schema';

/**
 * Who is making this request.
 *
 * A caller is either a signed-in user or a machine holding an API key, and the
 * rest of the application must not care which. Both carry an organisation and
 * a role, so `FR-ID-02`'s "enforced at the API layer, not just the UI" holds
 * identically for the dashboard and for a bare `curl`.
 */
export interface AuthPrincipal {
  type: 'user' | 'api_key';
  /** User id, or API key id for machine callers. */
  id: string;
  /** Human-readable label for the audit log. */
  label: string;
  organizationId: string;
  role: Role;
  email?: string;
  apiKeyId?: string;
}

export interface AuthenticatedRequest extends Request {
  principal?: AuthPrincipal;
  requestId?: string;
}

export const PUBLIC_ROUTE = 'opencred:public';
/** Marks a route as reachable without authentication (verification pages, docs). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export const REQUIRED_PERMISSIONS = 'opencred:permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      // Guards run before parameter decorators, so reaching here means a route
      // was annotated @Public but still asked for a principal.
      throw new Error('route has no authenticated principal');
    }
    return request.principal;
  },
);

/** The caller's organisation id — the tenant scope for every query. */
export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.principal) throw new Error('route has no authenticated principal');
  return request.principal.organizationId;
});

export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

/**
 * Truncate an address before it is stored.
 *
 * Verification analytics (FR-ANA-01) need to distinguish "viewed from three
 * places" from "refreshed three times", not to identify a viewer. Dropping the
 * last IPv4 octet / last 80 IPv6 bits keeps the former and discards the latter,
 * which is also what keeps this feature defensible under GDPR.
 */
export function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : undefined;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::`;
  }
  return undefined;
}
