'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Banner, Button, Card, ErrorNotice, Field, Input } from '@/components/ui';

interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  hasPassword: boolean;
  verification?: { ok: boolean; error?: string };
}

/**
 * FR-ISS-07 — bring your own email provider.
 *
 * This page exists because credential emails are exactly the kind of mail
 * recipients are trained to distrust ("you have a certificate, click here").
 * Sending them from a shared platform domain means one careless tenant's
 * reputation becomes everyone's spam folder.
 */
export default function EmailSettingsPage() {
  const { can } = useAuth();
  const settings = useApi<EmailSettings>('/v1/org/email');
  const [form, setForm] = useState({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    from: '',
  });
  const [result, setResult] = useState<EmailSettings | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      enabled: settings.data.enabled,
      host: settings.data.host,
      port: settings.data.port,
      secure: settings.data.secure,
      user: settings.data.user,
      password: '',
      from: settings.data.from,
    });
  }, [settings.data]);

  const save = useMutation(async () => {
    const payload = {
      enabled: form.enabled,
      host: form.host,
      port: Number(form.port),
      secure: form.secure,
      user: form.user || undefined,
      // An empty field means "keep what is stored", so the host can be edited
      // without re-entering a secret nobody has a copy of.
      ...(form.password ? { password: form.password } : {}),
      from: form.from,
    };
    const updated = await api.patch<EmailSettings>('/v1/org/email', payload);
    setResult(updated);
    settings.reload();
  });

  if (settings.loading) return <div className="skeleton" style={{ height: 320 }} />;
  if (settings.error) return <ErrorNotice error={settings.error} />;

  const readOnly = !can('org:update');

  return (
    <div className="stack">
      <Card
        title="Your SMTP provider"
        description="Send credential emails from your own domain, through SES, SendGrid, Postal, or any SMTP server."
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run();
          }}
        >
          {save.error && <ErrorNotice error={save.error} />}

          {result?.verification && (
            <Banner tone={result.verification.ok ? 'ok' : 'danger'}>
              {result.verification.ok
                ? 'Connected to your SMTP server successfully.'
                : `Saved, but the connection test failed: ${result.verification.error}`}
            </Banner>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>
              Use my own SMTP server
              <span className="hint" style={{ display: 'block' }}>
                Off means credential emails go out through the platform&rsquo;s default sender.
              </span>
            </span>
          </label>

          <div className="grid grid-2">
            <Field label="Host" required={form.enabled}>
              {(props) => (
                <Input
                  {...props}
                  value={form.host}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="email-smtp.eu-west-1.amazonaws.com"
                  spellCheck={false}
                />
              )}
            </Field>

            <Field label="Port" hint="587 for STARTTLS, 465 for implicit TLS.">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  value={form.port}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                />
              )}
            </Field>

            <Field label="Username">
              {(props) => (
                <Input
                  {...props}
                  value={form.user}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>

            <Field
              label="Password"
              hint={
                settings.data?.hasPassword
                  ? 'A password is stored. Leave empty to keep it.'
                  : 'Encrypted at rest with AES-256-GCM and never returned by the API.'
              }
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={form.password}
                  disabled={readOnly}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                  placeholder={settings.data?.hasPassword ? '••••••••' : ''}
                />
              )}
            </Field>
          </div>

          <Field
            label="From address"
            hint="Must be an address your provider is authorised to send as."
            required={form.enabled}
          >
            {(props) => (
              <Input
                {...props}
                value={form.from}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                placeholder="Example Institute <credentials@example.edu>"
              />
            )}
          </Field>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.secure}
              disabled={readOnly}
              onChange={(e) => setForm({ ...form, secure: e.target.checked })}
            />
            <span>Implicit TLS (port 465)</span>
          </label>

          {!readOnly && (
            <div className="row">
              <Button type="submit" variant="primary" loading={save.busy}>
                Save and test connection
              </Button>
            </div>
          )}
        </form>
      </Card>

      <Banner tone="info" title="Why this matters">
        Deliverability is the part of credentialing nobody demos. A certificate email that lands in
        spam is a certificate the recipient never sees, and a shared sending domain means your
        deliverability depends on strangers. Sending from your own domain — with your own SPF,
        DKIM and DMARC — is the only way to own that outcome.
      </Banner>
    </div>
  );
}
