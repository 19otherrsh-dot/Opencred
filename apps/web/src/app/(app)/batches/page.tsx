'use client';

import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { Card, EmptyState, ErrorNotice, SkeletonRows, StatusBadge } from '@/components/ui';

interface BatchRow {
  id: string;
  name: string;
  status: string;
  template: { id: string; name: string };
  totalCount: number;
  processedCount: number;
  failedCount: number;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export default function BatchesPage() {
  const { can } = useAuth();
  const { data, error, loading } = useApi<{ data: BatchRow[] }>('/v1/batches?limit=50');

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Bulk issuance</h1>
          <p className="subtle">
            Upload a spreadsheet, check it, then issue. Nothing goes out until you confirm.
          </p>
        </div>
        {can('credentials:issue') && (
          <Link className="btn btn-primary" href="/batches/new">
            New batch
          </Link>
        )}
      </div>

      {error && <ErrorNotice error={error} />}

      <Card>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No batches yet"
            action={
              <Link className="btn btn-primary" href="/batches/new">
                Upload a CSV
              </Link>
            }
          >
            A batch of 10,000 credentials is signed, rendered and delivered in the background — the
            upload itself returns in seconds.
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <caption className="sr-only">Issuance batches</caption>
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Template</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.data.map((batch) => {
                  const percent =
                    batch.totalCount === 0
                      ? 0
                      : Math.round((batch.processedCount / batch.totalCount) * 100);
                  return (
                    <tr key={batch.id}>
                      <td>
                        <Link href={`/batches/${batch.id}`}>{batch.name}</Link>
                        {batch.scheduledAt && (
                          <div className="subtle">
                            scheduled for {formatDateTime(batch.scheduledAt)}
                          </div>
                        )}
                      </td>
                      <td className="subtle">{batch.template.name}</td>
                      <td>
                        <StatusBadge status={batch.status} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8, minWidth: 160 }}>
                          <div
                            style={{
                              flex: 1,
                              height: 6,
                              borderRadius: 999,
                              background: 'var(--surface-3)',
                              overflow: 'hidden',
                            }}
                            role="progressbar"
                            aria-valuenow={percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${batch.name} progress`}
                          >
                            <div
                              style={{
                                width: `${percent}%`,
                                height: '100%',
                                background: 'var(--brand)',
                              }}
                            />
                          </div>
                          <span className="subtle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatNumber(batch.processedCount)}/{formatNumber(batch.totalCount)}
                          </span>
                        </div>
                      </td>
                      <td className="subtle">{formatDateTime(batch.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
