'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, downloadFile } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateShort, formatNumber } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Input,
  SkeletonRows,
} from '@/components/ui';

interface RecipientRow {
  id: string;
  name: string;
  email: string;
  externalId: string | null;
  tags: string[];
  credentialCount: number;
  erasedAt: string | null;
  createdAt: string;
}

export default function RecipientsPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (query.trim()) params.set('q', query.trim());
    if (cursor) params.set('cursor', cursor);
    return `/v1/recipients?${params.toString()}`;
  }, [query, cursor]);

  const { data, error, loading, reload } = useApi<{
    data: RecipientRow[];
    nextCursor: string | null;
  }>(path);

  const [resent, setResent] = useState<number | null>(null);

  const resendBounced = useMutation(async () => {
    const result = await api.post<{ queued: number }>('/v1/recipients/resend', {
      segment: 'bounced',
    });
    setResent(result.queued);
    reload();
    return result;
  });

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Recipients</h1>
          <p className="subtle">
            De-duplicated by email, with external ID as the tie-breaker.
          </p>
        </div>
        <div className="row">
          {can('credentials:issue') && (
            <Button loading={resendBounced.busy} onClick={() => void resendBounced.run()}>
              Re-send to bounced
            </Button>
          )}
          {can('data:export') && (
            <Button
              onClick={() => void downloadFile('/v1/recipients/export.csv', 'recipients.csv')}
            >
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorNotice error={error} />}
      {resendBounced.error && <ErrorNotice error={resendBounced.error} />}

      {resent !== null && (
        <Banner tone={resent > 0 ? 'ok' : 'info'}>
          {resent > 0
            ? `Queued ${formatNumber(resent)} credential emails for recipients whose last delivery failed.`
            : 'No failed deliveries to retry — every credential email has landed.'}
        </Banner>
      )}

      <Card>
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <label className="sr-only" htmlFor="recipient-search">
            Search recipients
          </label>
          <Input
            id="recipient-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(null);
            }}
            placeholder="Search by name, email or external ID"
            style={{ maxWidth: 380 }}
          />
        </div>

        {loading ? (
          <SkeletonRows rows={6} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No recipients yet">
            Recipients are created automatically when you issue credentials to them.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <caption className="sr-only">Recipients</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">External ID</th>
                    <th scope="col">Credentials</th>
                    <th scope="col">Tags</th>
                    <th scope="col">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((recipient) => (
                    <tr key={recipient.id}>
                      <td>
                        <Link href={`/recipients/${recipient.id}`}>{recipient.name}</Link>
                        {recipient.erasedAt && (
                          <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                            Erased
                          </span>
                        )}
                      </td>
                      <td className="subtle truncate" style={{ maxWidth: 240 }}>
                        {recipient.email}
                      </td>
                      <td className="subtle">
                        {recipient.externalId ? (
                          <code className="mono">{recipient.externalId}</code>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatNumber(recipient.credentialCount)}</td>
                      <td>
                        {recipient.tags.length === 0 ? (
                          <span className="subtle">—</span>
                        ) : (
                          <span className="row row-wrap" style={{ gap: 4 }}>
                            {recipient.tags.map((tag) => (
                              <span key={tag} className="badge badge-neutral">
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="subtle">{formatDateShort(recipient.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data?.nextCursor && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
                <Button onClick={() => setCursor(data.nextCursor)}>Load more</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Banner tone="info" title="Data protection">
        A recipient can ask for their data. Export or erase it from{' '}
        <Link href="/settings/data">Settings → Data protection</Link>. Erasure is honest about
        being destructive: it revokes the affected credentials, because a credential is a signed
        statement about a named person.
      </Banner>
    </div>
  );
}
