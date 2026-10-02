import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT, PUBLIC_API_URL, SERVER_API_URL } from '@/lib/config';
import { SiteHeader, SiteFooter } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Developer documentation',
  description:
    'Issue and verify credentials from your own product. REST API, webhooks, n8n node and an LMS connector.',
};

/**
 * The developer landing page (FR-INT-01).
 *
 * The interactive reference itself is generated from the running server and
 * served at `/docs` on the API, so it cannot drift from the implementation.
 * This page is the orientation around it — the six things an integrator needs
 * to know before opening a reference with sixty endpoints in it.
 */
async function fetchEndpointCount(): Promise<number | null> {
  try {
    const response = await fetch(`${SERVER_API_URL}/docs/openapi.json`, {
      next: { revalidate: 600 },
    });
    if (!response.ok) return null;
    const document = (await response.json()) as { paths: Record<string, unknown> };
    return Object.keys(document.paths ?? {}).length;
  } catch {
    return null;
  }
}

export default async function DocsPage() {
  const endpoints = await fetchEndpointCount();

  return (
    <>
      <SiteHeader />

      <main id="main" className="container" style={{ padding: 'var(--sp-7) var(--sp-5) var(--sp-8)' }}>
        <div className="stack-lg stack">
          <div>
            <h1>Build on {PRODUCT.name}</h1>
            <p className="lead" style={{ marginTop: 'var(--sp-3)' }}>
              Issue credentials from inside your own product. One authenticated POST creates a
              signed, verifiable credential and delivers it.
            </p>
          </div>

          <div className="row row-wrap">
            <a className="btn btn-primary" href={`${PUBLIC_API_URL}/docs`} rel="noopener">
              Interactive API reference
            </a>
            <a className="btn btn-secondary" href={`${PUBLIC_API_URL}/docs/openapi.json`} rel="noopener">
              OpenAPI document
            </a>
            <a className="btn btn-secondary" href={PRODUCT.repository} rel="noopener">
              Source code
            </a>
          </div>

          {endpoints && (
            <p className="subtle">
              {endpoints} endpoints, generated from the running server rather than maintained by
              hand — the reference cannot describe an API this build does not have.
            </p>
          )}

          <section className="stack">
            <h2>Issue a credential</h2>
            <pre
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--sp-5)',
                overflowX: 'auto',
                fontSize: '0.8rem',
                lineHeight: 1.65,
              }}
            >
              <code>{`curl -X POST ${PUBLIC_API_URL}/v1/credentials \\
  -H "Authorization: Bearer ock_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "8f2b…",
    "recipient": { "name": "Ada Lovelace", "email": "ada@example.com" },
    "data": { "course": "Advanced Data Engineering", "grade": "Distinction" },
    "idempotencyKey": "course-42-user-1071"
  }'

# 202 Accepted
# { "id": "…", "publicId": "k7m2q9xb4t", "status": "draft", "deduplicated": false }`}</code>
            </pre>
            <p className="subtle">
              The response is immediate; signing, rendering and delivery happen in the background.
              Subscribe to the <code className="mono">credential.issued</code> webhook to know when
              it has landed.
            </p>
          </section>

          <section className="stack">
            <h2>Verify one</h2>
            <pre
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--sp-5)',
                overflowX: 'auto',
                fontSize: '0.8rem',
                lineHeight: 1.65,
              }}
            >
              <code>{`# By identifier — no authentication, ever
curl ${PUBLIC_API_URL}/v1/public/credentials/k7m2q9xb4t

# Or hand us a credential document and we will check it against
# the issuer's own DID, even if we did not issue it
curl -X POST ${PUBLIC_API_URL}/v1/public/verify \\
  -H "Content-Type: application/json" \\
  -d '{ "credential": { … } }'`}</code>
            </pre>
          </section>

          <section className="grid grid-3">
            {[
              {
                title: 'Idempotency',
                body: 'Send an idempotencyKey from any event handler that can retry. A redelivered LMS webhook must not mean a duplicate diploma.',
              },
              {
                title: 'Webhooks',
                body: 'At-least-once delivery with exponential backoff over 24 hours, HMAC-SHA256 signed with a timestamp inside the signed material. Make your consumer idempotent.',
              },
              {
                title: 'Rate limits',
                body: 'Set by your plan and published on the pricing page. Every response carries x-ratelimit-remaining; there is no separate hidden throttle.',
              },
              {
                title: 'Errors',
                body: 'Every failure returns { error, message, requestId } with a stable machine-readable slug. Quote the requestId and an operator can find the exact request.',
              },
              {
                title: 'No lock-in',
                body: 'Full CSV export of credentials, recipients and events at any time, plus the signed JSON of every credential. No support ticket, no notice period.',
              },
              {
                title: 'Automation',
                body: 'A native n8n node connects issuance to 400+ services with no code, and the Moodle plugin issues on course completion.',
              },
            ].map((item) => (
              <article key={item.title} className="card card-pad stack-sm stack">
                <h3 style={{ fontSize: '0.98rem' }}>{item.title}</h3>
                <p className="subtle">{item.body}</p>
              </article>
            ))}
          </section>

          <section className="card card-pad stack-sm stack">
            <h2 style={{ fontSize: '1.05rem' }}>Run it yourself</h2>
            <p className="muted">
              The core platform is AGPLv3. A self-hosted installation has the same API, the same
              standards conformance and no metering.
            </p>
            <pre
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: 'var(--sp-4)',
                overflowX: 'auto',
                fontSize: '0.8rem',
              }}
            >
              <code>{`git clone ${PRODUCT.repository}
cd opencred && cp .env.example .env
docker compose --profile full up -d`}</code>
            </pre>
            <Link className="subtle" href="/pricing">
              How self-hosting compares to Cloud →
            </Link>
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
