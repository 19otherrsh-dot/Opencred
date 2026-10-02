import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };

/**
 * The offline fallback the service worker serves for navigations.
 *
 * It says plainly that credential status cannot be checked without a
 * connection, rather than implying anything about validity — a cached
 * "verified" is worse than no answer.
 */
export default function OfflinePage() {
  return (
    <main
      id="main"
      className="container container-narrow"
      style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', textAlign: 'center' }}
    >
      <div className="stack">
        <h1>You are offline</h1>
        <p className="lead" style={{ marginInline: 'auto' }}>
          Credential status — whether something has been revoked or has expired — can only be
          checked with a connection, so we will not guess.
        </p>
        <p className="subtle">Reconnect and reload, and everything will be here.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn btn-secondary" href="/wallet">
            My credentials
          </Link>
        </div>
      </div>
    </main>
  );
}
