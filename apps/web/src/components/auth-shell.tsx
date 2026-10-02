import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRODUCT } from '@/lib/config';

/** Shared frame for sign-in, sign-up and account-recovery screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      id="main"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--sp-5)',
      }}
    >
      <div className="stack" style={{ width: 'min(420px, 100%)' }}>
        <div style={{ textAlign: 'center' }}>
          <Link
            href="/"
            style={{ fontWeight: 700, fontSize: '1.15rem', textDecoration: 'none', color: 'var(--text)' }}
          >
            {PRODUCT.name}
          </Link>
        </div>

        <div className="card card-pad stack">
          <div>
            <h1 style={{ fontSize: '1.35rem' }}>{title}</h1>
            {subtitle && (
              <p className="subtle" style={{ marginTop: 4 }}>
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </div>

        {footer && <div style={{ textAlign: 'center' }}>{footer}</div>}
      </div>
    </main>
  );
}
