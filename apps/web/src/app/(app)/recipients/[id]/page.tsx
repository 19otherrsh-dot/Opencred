'use client';

import Link from 'next/link';
import { use } from 'react';
import { useApi } from '@/lib/use-api';
import { formatDate, formatDateShort } from '@/lib/format';
import { Card, ErrorNotice, StatusBadge } from '@/components/ui';

interface RecipientDetail {
  id: string;
  name: string;
  email: string;
  externalId: string | null;
  tags: string[];
  erasedAt: string | null;
  createdAt: string;
  credentials: Array<{
    id: string;
    publicId: string;
    title: string;
    status: string;
    issuedAt: string;
    expiresAt: string | null;
    emailStatus: string;
  }>;
}

export default function RecipientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useApi<RecipientDetail>(`/v1/recipients/${id}`);

  if (loading) return <div className="skeleton" style={{ height: 320 }} />;
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;

  return (
    <div className="stack-lg stack">
      <div>
        <Link className="subtle" href="/recipients">
          ← All recipients
        </Link>
        <h1 style={{ marginTop: 'var(--sp-3)' }}>{data.name}</h1>
        <p className="subtle">{data.email}</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)' }}>
        <Card title="Details">
          <dl className="kv">
            <dt>External ID</dt>
            <dd>{data.externalId ? <code className="mono">{data.externalId}</code> : '—'}</dd>
            <dt>Tags</dt>
            <dd>
              {data.tags.length === 0 ? (
                <span className="subtle">None</span>
              ) : (
                <span className="row row-wrap" style={{ gap: 4 }}>
                  {data.tags.map((tag) => (
                    <span key={tag} className="badge badge-neutral">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </dd>
            <dt>First seen</dt>
            <dd>{formatDate(data.createdAt)}</dd>
            {data.erasedAt && (
              <>
                <dt>Erased</dt>
                <dd>{formatDate(data.erasedAt)}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card title="Credentials" description={`${data.credentials.length} issued to this person`}>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <caption className="sr-only">Credentials issued to this recipient</caption>
              <thead>
                <tr>
                  <th scope="col">Credential</th>
                  <th scope="col">Status</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Issued</th>
                </tr>
              </thead>
              <tbody>
                {data.credentials.map((credential) => (
                  <tr key={credential.id}>
                    <td>
                      <Link href={`/credentials/${credential.id}`}>{credential.title}</Link>
                      <div className="subtle mono">{credential.publicId}</div>
                    </td>
                    <td>
                      <StatusBadge status={credential.status} />
                    </td>
                    <td>
                      <StatusBadge status={credential.emailStatus} />
                    </td>
                    <td className="subtle">{formatDateShort(credential.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
