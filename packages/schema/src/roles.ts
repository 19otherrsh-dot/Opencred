import { z } from 'zod';

/**
 * FR-ID-02 — role-based access control.
 *
 * Roles are ordered by privilege so that guards can express "at least Issuer"
 * without enumerating every role. The ordering is the single source of truth;
 * the API guard, the UI, and the API-key scoping all read from it.
 */
export const ROLES = ['viewer', 'issuer', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

const RANK: Record<Role, number> = { viewer: 0, issuer: 1, admin: 2, owner: 3 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

/**
 * Permissions are declared explicitly rather than derived purely from rank, so
 * that "an Issuer can create/send credentials but cannot change billing or
 * delete the org" is readable in one place and testable directly.
 */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'org:billing',
  'members:read',
  'members:manage',
  'apikeys:manage',
  'auditlog:read',
  'templates:read',
  'templates:write',
  'recipients:read',
  'recipients:write',
  'credentials:read',
  'credentials:issue',
  'credentials:revoke',
  'webhooks:manage',
  'analytics:read',
  'data:export',
  'gdpr:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  'org:read',
  'members:read',
  'templates:read',
  'recipients:read',
  'credentials:read',
  'analytics:read',
];

const ISSUER: Permission[] = [
  ...VIEWER,
  'templates:write',
  'recipients:write',
  'credentials:issue',
  'credentials:revoke',
  'data:export',
];

const ADMIN: Permission[] = [
  ...ISSUER,
  'org:update',
  'members:manage',
  'apikeys:manage',
  'auditlog:read',
  'webhooks:manage',
  'gdpr:manage',
];

const OWNER: Permission[] = [...ADMIN, 'org:delete', 'org:billing'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  issuer: ISSUER,
  admin: ADMIN,
  owner: OWNER,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * API keys carry a role too, so a key can never exceed the privileges of the
 * role it was minted with. Machine keys default to `issuer`, which is enough
 * for the event-triggered issuance flow (FR-ISS-04) and nothing more.
 */
export const API_KEY_ROLES: readonly Role[] = ['viewer', 'issuer', 'admin'];
