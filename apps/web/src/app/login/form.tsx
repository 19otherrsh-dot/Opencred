'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, setAccessToken, type ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PUBLIC_API_URL } from '@/lib/config';
import { Banner, Button, Field, Input } from '@/components/ui';

interface Session {
  accessToken: string;
  organizations: Array<{ id: string; name: string; role: string }>;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  const next = params.get('next') ?? '/dashboard';

  // Only offer the OAuth buttons this deployment has actually configured. A
  // self-hosted install with no Google credentials should not show a button
  // that leads to an error page.
  useEffect(() => {
    void fetch(`${PUBLIC_API_URL}/v1/auth/oauth`)
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data: { providers: string[] }) => setProviders(data.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const session = await api.post<Session>('/v1/auth/login', { email, password });
      setAccessToken(session.accessToken);
      await refresh();
      router.push(next);
    } catch (err) {
      setError((err as ApiError).message ?? 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      {error && <Banner tone="danger">{error}</Banner>}

      <Field label="Email">
        {(props) => (
          <Input
            {...props}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        )}
      </Field>

      <Field label="Password">
        {(props) => (
          <Input
            {...props}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>

      <Button type="submit" variant="primary" loading={busy}>
        Sign in
      </Button>

      <div className="row row-between">
        <Link className="subtle" href="/reset-password">
          Forgot your password?
        </Link>
        <Link className="subtle" href="/wallet">
          I&rsquo;m a recipient
        </Link>
      </div>

      {providers.length > 0 && (
        <>
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <hr className="divider" style={{ flex: 1 }} />
            <span className="subtle">or</span>
            <hr className="divider" style={{ flex: 1 }} />
          </div>

          {providers.map((provider) => (
            <a
              key={provider}
              className="btn btn-secondary btn-block"
              href={`${PUBLIC_API_URL}/v1/auth/oauth/${provider}?redirect=${encodeURIComponent(next)}`}
            >
              Continue with {provider === 'google' ? 'Google' : 'Microsoft'}
            </a>
          ))}
        </>
      )}
    </form>
  );
}
