import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyForm } from './form';
import { PUBLIC_API_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Verify a credential',
  description:
    'Check whether a certificate or badge is genuine. Enter its ID, or paste the credential file itself.',
};

/**
 * The manual verification entry point.
 *
 * Three routes to the same answer, because verifiers arrive with three
 * different things in hand: an ID printed on a certificate, a list of IDs from
 * a spreadsheet of candidates, or a downloaded credential file.
 */
export default function VerifyPage() {
  return (
    <div className="verify-shell">
      <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="container row row-between" style={{ height: 60 }}>
          <Link href="/" style={{ fontWeight: 650, textDecoration: 'none', color: 'var(--text)' }}>
            OpenCred
          </Link>
          <Link href="/docs" className="subtle">
            API documentation
          </Link>
        </div>
      </header>

      <main id="main" className="container container-narrow" style={{ padding: 'var(--sp-7) 0' }}>
        <div className="stack-lg stack">
          <div>
            <h1>Verify a credential</h1>
            <p className="lead" style={{ marginTop: 'var(--sp-3)' }}>
              Every credential issued through OpenCred is cryptographically signed and checkable
              by anyone, with no account and no relationship with the issuer.
            </p>
          </div>

          <VerifyForm apiBase={PUBLIC_API_URL} />

          <section className="card card-pad stack-sm stack">
            <h2 style={{ fontSize: '1rem' }}>Verifying without us</h2>
            <p className="subtle">
              Credentials follow Open Badges 3.0 and the W3C Verifiable Credentials data model, and
              carry a detached <code>eddsa-jcs-2022</code> Data Integrity proof. Any conformant
              verifier can check one offline, using only the issuer&rsquo;s published DID document.
              That is the point: the credential outlives its issuing platform.
            </p>
            <div className="subtle">
              <code className="mono">
                POST {PUBLIC_API_URL}/v1/public/verify
              </code>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
