'use client';

import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatNumber, formatPercent, formatDateShort } from '@/lib/format';
import { Card, EmptyState, ErrorNotice, SkeletonRows, StatusBadge } from '@/components/ui';
import { Sparkline } from '@/components/sparkline';

interface Overview {
  credentials: {
    total: number;
    byStatus: Record<string, number>;
    issuedInRange: number;
  };
  engagement: {
    delivered: number;
    opened: number;
    downloaded: number;
    shared: number;
    linkedInAdded: number;
    verified: number;
    openRate: number;
    downloadRate: number;
    verificationRate: number;
  };
  delivery: Record<string, number>;
  topTemplates: Array<{ templateId: string; name: string; count: number }>;
}

interface Usage {
  plan: string;
  credentialsIssued: number;
  included: number | null;
  remaining: number | null;
  overage: number;
  metered: boolean;
  periodEnd: string;
  note?: string;
}

interface CredentialRow {
  id: string;
  publicId: string;
  title: string;
  status: string;
  recipient: { name: string; email: string };
  issuedAt: string;
}

export default function DashboardPage() {
  const { session } = useAuth();
  const overview = useApi<Overview>('/v1/analytics/overview');
  const usage = useApi<Usage>('/v1/billing/usage');
  const series = useApi<Array<{ date: string; issued: number; verified: number }>>(
    '/v1/analytics/timeseries?days=30',
  );
  const recent = useApi<{ data: CredentialRow[] }>('/v1/credentials?limit=8');

  const empty = overview.data?.credentials.total === 0;

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Overview</h1>
          <p className="subtle">
            {session?.organization.name} · last 30 days
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" href="/batches/new">
            Bulk issue
          </Link>
          <Link className="btn btn-primary" href="/credentials/new">
            Issue a credential
          </Link>
        </div>
      </div>

      {overview.error && <ErrorNotice error={overview.error} />}

      {empty ? (
        <Card>
          <EmptyState
            title="Nothing issued yet"
            action={
              <div className="row">
                <Link className="btn btn-primary" href="/credentials/new">
                  Issue your first credential
                </Link>
                <Link className="btn btn-secondary" href="/templates">
                  Pick a template
                </Link>
              </div>
            }
          >
            Your workspace already has starter templates and its own signing key. Issuing one
            credential takes about a minute, and the verification page works immediately.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-4">
            <StatTile
              label="Credentials issued"
              value={formatNumber(overview.data?.credentials.total)}
              detail={`${formatNumber(overview.data?.credentials.issuedInRange)} in the last 30 days`}
              loading={overview.loading}
            />
            <StatTile
              label="Verified"
              value={formatNumber(overview.data?.engagement.verified)}
              detail={`${formatPercent(overview.data?.engagement.verificationRate)} of delivered`}
              loading={overview.loading}
            />
            <StatTile
              label="Downloaded"
              value={formatNumber(overview.data?.engagement.downloaded)}
              detail={`${formatPercent(overview.data?.engagement.downloadRate)} of delivered`}
              loading={overview.loading}
            />
            <StatTile
              label="Added to LinkedIn"
              value={formatNumber(overview.data?.engagement.linkedInAdded)}
              detail="recipient-initiated shares"
              loading={overview.loading}
            />
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
            <Card title="Issuance and verification" description="Daily totals over the last 30 days">
              {series.loading ? (
                <div className="skeleton" style={{ height: 160 }} />
              ) : (
                <Sparkline
                  data={series.data ?? []}
                  series={[
                    { key: 'issued', label: 'Issued', color: 'var(--chart-1)' },
                    { key: 'verified', label: 'Verified', color: 'var(--chart-2)' },
                  ]}
                />
              )}
            </Card>

            <div className="stack">
              <Card title="Plan usage">
                {usage.loading ? (
                  <div className="skeleton" style={{ height: 90 }} />
                ) : usage.data?.metered === false ? (
                  <div className="stack-sm stack">
                    <div className="stat">
                      <span className="stat-value">{formatNumber(usage.data.credentialsIssued)}</span>
                      <span className="stat-label">credentials issued</span>
                    </div>
                    <p className="subtle">
                      {usage.data.note ??
                        'Self-hosted installations are never metered and never limited.'}
                    </p>
                  </div>
                ) : (
                  <div className="stack-sm stack">
                    <div className="stat">
                      <span className="stat-value">
                        {formatNumber(usage.data?.credentialsIssued)}
                        {usage.data?.included !== null && (
                          <span className="subtle" style={{ fontSize: '1rem', fontWeight: 400 }}>
                            {' '}
                            / {formatNumber(usage.data?.included)}
                          </span>
                        )}
                      </span>
                      <span className="stat-label">
                        this period · renews {formatDateShort(usage.data?.periodEnd)}
                      </span>
                    </div>

                    {usage.data?.included != null && (
                      <div
                        style={{
                          height: 8,
                          borderRadius: 999,
                          background: 'var(--surface-3)',
                          overflow: 'hidden',
                        }}
                        role="progressbar"
                        aria-valuenow={usage.data.credentialsIssued}
                        aria-valuemin={0}
                        aria-valuemax={usage.data.included}
                        aria-label="Credentials used against the plan allowance"
                      >
                        <div
                          style={{
                            width: `${Math.min(100, (usage.data.credentialsIssued / usage.data.included) * 100)}%`,
                            height: '100%',
                            background: 'var(--brand)',
                          }}
                        />
                      </div>
                    )}

                    <Link className="subtle" href="/settings/billing">
                      Manage plan →
                    </Link>
                  </div>
                )}
              </Card>

              <Card title="Delivery">
                {overview.loading ? (
                  <div className="skeleton" style={{ height: 90 }} />
                ) : (
                  <dl className="kv">
                    {Object.entries(overview.data?.delivery ?? {}).map(([status, count]) => (
                      <div key={status} style={{ display: 'contents' }}>
                        <dt>
                          <StatusBadge status={status} />
                        </dt>
                        <dd>{formatNumber(count)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            </div>
          </div>

          <Card
            title="Recently issued"
            action={
              <Link className="btn btn-ghost btn-sm" href="/credentials">
                View all
              </Link>
            }
          >
            {recent.loading ? (
              <SkeletonRows rows={4} />
            ) : (
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="table">
                  <caption className="sr-only">Recently issued credentials</caption>
                  <thead>
                    <tr>
                      <th scope="col">Recipient</th>
                      <th scope="col">Credential</th>
                      <th scope="col">Status</th>
                      <th scope="col">Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recent.data?.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link href={`/credentials/${row.id}`}>{row.recipient.name}</Link>
                          <div className="subtle">{row.recipient.email}</div>
                        </td>
                        <td>{row.title}</td>
                        <td>
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="subtle">{formatDateShort(row.issuedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  loading: boolean;
}) {
  return (
    <div className="card card-pad">
      {loading ? (
        <div className="skeleton" style={{ height: 58 }} />
      ) : (
        <div className="stat">
          <span className="stat-value">{value}</span>
          <span className="stat-label">{label}</span>
          <span className="subtle" style={{ fontSize: '0.78rem' }}>
            {detail}
          </span>
        </div>
      )}
    </div>
  );
}
