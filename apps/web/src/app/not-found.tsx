import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

/**
 * The application-wide 404.
 *
 * Beyond handling unmatched URLs, this file has to exist for the *segment*
 * not-found pages to compose correctly: without a root `not-found.tsx`, Next
 * renders `notFound()` results in its built-in fallback document
 * (`<html id="__next_error__">`) rather than inside the root layout — losing
 * the `lang` attribute, the `<main>` landmark and the skip link. That is a
 * quiet accessibility regression on the one page a mistyped credential ID
 * lands on, and nothing about it looks broken until you read the markup.
 *
 * The credential-specific 404 at `app/v/[publicId]/not-found.tsx` still handles
 * mistyped identifiers, and says something far more useful than this does.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="container container-narrow"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', textAlign: 'center' }}
    >
      <div className="stack">
        <p className="eyebrow">404</p>
        <h1>This page does not exist</h1>
        <p className="lead" style={{ marginInline: 'auto' }}>
          The link may be mistyped, or the page may have moved.
        </p>

        <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-3)' }}>
          <Link className="btn btn-primary" href="/verify">
            Verify a credential
          </Link>
          <Link className="btn btn-secondary" href="/wallet">
            My credentials
          </Link>
          <Link className="btn btn-ghost" href="/">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
