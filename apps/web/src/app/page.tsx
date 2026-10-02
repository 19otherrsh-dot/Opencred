import Link from 'next/link';
import { SERVER_API_URL } from '@/lib/config';
import { formatMoney } from '@/lib/format';
import { SiteHeader, SiteFooter } from '@/components/site-chrome';

/**
 * The landing page.
 *
 * The plan table is fetched from the live pricing API rather than hard-coded in
 * marketing copy. That is a small thing with a large point behind it: the page
 * a prospect reads and the API a customer is billed against cannot disagree,
 * which is exactly the failure the category is known for.
 */

interface Plan {
  id: string;
  name: string;
  priceCents: number | null;
  startingAtCents?: number;
  setupFeeCents: number;
  includedCredentialsPerYear: number | null;
  selfHosted: boolean;
  blurb: string;
}

async function fetchPlans(): Promise<Plan[]> {
  try {
    const response = await fetch(`${SERVER_API_URL}/v1/billing/plans`, {
      next: { revalidate: 300 },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { plans: Plan[] };
    return data.plans;
  } catch {
    // The marketing page must render even if the API is down.
    return [];
  }
}

const DIFFERENTIATORS = [
  {
    title: 'Actually open source',
    body: 'The core platform is AGPLv3 on GitHub. Not "open standards", not "open API" — you can read the code that signs your credentials, and run it yourself, for free, forever.',
  },
  {
    title: 'Standards-native, not standards-adjacent',
    body: 'Every credential is an Open Badges 3.0 AchievementCredential and a W3C Verifiable Credential, signed with a detached eddsa-jcs-2022 proof. Certificates too, not just badges.',
  },
  {
    title: 'Verifiable without us',
    body: 'Issuer identity is did:web, resolved from your own domain. Revocation is a W3C Bitstring Status List. A third party can verify a credential offline, with any conformant verifier.',
  },
  {
    title: 'Deploy it your way',
    body: 'Managed cloud, or a self-hosted Community Edition with Docker Compose or Helm. Data sovereignty that means running the software, not trusting a region label.',
  },
  {
    title: 'API-first, embeddable',
    body: 'Issue from your own product with one POST. Webhooks, an n8n node, a Moodle connector and an OpenAPI document generated from the running server.',
  },
  {
    title: 'Pricing you can read',
    body: 'Every tier published, including the Enterprise starting price. No setup fee on any plan. No annual contract to reach core features. Export everything, any time.',
  },
];

export default async function LandingPage() {
  const plans = await fetchPlans();
  const cloud = plans.filter((p) => !p.selfHosted && p.id !== 'enterprise');
  const community = plans.find((p) => p.id === 'community');

  return (
    <>
      <SiteHeader />

      <main id="main">
        <section className="container hero">
          <p className="eyebrow">Open source · Open Badges 3.0 · Self-hostable</p>
          <h1>Credentials your recipients own and anyone can verify</h1>
          <p className="lead">
            Issue certificates and badges at scale, sign them cryptographically, and let employers
            check them without an account. Run it on our infrastructure or entirely on yours.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-5)' }}>
            <Link className="btn btn-primary btn-lg" href="/register">
              Start free
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/verify">
              Verify a credential
            </Link>
          </div>
          <p className="subtle" style={{ marginTop: 'var(--sp-4)' }}>
            No credit card. No setup fee. No sales call.
          </p>
        </section>

        <section className="container" style={{ paddingBottom: 'var(--sp-8)' }}>
          <div className="grid grid-3">
            {DIFFERENTIATORS.map((item) => (
              <article key={item.title} className="card card-pad stack-sm stack">
                <h3>{item.title}</h3>
                <p className="muted" style={{ fontSize: '0.92rem' }}>
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="container"
          style={{ paddingBottom: 'var(--sp-8)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-7)' }}
        >
          <div className="stack-lg stack">
            <div>
              <h2>What a credential actually contains</h2>
              <p className="lead">
                Not a PDF with a QR code pointing at a database row. A signed, portable document
                that stands on its own.
              </p>
            </div>

            <div className="grid grid-2">
              <div className="card card-pad stack-sm stack">
                <h3 style={{ fontSize: '1rem' }}>The recipient gets</h3>
                <ul className="feature-list">
                  <li>A rendered PDF or PNG they can print and forward</li>
                  <li>A public verification page that works with no login</li>
                  <li>One-tap add to their LinkedIn profile</li>
                  <li>A wallet of every credential ever issued to their address</li>
                  <li>The signed JSON itself, portable to any other platform</li>
                </ul>
              </div>
              <div className="card card-pad stack-sm stack">
                <h3 style={{ fontSize: '1rem' }}>The verifier gets</h3>
                <ul className="feature-list">
                  <li>A signature check that detects any alteration</li>
                  <li>An issuer identity anchored to a real domain</li>
                  <li>Live revocation status from a published status list</li>
                  <li>A bulk API for checking a column of IDs at once</li>
                  <li>The ability to verify offline, without contacting us</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section
          className="container"
          style={{ paddingBottom: 'var(--sp-8)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-7)' }}
        >
          <div className="stack-lg stack">
            <div>
              <h2>Pricing, in full, on the page</h2>
              <p className="lead">
                Fetched live from the same API that bills you. Every plan, including Enterprise.
              </p>
            </div>

            <div className="price-grid">
              {community && (
                <article className="price-card">
                  <div>
                    <h3>{community.name}</h3>
                    <p className="subtle">{community.blurb}</p>
                  </div>
                  <div className="price-amount">$0</div>
                  <p className="subtle">Unlimited credentials. AGPLv3. Community support.</p>
                  <div className="spacer" />
                  <a
                    className="btn btn-secondary"
                    href="https://github.com/opencred/opencred"
                    rel="noopener"
                  >
                    Self-host it
                  </a>
                </article>
              )}

              {cloud.map((plan) => (
                <article
                  key={plan.id}
                  className={`price-card${plan.id === 'growth' ? ' featured' : ''}`}
                >
                  <div>
                    <h3>{plan.name}</h3>
                    <p className="subtle">{plan.blurb}</p>
                  </div>
                  <div className="price-amount">
                    {formatMoney(plan.priceCents)}
                    {plan.priceCents ? (
                      <span className="subtle" style={{ fontSize: '0.9rem', fontWeight: 400 }}>
                        {' '}
                        / month
                      </span>
                    ) : null}
                  </div>
                  <p className="subtle">
                    {plan.includedCredentialsPerYear === null
                      ? 'Unlimited credentials'
                      : `${plan.includedCredentialsPerYear.toLocaleString()} credentials per year`}
                  </p>
                  <div className="spacer" />
                  <Link
                    className={`btn ${plan.id === 'growth' ? 'btn-primary' : 'btn-secondary'}`}
                    href="/register"
                  >
                    Get started
                  </Link>
                </article>
              ))}
            </div>

            <p className="subtle">
              Every plan: $0 setup fee, no annual contract, full data export at any time.{' '}
              <Link href="/pricing">See the full comparison →</Link>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
