'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Banner, Button, Card, CopyButton, ErrorNotice, Field, Input } from '@/components/ui';

interface Branding {
  brandKit: {
    logo: string | null;
    palette: { primary: string; secondary: string; accent: string; surface: string; text: string };
    fonts: { heading: string; body: string; accent: string };
    signatures: Array<{ id: string; label: string; name: string; title: string; image: string }>;
  };
  email: {
    fromName: string | null;
    replyTo: string | null;
    accentColor: string;
    footerText: string | null;
    subjectTemplate: string;
    bodyIntro: string;
  };
  customDomain: string | null;
  customDomainVerifiedAt: string | null;
  whiteLabel: boolean;
  verificationPage: {
    headline: string | null;
    supportUrl: string | null;
    showRecipientEmail: boolean;
    showIssuerContact: boolean;
  };
  available: { customDomain: boolean; whiteLabel: boolean };
  dnsInstructions: {
    records: Array<{ type: string; name: string; value: string; purpose: string }>;
    note: string;
  } | null;
}

export default function BrandingSettingsPage() {
  const { can } = useAuth();
  const branding = useApi<Branding>('/v1/org/branding');
  const [draft, setDraft] = useState<Branding | null>(null);
  const [saved, setSaved] = useState(false);
  const [domainResult, setDomainResult] = useState<{
    verified: boolean;
    checks: { errors: string[] };
  } | null>(null);

  useEffect(() => {
    if (branding.data) setDraft(branding.data);
  }, [branding.data]);

  const save = useMutation(async () => {
    if (!draft) return;
    await api.patch('/v1/org/branding', {
      brandKit: draft.brandKit,
      email: draft.email,
      customDomain: draft.customDomain || null,
      whiteLabel: draft.whiteLabel,
      verificationPage: draft.verificationPage,
    });
    setSaved(true);
    branding.reload();
  });

  const verifyDomain = useMutation(async () => {
    const result = await api.post<{ verified: boolean; checks: { errors: string[] } }>(
      '/v1/org/branding/verify-domain',
    );
    setDomainResult(result);
    branding.reload();
  });

  const uploadLogo = useMutation(async (file: File) => {
    const form = new FormData();
    form.set('file', file);
    form.set('purpose', 'brand');
    const asset = await api.post<{ reference: string }>('/v1/org/assets', form);
    setDraft((current) =>
      current ? { ...current, brandKit: { ...current.brandKit, logo: asset.reference } } : current,
    );
  });

  if (branding.loading || !draft) return <div className="skeleton" style={{ height: 400 }} />;
  if (branding.error) return <ErrorNotice error={branding.error} />;

  const readOnly = !can('org:update');

  return (
    <div className="stack">
      {save.error && <ErrorNotice error={save.error} />}
      {saved && !save.error && <Banner tone="ok">Branding saved.</Banner>}

      <Card
        title="Brand kit"
        description="Templates reference these by name, so changing them updates every design at once."
      >
        <div className="stack">
          <Field label="Logo" hint="PNG or SVG. Used wherever a template has a logo slot.">
            {(props) => (
              <div className="row row-wrap">
                {draft.brandKit.logo && (
                  <code className="mono subtle truncate" style={{ maxWidth: 260 }}>
                    {draft.brandKit.logo}
                  </code>
                )}
                <input
                  {...props}
                  className="input"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  disabled={readOnly}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo.run(file);
                  }}
                  style={{ maxWidth: 320 }}
                />
              </div>
            )}
          </Field>

          <div className="grid grid-3">
            {(['primary', 'secondary', 'accent'] as const).map((slot) => (
              <Field key={slot} label={`${slot[0].toUpperCase()}${slot.slice(1)} colour`}>
                {(props) => (
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      type="color"
                      className="color-input"
                      value={draft.brandKit.palette[slot]}
                      disabled={readOnly}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          brandKit: {
                            ...draft.brandKit,
                            palette: { ...draft.brandKit.palette, [slot]: e.target.value },
                          },
                        })
                      }
                      style={{ width: 44, flex: 'none' }}
                      aria-label={`${slot} colour swatch`}
                    />
                    <Input
                      {...props}
                      value={draft.brandKit.palette[slot]}
                      disabled={readOnly}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          brandKit: {
                            ...draft.brandKit,
                            palette: { ...draft.brandKit.palette, [slot]: e.target.value },
                          },
                        })
                      }
                    />
                  </div>
                )}
              </Field>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title="Verification domain"
        description="Serve verification pages from your own domain, so recipients and employers never leave your brand."
      >
        <div className="stack">
          {!draft.available.customDomain && (
            <Banner tone="info">
              A custom domain is included on every paid tier and on the self-hosted Community
              Edition. It is not an enterprise-only feature here.
            </Banner>
          )}

          <Field
            label="Domain"
            hint="For example certs.example.edu. This becomes part of your issuer DID, so it must be verified before it takes effect."
          >
            {(props) => (
              <Input
                {...props}
                value={draft.customDomain ?? ''}
                disabled={readOnly || !draft.available.customDomain}
                onChange={(e) => setDraft({ ...draft, customDomain: e.target.value })}
                placeholder="certs.example.edu"
                spellCheck={false}
              />
            )}
          </Field>

          {draft.customDomainVerifiedAt ? (
            <Banner tone="ok">Verified. Credentials are issued under this domain.</Banner>
          ) : draft.customDomain ? (
            <Banner tone="warn">
              Not verified yet. Add the DNS records below, then check them.
            </Banner>
          ) : null}

          {branding.data?.dnsInstructions && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Required DNS records</caption>
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Name</th>
                      <th scope="col">Value</th>
                      <th scope="col">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branding.data.dnsInstructions.records.map((record) => (
                      <tr key={record.type}>
                        <td>
                          <code className="mono">{record.type}</code>
                        </td>
                        <td>
                          <code className="mono">{record.name}</code>
                        </td>
                        <td>
                          <span className="row" style={{ gap: 4 }}>
                            <code className="mono truncate" style={{ maxWidth: 220 }}>
                              {record.value}
                            </code>
                            <CopyButton value={record.value} label="" />
                          </span>
                        </td>
                        <td className="subtle">{record.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="subtle">{branding.data.dnsInstructions.note}</p>

              {can('org:update') && (
                <div className="row">
                  <Button loading={verifyDomain.busy} onClick={() => void verifyDomain.run()}>
                    Check DNS now
                  </Button>
                </div>
              )}

              {domainResult && !domainResult.verified && (
                <Banner tone="danger" title="Not verified yet">
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {domainResult.checks.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </Banner>
              )}
            </>
          )}
        </div>
      </Card>

      <Card title="Verification page">
        <div className="stack">
          <Field label="Headline" hint="Replaces the default heading on your verification pages.">
            {(props) => (
              <Input
                {...props}
                value={draft.verificationPage.headline ?? ''}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    verificationPage: { ...draft.verificationPage, headline: e.target.value },
                  })
                }
              />
            )}
          </Field>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.verificationPage.showRecipientEmail}
              disabled={readOnly}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  verificationPage: {
                    ...draft.verificationPage,
                    showRecipientEmail: e.target.checked,
                  },
                })
              }
            />
            <span>
              Show the recipient&rsquo;s email address publicly
              <span className="hint" style={{ display: 'block' }}>
                Off by default, and we would leave it off. A verification page is public, and the
                credential already proves the holder&rsquo;s identity cryptographically.
              </span>
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.whiteLabel}
              disabled={readOnly || !draft.available.whiteLabel}
              onChange={(e) => setDraft({ ...draft, whiteLabel: e.target.checked })}
            />
            <span>
              Remove all OpenCred branding
              <span className="hint" style={{ display: 'block' }}>
                {draft.available.whiteLabel
                  ? 'No OpenCred marks on verification pages, emails or PDFs.'
                  : 'Available on Cloud Scale and above, and on self-hosted installations.'}
              </span>
            </span>
          </label>
        </div>
      </Card>

      {can('org:update') && (
        <div className="row">
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Save branding
          </Button>
        </div>
      )}
    </div>
  );
}
