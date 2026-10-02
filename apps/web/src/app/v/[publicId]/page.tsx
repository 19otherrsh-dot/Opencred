import type { Metadata } from 'next';
import Link from 'next/link';
import { SERVER_API_URL, PUBLIC_API_URL } from '@/lib/config';
import { getPageTranslator, type Translator } from '@/lib/locale';
import { VerificationActions } from './actions';
import { CredentialNotFound } from './credential-not-found';

/**
 * The public verification page (FR-VER-01).
 *
 * This is the single most important page in the product and the one with the
 * least forgiving audience: someone who scanned a QR code off a printed
 * certificate, on a phone, on mobile data, who has never heard of us and is
 * asking one question — is this real?
 *
 * So it is a server-rendered document, not an application. No client-side data
 * fetching, no loading spinner, no authentication. The answer is in the HTML of
 * the first response, and the interactive parts (share, add to LinkedIn) are a
 * small island of client code below the fold.
 *
 * It renders in the visitor's language (§9.4), including right-to-left, because
 * the person checking a credential is frequently not the person who issued it
 * and frequently not in the issuer's country.
 */

interface VerificationResponse {
  publicId: string;
  status: 'draft' | 'issued' | 'expired' | 'revoked';
  valid: boolean;
  kind: 'certificate' | 'badge';
  checks: {
    exists: boolean;
    signatureValid: boolean;
    notRevoked: boolean;
    notExpired: boolean;
    issuerTrusted: boolean;
    anchored: boolean | null;
  };
  issuer: { name: string; url: string | null; did: string | null; verified: boolean };
  recipient: { name: string; email: string | null };
  credential: {
    title: string;
    description: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
  };
  errors: string[];
  verifiedAt: string;
  badgeUrl: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  branding: {
    whiteLabel: boolean;
    headline: string | null;
    supportUrl: string | null;
    showIssuerContact: boolean;
    brand: { logo: string | null; primary: string };
    issuerContact: string | null;
  };
  // Absent on an older API; treated as "neither" rather than assumed available.
  wallets?: { apple: boolean; google: boolean };
}

async function fetchVerification(publicId: string): Promise<VerificationResponse | null> {
  const response = await fetch(
    `${SERVER_API_URL}/v1/public/credentials/${encodeURIComponent(publicId)}/page`,
    {
      // Never cached at the framework layer: a revocation must be visible on the
      // next load, and the CDN cache-control header already bounds this to 60s.
      cache: 'no-store',
      headers: { accept: 'application/json' },
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as VerificationResponse;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const result = await fetchVerification(publicId);

  if (!result) {
    return { title: 'Credential not found', robots: { index: false } };
  }

  const title = `${result.credential.title} — ${result.recipient.name}`;
  return {
    title,
    description: `Issued by ${result.issuer.name}.`,
    openGraph: {
      title,
      description: `Issued by ${result.issuer.name}`,
      ...(result.thumbnailUrl ? { images: [result.thumbnailUrl] } : {}),
    },
    // Verification pages carry a named individual's credential. They must be
    // reachable by anyone holding the link and indexed by nobody.
    robots: { index: false, follow: false },
  };
}

function Check({
  ok,
  label,
  detail,
  t,
}: {
  ok: boolean | null;
  label: string;
  detail: string;
  t: Translator;
}) {
  const state = ok === null ? 'skip' : ok ? 'pass' : 'fail';
  return (
    <li>
      <span className={`check-mark check-${state}`} aria-hidden="true">
        {state === 'pass' ? '✓' : state === 'fail' ? '✕' : '–'}
      </span>
      <span>
        <strong>{label}</strong>
        <span className="subtle"> — {detail}</span>
      </span>
      <span className="sr-only">
        {state === 'pass'
          ? t.t('verify.checks.passed')
          : state === 'fail'
            ? t.t('verify.checks.failed')
            : t.t('verify.checks.notChecked')}
      </span>
    </li>
  );
}

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { publicId } = await params;
  const [result, t] = await Promise.all([
    fetchVerification(publicId),
    getPageTranslator(await searchParams),
  ]);

  /*
   * Rendered inline rather than via `notFound()` and a `not-found.tsx`
   * boundary, deliberately.
   *
   * In this Next version, `notFound()` thrown from this route renders the
   * boundary in Next's bare fallback document (`<html id="__next_error__">`)
   * instead of inside the root layout — no `lang`, no `<main>` landmark, and
   * no stylesheet link. Verified against a production standalone build with a
   * static probe component, so it is the `notFound()` path itself and not
   * anything this page does. The root `app/not-found.tsx` composes correctly;
   * only the segment-level boundary does not.
   *
   * A mistyped credential ID is one of the most common ways anyone arrives
   * here, and an unstyled, unlandmarked page is a poor and inaccessible answer.
   * So the trade is: this responds 200 rather than 404, and in exchange the
   * page is styled, localised, RTL-correct and has proper landmarks. The
   * metadata still carries `robots: noindex`, and the machine-readable
   * endpoint — `GET /v1/public/credentials/:id`, which is what integrators and
   * crawlers actually consume — returns a correct 404.
   */
  if (!result) return <CredentialNotFound t={t} />;

  const { credential, issuer, recipient, checks, branding } = result;

  const tone = result.valid
    ? 'verify-valid'
    : result.status === 'expired'
      ? 'verify-warn'
      : 'verify-invalid';

  const headline = result.valid
    ? t.t('verify.valid.title')
    : result.status === 'revoked'
      ? t.t('verify.revoked.title')
      : result.status === 'expired'
        ? t.t('verify.expired.title')
        : t.t('verify.invalid.title');

  const subline = result.valid
    ? t.t('verify.valid.subtitle', { issuer: issuer.name })
    : result.status === 'revoked'
      ? credential.revokedAt
        ? t.t('verify.revoked.subtitle', {
            issuer: issuer.name,
            date: t.date(credential.revokedAt),
          })
        : t.t('verify.revoked.subtitleNoDate', { issuer: issuer.name })
      : result.status === 'expired'
        ? t.t('verify.expired.subtitle', { date: t.date(credential.expiresAt) })
        : t.t('verify.invalid.subtitle');

  return (
    // `dir` is set on the page rather than the root layout because only these
    // recipient-facing surfaces are localised; the dashboard stays LTR.
    <div className="verify-shell" dir={t.dir} lang={t.locale}>
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <div className="container row row-between" style={{ height: 60 }}>
          <div className="row" style={{ gap: 10 }}>
            {branding.brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.brand.logo}
                alt={issuer.name}
                style={{ height: 28, width: 'auto' }}
              />
            ) : (
              <strong>{issuer.name}</strong>
            )}
          </div>
          <Link href="/verify" className="subtle">
            {t.t('verify.action.verifyAnother')}
          </Link>
        </div>
      </header>

      <main id="main" className="container verify-hero" style={{ maxWidth: 880 }}>
        <div className={`verify-status ${tone}`} role="status">
          <span className="verify-status-icon" aria-hidden="true">
            {result.valid ? '✓' : result.status === 'expired' ? '!' : '✕'}
          </span>
          <div>
            <div style={{ fontSize: '1.05rem' }}>{headline}</div>
            <div className="subtle" style={{ fontWeight: 400 }}>
              {subline}
            </div>
          </div>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
            marginTop: 'var(--sp-5)',
          }}
        >
          <div className="stack">
            <section className="card card-pad stack">
              <div>
                <p className="eyebrow">{t.t('verify.section.credential')}</p>
                <h1 style={{ fontSize: '1.7rem', marginTop: 4 }}>{credential.title}</h1>
              </div>

              {credential.description && <p className="muted">{credential.description}</p>}

              <hr className="divider" />

              <dl className="kv">
                <dt>{t.t('verify.field.awardedTo')}</dt>
                <dd>
                  <strong>{recipient.name}</strong>
                  {recipient.email && <div className="subtle">{recipient.email}</div>}
                </dd>

                <dt>{t.t('verify.field.issuedBy')}</dt>
                <dd>
                  {issuer.url ? (
                    <a href={issuer.url} rel="noopener noreferrer nofollow">
                      {issuer.name}
                    </a>
                  ) : (
                    issuer.name
                  )}
                </dd>

                <dt>{t.t('verify.field.issueDate')}</dt>
                <dd>{t.date(credential.issuedAt)}</dd>

                {credential.expiresAt && (
                  <>
                    <dt>
                      {result.status === 'expired'
                        ? t.t('verify.field.expired')
                        : t.t('verify.field.validUntil')}
                    </dt>
                    <dd>{t.date(credential.expiresAt)}</dd>
                  </>
                )}

                {credential.revokedAt && (
                  <>
                    <dt>{t.t('verify.field.revoked')}</dt>
                    <dd>
                      {t.date(credential.revokedAt)}
                      {credential.revocationReason && (
                        <div className="subtle">{credential.revocationReason}</div>
                      )}
                    </dd>
                  </>
                )}

                <dt>{t.t('verify.field.credentialId')}</dt>
                <dd>
                  {/* Always LTR: the identifier is an ASCII token, and in an RTL
                      paragraph a bare alphanumeric string reorders visually. */}
                  <code className="mono" dir="ltr">
                    {result.publicId}
                  </code>
                </dd>
              </dl>
            </section>

            <section className="card card-pad stack">
              <div>
                <h2 style={{ fontSize: '1.05rem' }}>{t.t('verify.checks.title')}</h2>
                <p className="subtle">
                  {t.t('verify.checks.subtitle', { timestamp: t.dateTime(result.verifiedAt) })}
                </p>
              </div>

              <ul className="check-list">
                <Check
                  t={t}
                  ok={checks.signatureValid}
                  label={t.t('verify.checks.signature')}
                  detail={t.t('verify.checks.signatureDetail')}
                />
                <Check
                  t={t}
                  ok={checks.issuerTrusted}
                  label={t.t('verify.checks.issuer')}
                  detail={
                    issuer.did
                      ? t.t('verify.checks.issuerDetailDid', { did: issuer.did })
                      : t.t('verify.checks.issuerDetail')
                  }
                />
                <Check
                  t={t}
                  ok={checks.notRevoked}
                  label={t.t('verify.checks.revocation')}
                  detail={t.t('verify.checks.revocationDetail')}
                />
                <Check
                  t={t}
                  ok={checks.notExpired}
                  label={t.t('verify.checks.validity')}
                  detail={
                    credential.expiresAt
                      ? t.t('verify.checks.validityDetail', { date: t.date(credential.expiresAt) })
                      : t.t('verify.checks.validityDetailNever')
                  }
                />
                <Check
                  t={t}
                  ok={checks.anchored}
                  label={t.t('verify.checks.anchor')}
                  detail={t.t('verify.checks.anchorDetail')}
                />
              </ul>

              {result.errors.length > 0 && !result.valid && (
                <div className="banner banner-danger">
                  <div>
                    <strong>{t.t('verify.errors.title')}</strong>
                    <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                      {result.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="stack">
            {result.thumbnailUrl && (
              <div className="credential-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.thumbnailUrl}
                  alt={`${credential.title} — ${recipient.name}`}
                  loading="eager"
                />
              </div>
            )}

            <VerificationActions
              publicId={result.publicId}
              downloadUrl={result.downloadUrl}
              badgeUrl={result.badgeUrl}
              apiBase={PUBLIC_API_URL}
              title={credential.title}
              issuerName={issuer.name}
              issuedAt={credential.issuedAt}
              expiresAt={credential.expiresAt}
              valid={result.valid}
              wallets={result.wallets ?? { apple: false, google: false }}
              labels={{
                download: t.t('verify.action.download'),
                share: t.t('verify.action.share'),
                shareCopied: t.t('verify.action.shareCopied'),
                addToLinkedIn: t.t('verify.action.addToLinkedIn'),
                addToAppleWallet: t.t('verify.action.addToAppleWallet'),
                addToGoogleWallet: t.t('verify.action.addToGoogleWallet'),
                viewJson: t.t('verify.action.viewJson'),
              }}
            />

            <section className="card card-pad stack-sm stack">
              <h2 style={{ fontSize: '0.95rem' }}>{t.t('verify.developers.title')}</h2>
              <p className="subtle">{t.t('verify.developers.body')}</p>
              <a className="subtle" href={result.badgeUrl} rel="noopener">
                {t.t('verify.developers.jsonLink')} →
              </a>
              {issuer.did && (
                <div className="subtle">
                  {t.t('verify.developers.issuerDid')}:{' '}
                  <code className="mono" dir="ltr">
                    {issuer.did}
                  </code>
                </div>
              )}
            </section>

            {branding.showIssuerContact && branding.issuerContact && (
              <p className="subtle">
                {t.t('verify.contact', { email: branding.issuerContact })}
              </p>
            )}
          </div>
        </div>
      </main>

      {!branding.whiteLabel && (
        <footer
          className="container"
          style={{ padding: 'var(--sp-6) var(--sp-5)', borderTop: '1px solid var(--border)' }}
        >
          <p className="subtle">{t.t('verify.poweredBy')}</p>
        </footer>
      )}
    </div>
  );
}
