import type { Metadata } from 'next';
import Link from 'next/link';
import { SERVER_API_URL } from '@/lib/config';
import { formatMoney } from '@/lib/format';
import { SiteHeader, SiteFooter } from '@/components/site-chrome';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Every OpenCred plan, published in full — including the Enterprise starting price. No setup fee, no annual contract.',
};

interface PlanFeatures {
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

interface Plan {
  id: string;
  name: string;
  priceCents: number | null;
  startingAtCents?: number;
  setupFeeCents: number;
  annualContractRequired: boolean;
  includedCredentialsPerYear: number | null;
  overageCentsPerCredential: number | null;
  selfHosted: boolean;
  features: PlanFeatures;
  blurb: string;
}

async function fetchPlans(): Promise<{ plans: Plan[]; note?: string }> {
  try {
    const response = await fetch(`${SERVER_API_URL}/v1/billing/plans`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return { plans: [] };
    return (await response.json()) as { plans: Plan[]; note?: string };
  } catch {
    return { plans: [] };
  }
}

const FEATURE_ROWS: Array<{ key: keyof PlanFeatures; label: string }> = [
  { key: 'customDomain', label: 'Custom verification domain' },
  { key: 'whiteLabelEmail', label: 'Send from your own domain' },
  { key: 'fullWhiteLabel', label: 'Full white-label (no OpenCred marks)' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'automation', label: 'n8n automation' },
  { key: 'auditLog', label: 'Audit log' },
  { key: 'sso', label: 'SAML / OIDC single sign-on' },
  { key: 'dataResidencyChoice', label: 'Data residency choice' },
  { key: 'prioritySupport', label: 'Priority support' },
];

/**
 * The pricing page.
 *
 * The whole matrix, rendered from the live API, with the Enterprise starting
 * price shown rather than a "Talk to Sales" button. The competitive research
 * behind this product identified opaque, sales-gated pricing as the single
 * most common buyer complaint in the category; this page is the answer to it,
 * so it deliberately hides nothing.
 */
export default async function PricingPage() {
  const { plans, note } = await fetchPlans();

  const ordered = ['community', 'free', 'growth', 'scale', 'enterprise']
    .map((id) => plans.find((p) => p.id === id))
    .filter((p): p is Plan => Boolean(p));

  return (
    <>
      <SiteHeader />

      <main id="main" className="container" style={{ padding: 'var(--sp-7) var(--sp-5) var(--sp-8)' }}>
        <div className="stack-lg stack">
          <div>
            <h1>Pricing</h1>
            <p className="lead" style={{ marginTop: 'var(--sp-3)' }}>
              Every plan is on this page, including Enterprise. Nothing is gated behind a call.
            </p>
          </div>

          <div className="row row-wrap" style={{ gap: 'var(--sp-2)' }}>
            <span className="badge badge-ok">$0 setup fee on every plan</span>
            <span className="badge badge-ok">No annual contract</span>
            <span className="badge badge-ok">Full data export, any time</span>
            <span className="badge badge-ok">Self-hosting is free and unlimited</span>
          </div>

          {ordered.length === 0 ? (
            <div className="banner banner-warn">
              The pricing service is unreachable right now. The published rates are on our
              repository README and do not change without notice.
            </div>
          ) : (
            <>
              <div className="price-grid">
                {ordered.map((plan) => (
                  <article
                    key={plan.id}
                    className={`price-card${plan.id === 'growth' ? ' featured' : ''}`}
                  >
                    <div>
                      <h2 style={{ fontSize: '1.05rem' }}>{plan.name}</h2>
                      <p className="subtle">{plan.blurb}</p>
                    </div>

                    <div className="price-amount">
                      {plan.priceCents === null
                        ? `From ${formatMoney(plan.startingAtCents ?? null)}`
                        : formatMoney(plan.priceCents)}
                      {plan.priceCents ? (
                        <span className="subtle" style={{ fontSize: '0.85rem', fontWeight: 400 }}>
                          {' '}
                          / month
                        </span>
                      ) : null}
                    </div>

                    <ul className="feature-list">
                      <li>
                        {plan.includedCredentialsPerYear === null
                          ? 'Unlimited credentials'
                          : `${plan.includedCredentialsPerYear.toLocaleString()} credentials/year`}
                      </li>
                      {plan.overageCentsPerCredential !== null && (
                        <li>
                          Then {formatMoney(plan.overageCentsPerCredential)} per credential — issuance
                          is never blocked
                        </li>
                      )}
                      <li>
                        {plan.features.seats === null
                          ? 'Unlimited team members'
                          : `${plan.features.seats} team members`}
                      </li>
                      <li>{plan.features.apiRateLimitPerMinute.toLocaleString()} API requests/min</li>
                    </ul>

                    <div className="spacer" />

                    {plan.selfHosted && plan.id === 'community' ? (
                      <a
                        className="btn btn-secondary"
                        href="https://github.com/opencred/opencred"
                        rel="noopener"
                      >
                        Install it yourself
                      </a>
                    ) : plan.id === 'enterprise' ? (
                      <a className="btn btn-secondary" href="mailto:sales@opencred.example">
                        Talk to us
                      </a>
                    ) : (
                      <Link
                        className={`btn ${plan.id === 'growth' ? 'btn-primary' : 'btn-secondary'}`}
                        href="/register"
                      >
                        Start on {plan.name.replace('Cloud ', '')}
                      </Link>
                    )}
                  </article>
                ))}
              </div>

              <section className="stack">
                <h2>Feature comparison</h2>
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Feature comparison across plans</caption>
                    <thead>
                      <tr>
                        <th scope="col">Feature</th>
                        {ordered.map((plan) => (
                          <th key={plan.id} scope="col">
                            {plan.name.replace(' (self-hosted)', '').replace('Cloud ', '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row" style={{ position: 'static', textTransform: 'none', fontSize: '0.88rem' }}>
                          Setup fee
                        </th>
                        {ordered.map((plan) => (
                          <td key={plan.id}>
                            <strong>$0</strong>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" style={{ position: 'static', textTransform: 'none', fontSize: '0.88rem' }}>
                          Annual contract required
                        </th>
                        {ordered.map((plan) => (
                          <td key={plan.id}>No</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row" style={{ position: 'static', textTransform: 'none', fontSize: '0.88rem' }}>
                          Analytics
                        </th>
                        {ordered.map((plan) => (
                          <td key={plan.id} style={{ textTransform: 'capitalize' }}>
                            {plan.features.analytics}
                          </td>
                        ))}
                      </tr>
                      {FEATURE_ROWS.map((row) => (
                        <tr key={row.key}>
                          <th
                            scope="row"
                            style={{ position: 'static', textTransform: 'none', fontSize: '0.88rem' }}
                          >
                            {row.label}
                          </th>
                          {ordered.map((plan) => (
                            <td key={plan.id}>
                              {plan.features[row.key] ? (
                                <span style={{ color: 'var(--ok)' }} aria-label="included">
                                  ✓
                                </span>
                              ) : (
                                <span className="subtle" aria-label="not included">
                                  —
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {note && (
                <div className="banner banner-info">
                  <div>{note}</div>
                </div>
              )}

              <section className="card card-pad stack-sm stack">
                <h2 style={{ fontSize: '1.05rem' }}>Why Cloud costs anything at all</h2>
                <p className="muted">
                  The Community Edition is the complete core platform: the same design studio, the
                  same issuance engine, the same standards conformance, unlimited credentials, under
                  AGPLv3. Nothing is withheld from it to make Cloud look better. Cloud plans exist
                  because running Postgres, a queue, an object store, a browser render farm and an
                  SMTP reputation is real work that someone has to do.
                </p>
                <p className="muted">
                  If you would rather do that work yourself, you should. The install is a{' '}
                  <code>docker compose up</code>.
                </p>
              </section>
            </>
          )}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
