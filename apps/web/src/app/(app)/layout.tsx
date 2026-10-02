'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award,
  BarChart3,
  FileBadge,
  LayoutDashboard,
  Layers,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

/**
 * The signed-in application shell.
 *
 * A route group, so `/dashboard`, `/credentials` and friends share this frame
 * without carrying an `(app)` segment in their URLs. Authentication is enforced
 * here once rather than in every page — and, more importantly, it is enforced
 * again on every API call, because a client-side guard is a convenience and
 * never a control.
 */

const NAV = [
  {
    title: 'Issue',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/credentials', label: 'Credentials', icon: Award },
      { href: '/batches', label: 'Bulk issuance', icon: Upload },
      { href: '/templates', label: 'Design studio', icon: FileBadge },
    ],
  },
  {
    title: 'Manage',
    items: [
      { href: '/recipients', label: 'Recipients', icon: Users },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useRequireAuth();
  const { session, signOut } = useAuth();
  const pathname = usePathname();

  if (status === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <Spinner label="Loading your workspace" />
      </div>
    );
  }

  if (status === 'anonymous') return null;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Workspace">
        <Link
          href="/dashboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'var(--text)',
          }}
        >
          <Layers size={18} aria-hidden="true" />
          OpenCred
        </Link>

        {NAV.map((group) => (
          <div className="nav-group" key={group.title}>
            <span className="nav-title">{group.title}</span>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  aria-current={active ? 'page' : undefined}
                >
                  <item.icon size={17} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="spacer" />

        {session?.edition !== 'cloud' && (
          <div
            className="subtle"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <strong style={{ display: 'block', color: 'var(--text)' }}>
              {session?.edition === 'enterprise' ? 'Enterprise' : 'Community Edition'}
            </strong>
            Self-hosted. Unlimited credentials, no metering.
          </div>
        )}
      </nav>

      <div className="app-main">
        <header className="app-header">
          <div className="stack-sm" style={{ minWidth: 0 }}>
            <strong className="truncate">{session?.organization.name}</strong>
          </div>
          <div className="spacer" />
          <span className="badge badge-neutral">{session?.role}</span>
          <span className="subtle truncate" style={{ maxWidth: 200 }}>
            {session?.user.email}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </header>

        <main id="main" className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
