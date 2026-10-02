import Link from 'next/link';
import { PRODUCT, PUBLIC_API_URL } from '@/lib/config';

/**
 * Header and footer for the public marketing and verification surfaces.
 *
 * Server components with no interactivity, so the landing and verification
 * pages ship no JavaScript for their chrome.
 */

export function SiteHeader() {
  return (
    <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div className="container row row-between" style={{ height: 62 }}>
        <Link
          href="/"
          style={{ fontWeight: 700, fontSize: '1.05rem', textDecoration: 'none', color: 'var(--text)' }}
        >
          {PRODUCT.name}
        </Link>

        <nav className="row" aria-label="Primary">
          <Link href="/pricing" className="btn btn-ghost btn-sm">
            Pricing
          </Link>
          <Link href="/verify" className="btn btn-ghost btn-sm">
            Verify
          </Link>
          <a href={`${PUBLIC_API_URL}/docs`} className="btn btn-ghost btn-sm" rel="noopener">
            API
          </a>
          <a href={PRODUCT.repository} className="btn btn-ghost btn-sm" rel="noopener">
            Source
          </a>
          <Link href="/login" className="btn btn-secondary btn-sm">
            Sign in
          </Link>
          <Link href="/register" className="btn btn-primary btn-sm">
            Start free
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div className="container" style={{ padding: 'var(--sp-7) var(--sp-5)' }}>
        <div className="grid grid-4">
          <div className="stack-sm stack">
            <strong>{PRODUCT.name}</strong>
            <p className="subtle" style={{ maxWidth: '28ch' }}>
              The open-source, standards-native credentialing platform.
            </p>
          </div>

          <nav className="stack-sm stack" aria-label="Product">
            <span className="eyebrow">Product</span>
            <Link className="subtle" href="/pricing">
              Pricing
            </Link>
            <Link className="subtle" href="/verify">
              Verify a credential
            </Link>
            <Link className="subtle" href="/wallet">
              Recipient wallet
            </Link>
          </nav>

          <nav className="stack-sm stack" aria-label="Developers">
            <span className="eyebrow">Developers</span>
            <a className="subtle" href={`${PUBLIC_API_URL}/docs`} rel="noopener">
              API reference
            </a>
            <a className="subtle" href={`${PUBLIC_API_URL}/docs/openapi.json`} rel="noopener">
              OpenAPI document
            </a>
            <a className="subtle" href={PRODUCT.repository} rel="noopener">
              Source code
            </a>
          </nav>

          <nav className="stack-sm stack" aria-label="Standards">
            <span className="eyebrow">Standards</span>
            <a
              className="subtle"
              href="https://www.imsglobal.org/spec/ob/v3p0"
              rel="noopener noreferrer"
            >
              Open Badges 3.0
            </a>
            <a className="subtle" href="https://www.w3.org/TR/vc-data-model-2.0/" rel="noopener noreferrer">
              W3C Verifiable Credentials
            </a>
            <a className="subtle" href="https://w3c-ccg.github.io/did-method-web/" rel="noopener noreferrer">
              did:web
            </a>
          </nav>
        </div>

        <hr className="divider" style={{ margin: 'var(--sp-6) 0 var(--sp-4)' }} />

        <p className="subtle">
          Core platform licensed under AGPL-3.0-or-later. Starter templates are CC0.{' '}
          <a href={PRODUCT.repository} rel="noopener">
            Read the source
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
