'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Spinner } from '@/components/ui';

/**
 * Consumes the magic link and hands the session to the wallet.
 *
 * The token in the URL is single-use and is exchanged immediately, then the
 * address bar is cleaned so the raw link does not survive in history or get
 * pasted into a support ticket.
 */
export function WalletEnterClient({ apiBase }: { apiBase: string }) {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its token. Use the link from the email exactly as sent.');
      return;
    }

    void (async () => {
      try {
        const response = await fetch(`${apiBase}/v1/auth/wallet/consume-link`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? 'That link is no longer valid.');
          return;
        }

        const session = (await response.json()) as { token: string; email: string };
        sessionStorage.setItem('opencred.wallet.token', session.token);
        router.replace('/wallet');
      } catch {
        setError('Could not reach the credential service.');
      }
    })();
  }, [token, apiBase, router]);

  if (error) {
    return (
      <div className="stack" style={{ maxWidth: 420, padding: 'var(--sp-5)' }}>
        <Banner tone="danger" title="That link did not work">
          {error}
        </Banner>
        <p className="subtle">
          Sign-in links are single-use and expire after 30 minutes.{' '}
          <Link href="/wallet">Request a new one</Link>.
        </p>
      </div>
    );
  }

  return <Spinner label="Signing you in" />;
}
