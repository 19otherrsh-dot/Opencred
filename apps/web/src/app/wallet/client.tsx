'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Field, Input, Spinner } from '@/components/ui';
import { PRODUCT } from '@/lib/config';

interface WalletCredential {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  issuer: { name: string; website: string | null };
  verificationUrl: string;
  downloadUrl: string;
  badgeUrl: string;
  thumbnailUrl: string | null;
}

export interface WalletLabels {
  title: string;
  intro: string;
  emailLabel: string;
  emailHint: string;
  requestLink: string;
  checkInbox: string;
  checkInboxBody: string;
  privacyNote: string;
  empty: string;
  count: string;
  issuedOn: string;
  expiresOn: string;
  download: string;
  verificationPage: string;
  theseAreYours: string;
  theseAreYoursBody: string;
  signOut: string;
  statusValid: string;
  statusExpired: string;
  statusRevoked: string;
}

/** Fills `{placeholder}` slots in a label resolved on the server. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/**
 * The recipient session token lives in `sessionStorage`.
 *
 * A deliberate, bounded trade-off rather than an oversight. It is a 15-minute,
 * read-only token scoped to one email address that can do nothing but list that
 * person's own credentials — no issuance, no settings, no other tenant. Keeping
 * it only in memory would mean re-emailing a link on every page refresh, which
 * for this audience is worse than the residual risk. The issuer dashboard, with
 * far more authority behind it, uses an httpOnly cookie instead.
 */
const TOKEN_KEY = 'opencred.wallet.token';

export function WalletClient({
  apiBase,
  locale,
  dir,
  labels,
}: {
  apiBase: string;
  locale: string;
  dir: 'ltr' | 'rtl';
  labels: WalletLabels;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [credentials, setCredentials] = useState<WalletCredential[] | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dates are formatted client-side but pinned to UTC, matching the
  // verification page: the same credential must not appear to have been issued
  // on different days to different people.
  const formatDate = useCallback(
    (value: string | null) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
    },
    [locale],
  );

  const statusLabel = useCallback(
    (status: string) =>
      status === 'revoked'
        ? labels.statusRevoked
        : status === 'expired'
          ? labels.statusExpired
          : labels.statusValid,
    [labels],
  );

  const load = useCallback(
    async (sessionToken: string) => {
      setBusy(true);
      try {
        const response = await fetch(`${apiBase}/v1/wallet/credentials`, {
          headers: { authorization: `Bearer ${sessionToken}` },
        });
        if (!response.ok) {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setError('Your session has expired. Request a new link.');
          return;
        }
        const data = (await response.json()) as { email: string; credentials: WalletCredential[] };
        setCredentials(data.credentials);
        setSignedInAs(data.email);
      } catch {
        setError('Could not reach the credential service.');
      } finally {
        setBusy(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
      void load(stored);
    }
  }, [load]);

  const requestLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetch(`${apiBase}/v1/auth/wallet/request-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setError('Could not reach the credential service.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCredentials(null);
    setSignedInAs(null);
    setSent(false);
  };

  return (
    <div className="verify-shell" dir={dir} lang={locale}>
      <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="container row row-between" style={{ height: 60 }}>
          <Link href="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'var(--text)' }}>
            {PRODUCT.name}
          </Link>
          {signedInAs && (
            <div className="row">
              <span className="subtle truncate" style={{ maxWidth: 200 }} dir="ltr">
                {signedInAs}
              </span>
              <Button size="sm" variant="ghost" onClick={signOut}>
                {labels.signOut}
              </Button>
            </div>
          )}
        </div>
      </header>

      <main id="main" className="container" style={{ padding: 'var(--sp-7) var(--sp-5)' }}>
        {!token ? (
          <div className="stack" style={{ maxWidth: 460, marginInline: 'auto' }}>
            <div>
              <h1>{labels.title}</h1>
              <p className="lead" style={{ marginTop: 'var(--sp-3)' }}>
                {labels.intro}
              </p>
            </div>

            {error && <Banner tone="danger">{error}</Banner>}

            {sent ? (
              <Banner tone="ok" title={labels.checkInbox}>
                {fill(labels.checkInboxBody, { email })}
              </Banner>
            ) : (
              <form onSubmit={requestLink} className="card card-pad stack">
                <Field label={labels.emailLabel} hint={labels.emailHint} required>
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      dir="ltr"
                      required
                      autoFocus
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={busy}>
                  {labels.requestLink}
                </Button>
              </form>
            )}

            <p className="subtle">{labels.privacyNote}</p>
          </div>
        ) : busy && !credentials ? (
          <Spinner />
        ) : (
          <div className="stack-lg stack">
            <div>
              <h1>{labels.title}</h1>
              <p className="subtle">
                {fill(labels.count, {
                  count: credentials?.length ?? 0,
                  email: signedInAs ?? '',
                })}
              </p>
            </div>

            {(credentials?.length ?? 0) === 0 ? (
              <div className="card card-pad">
                <p className="muted">{labels.empty}</p>
              </div>
            ) : (
              <div className="grid grid-3">
                {credentials?.map((credential) => (
                  <article key={credential.id} className="card stack-sm stack">
                    {credential.thumbnailUrl && (
                      <div className="credential-preview" style={{ borderRadius: 0, border: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={credential.thumbnailUrl}
                          alt={`${credential.title} — ${credential.issuer.name}`}
                          loading="lazy"
                        />
                      </div>
                    )}

                    <div className="card-body stack-sm stack">
                      <div className="row row-between">
                        <span className="eyebrow">{credential.issuer.name}</span>
                        <span
                          className={`badge ${
                            credential.status === 'revoked'
                              ? 'badge-danger'
                              : credential.status === 'expired'
                                ? 'badge-warn'
                                : 'badge-ok'
                          }`}
                        >
                          {statusLabel(credential.status)}
                        </span>
                      </div>

                      <h2 style={{ fontSize: '1rem' }}>{credential.title}</h2>

                      <p className="subtle">
                        {fill(labels.issuedOn, { date: formatDate(credential.issuedAt) })}
                        {credential.expiresAt
                          ? ` · ${fill(labels.expiresOn, { date: formatDate(credential.expiresAt) })}`
                          : ''}
                      </p>

                      <div className="row row-wrap" style={{ gap: 6 }}>
                        <a className="btn btn-primary btn-sm" href={credential.downloadUrl} download>
                          {labels.download}
                        </a>
                        <a
                          className="btn btn-secondary btn-sm"
                          href={credential.verificationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {labels.verificationPage}
                        </a>
                        <a className="btn btn-ghost btn-sm" href={credential.badgeUrl} rel="noopener">
                          JSON
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <Banner tone="info" title={labels.theseAreYours}>
              {labels.theseAreYoursBody}
            </Banner>
          </div>
        )}
      </main>
    </div>
  );
}
