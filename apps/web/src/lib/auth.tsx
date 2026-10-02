'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken, setUnauthenticatedHandler } from './api';

export type Role = 'owner' | 'admin' | 'issuer' | 'viewer';

export interface PlanFeatures {
  customDomain: boolean;
  whiteLabelEmail: boolean;
  fullWhiteLabel: boolean;
  webhooks: boolean;
  automation: boolean;
  analytics: 'basic' | 'full';
  sso: boolean;
  auditLog: boolean;
  dataResidencyChoice: boolean;
  prioritySupport: boolean;
  apiRateLimitPerMinute: number;
  seats: number | null;
}

export interface Session {
  user: { id: string; email: string; name: string; emailVerified: boolean; locale?: string };
  organization: { id: string; slug: string; name: string; plan: string; planName?: string; did?: string };
  role: Role;
  features: PlanFeatures;
  edition: 'cloud' | 'community' | 'enterprise';
}

interface AuthContextValue {
  session: Session | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The same permission table the API enforces (FR-ID-02).
 *
 * Duplicated here to *hide* controls a role cannot use, never to authorise
 * anything. Every one of these actions is independently checked server-side;
 * this copy exists so the interface does not offer a button that will 403.
 */
const PERMISSIONS = {
  viewer: ['org:read', 'templates:read', 'recipients:read', 'credentials:read', 'analytics:read'],
  issuer: [
    'org:read',
    'templates:read',
    'templates:write',
    'recipients:read',
    'recipients:write',
    'credentials:read',
    'credentials:issue',
    'credentials:revoke',
    'analytics:read',
    'data:export',
  ],
  admin: [
    'org:read',
    'org:update',
    'templates:read',
    'templates:write',
    'recipients:read',
    'recipients:write',
    'credentials:read',
    'credentials:issue',
    'credentials:revoke',
    'analytics:read',
    'data:export',
    'members:read',
    'members:manage',
    'apikeys:manage',
    'auditlog:read',
    'webhooks:manage',
    'gdpr:manage',
  ],
  owner: ['*'],
} as const;

export type Permission =
  | 'org:read'
  | 'org:update'
  | 'org:billing'
  | 'templates:read'
  | 'templates:write'
  | 'recipients:read'
  | 'recipients:write'
  | 'credentials:read'
  | 'credentials:issue'
  | 'credentials:revoke'
  | 'analytics:read'
  | 'data:export'
  | 'members:read'
  | 'members:manage'
  | 'apikeys:manage'
  | 'auditlog:read'
  | 'webhooks:manage'
  | 'gdpr:manage';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const me = await api.get<Session>('/v1/auth/me');
      setSession(me);
      setStatus('authenticated');
    } catch {
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setSession(null);
      setStatus('anonymous');
    });

    // An OAuth callback lands here with the token in the URL fragment. Read it,
    // then clear the hash so it never reaches history, a bookmark or a Referer.
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get('access_token');
      if (token) {
        setAccessToken(token);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    void (async () => {
      // No token in memory yet: try the httpOnly refresh cookie before deciding
      // the visitor is anonymous. This is what survives a page reload.
      await api.refreshSession();
      await load();
    })();

    return () => setUnauthenticatedHandler(null);
  }, [load]);

  const signOut = useCallback(async () => {
    await api.post('/v1/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setSession(null);
    setStatus('anonymous');
    router.push('/login');
  }, [router]);

  const can = useCallback(
    (permission: Permission) => {
      if (!session) return false;
      const list = PERMISSIONS[session.role] as readonly string[];
      return list.includes('*') || list.includes(permission);
    },
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, status, refresh: load, signOut, can }),
    [session, status, load, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Redirects to the sign-in page when the session resolves to anonymous. */
export function useRequireAuth(): AuthContextValue {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === 'anonymous') {
      const next = typeof window !== 'undefined' ? window.location.pathname : '/dashboard';
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [auth.status, router]);

  return auth;
}
