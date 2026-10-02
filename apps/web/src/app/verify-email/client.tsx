'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api';
import { Banner, Spinner } from '@/components/ui';

export function VerifyEmailClient() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('This link is missing its token. Use the link from the email exactly as sent.');
      return;
    }

    void api
      .post<{ email: string }>('/v1/auth/verify-email', { token })
      .then((result) => {
        setState('done');
        setMessage(result.email);
      })
      .catch((err: ApiError) => {
        setState('failed');
        setMessage(err.message);
      });
  }, [token]);

  if (state === 'working') return <Spinner label="Confirming" />;

  if (state === 'done') {
    return (
      <div className="stack">
        <Banner tone="ok" title="Email confirmed">
          <strong>{message}</strong> is now verified.
        </Banner>
        <Link className="btn btn-primary btn-block" href="/dashboard">
          Go to your workspace
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <Banner tone="danger" title="That link did not work">
        {message}
      </Banner>
      <p className="subtle">
        Confirmation links are single-use and expire after 24 hours. Sign in and request a new one
        from your account settings.
      </p>
      <Link className="btn btn-secondary btn-block" href="/login">
        Sign in
      </Link>
    </div>
  );
}
