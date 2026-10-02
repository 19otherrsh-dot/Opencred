'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const TABS = [
  { href: '/settings', label: 'Organisation', exact: true },
  { href: '/settings/branding', label: 'Branding' },
  { href: '/settings/email', label: 'Email delivery' },
  { href: '/settings/members', label: 'Team' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/webhooks', label: 'Webhooks' },
  { href: '/settings/issuer', label: 'Issuer identity' },
  { href: '/settings/billing', label: 'Plan & usage' },
  { href: '/settings/audit-log', label: 'Audit log' },
  { href: '/settings/data', label: 'Data protection' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();

  return (
    <div className="stack-lg stack">
      <div>
        <h1>Settings</h1>
        <p className="subtle">
          {session?.organization.name} · {session?.organization.planName ?? session?.organization.plan}
        </p>
      </div>

      <nav
        className="row row-wrap"
        aria-label="Settings sections"
        style={{ gap: 'var(--sp-1)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--sp-3)' }}
      >
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="btn btn-ghost btn-sm"
              aria-current={active ? 'page' : undefined}
              style={
                active
                  ? { background: 'var(--brand-soft)', color: 'var(--brand-text)', fontWeight: 600 }
                  : undefined
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
