'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { Banner, Button, Field, Input } from '@/components/ui';

/**
 * Two screens in one route: request a link, and set a new password with the
 * token from that link. Which one shows is decided by the presence of `?token`,
 * so the email can point straight here.
 */
export function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/auth/password-reset/request', { email });
      setSent(true);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/auth/password-reset/confirm', { token, password });
      router.push('/login?reset=1');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  if (token) {
    return (
      <form onSubmit={confirmReset} className="stack">
        {error && <Banner tone="danger">{error}</Banner>}

        <Field label="New password" hint="At least 12 characters." required>
          {(props) => (
            <Input
              {...props}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
              autoFocus
            />
          )}
        </Field>

        <Field label="Confirm new password" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          )}
        </Field>

        <Button type="submit" variant="primary" loading={busy}>
          Set new password
        </Button>

        <p className="subtle">
          Setting a new password signs out every other session on your account.
        </p>
      </form>
    );
  }

  if (sent) {
    return (
      <div className="stack">
        <Banner tone="ok" title="Check your email">
          If <strong>{email}</strong> has an account, a reset link is on its way. The link expires
          in one hour.
        </Banner>
        <p className="subtle">
          We do not disclose whether an address is registered, so this message appears either way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={request} className="stack">
      {error && <Banner tone="danger">{error}</Banner>}

      <Field label="Email" hint="We will send a single-use link, valid for one hour." required>
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

      <Button type="submit" variant="primary" loading={busy}>
        Email me a reset link
      </Button>
    </form>
  );
}
