'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, setAccessToken, type ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Banner, Button, Field, Input } from '@/components/ui';

export function RegisterForm() {
  const router = useRouter();
  const { refresh } = useAuth();

  const [form, setForm] = useState({
    organizationName: '',
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const passwordTooShort = form.password.length > 0 && form.password.length < 12;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const session = await api.post<{ accessToken: string }>('/v1/auth/register', form);
      setAccessToken(session.accessToken);
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      {error && <Banner tone="danger">{error.message}</Banner>}

      <Field label="Organisation name" hint="Appears on every credential you issue." required>
        {(props) => (
          <Input
            {...props}
            value={form.organizationName}
            onChange={set('organizationName')}
            placeholder="Example Institute"
            required
            autoFocus
          />
        )}
      </Field>

      <Field label="Your name" required>
        {(props) => (
          <Input {...props} value={form.name} onChange={set('name')} autoComplete="name" required />
        )}
      </Field>

      <Field label="Work email" required>
        {(props) => (
          <Input
            {...props}
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="username"
            required
          />
        )}
      </Field>

      <Field
        label="Password"
        hint="At least 12 characters. Length beats symbols — a passphrase is fine."
        error={passwordTooShort ? 'Needs at least 12 characters.' : null}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            minLength={12}
            required
          />
        )}
      </Field>

      <Button type="submit" variant="primary" loading={busy} disabled={passwordTooShort}>
        Create workspace
      </Button>

      <p className="subtle">
        Your workspace gets its own Ed25519 signing key and a{' '}
        <code className="mono">did:web</code> issuer identity immediately. Credentials you issue are
        yours, and you can export everything at any time.
      </p>
    </form>
  );
}
