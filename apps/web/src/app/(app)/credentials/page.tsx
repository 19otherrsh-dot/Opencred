'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { downloadFile } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateShort } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Input,
  Select,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui';

interface CredentialRow {
  id: string;
  publicId: string;
  title: string;
  kind: string;
  status: string;
  recipient: { id: string; name: string; email: string; externalId: string | null };
  template: { id: string; name: string };
  issuedAt: string;
  expiresAt: string | null;
  emailStatus: string;
  verificationUrl: string;
}

export default function CredentialsPage() {
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '25' });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    if (cursor) params.set('cursor', cursor);
    return `/v1/credentials?${params.toString()}`;
  }, [query, status, cursor]);

  const { data, error, loading } = useApi<{ data: CredentialRow[]; nextCursor: string | null }>(path);

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Credentials</h1>
          <p className="subtle">Everything this workspace has issued.</p>
        </div>
        <div className="row">
          {can('data:export') && (
            <Button
              onClick={() => void downloadFile('/v1/credentials/export.csv', 'credentials.csv')}
            >
              Export CSV
            </Button>
          )}
          {can('credentials:issue') && (
            <Link className="btn btn-primary" href="/credentials/new">
              Issue a credential
            </Link>
          )}
        </div>
      </div>

      {error && <ErrorNotice error={error} />}

      <Card>
        <div className="row row-wrap" style={{ marginBottom: 'var(--sp-4)' }}>
          <label className="sr-only" htmlFor="credential-search">
            Search credentials
          </label>
          <Input
            id="credential-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(null);
            }}
            placeholder="Search by recipient, email, title or credential ID"
            style={{ maxWidth: 380 }}
          />

          <label className="sr-only" htmlFor="credential-status">
            Filter by status
          </label>
          <Select
            id="credential-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor(null);
            }}
            style={{ maxWidth: 180 }}
          >
            <option value="">All statuses</option>
            <option value="issued">Valid</option>
            <option value="draft">Processing</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </Select>
        </div>

        {loading ? (
          <SkeletonRows rows={6} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No credentials match">
            {query || status
              ? 'Try clearing the filters.'
              : 'Issue your first credential to see it here.'}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <caption className="sr-only">Issued credentials</caption>
                <thead>
                  <tr>
                    <th scope="col">Recipient</th>
                    <th scope="col">Credential</th>
                    <th scope="col">Status</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">Issued</th>
                    <th scope="col">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/credentials/${row.id}`}>{row.recipient.name}</Link>
                        <div className="subtle">{row.recipient.email}</div>
                      </td>
                      <td>
                        {row.title}
                        <div className="subtle">{row.template.name}</div>
                      </td>
                      <td>
                        <StatusBadge status={row.status} />
                        {row.expiresAt && row.status === 'issued' && (
                          <div className="subtle">expires {formatDateShort(row.expiresAt)}</div>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={row.emailStatus} />
                      </td>
                      <td className="subtle">{formatDateShort(row.issuedAt)}</td>
                      <td>
                        <a
                          className="mono"
                          href={row.verificationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.publicId}
                        </a>
                      </td>
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
    </div>
  );
}
