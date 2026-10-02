'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  Dialog,
  ErrorNotice,
  Field,
  StatusBadge,
  Textarea,
} from '@/components/ui';

interface BatchDetail {
  id: string;
  name: string;
  status: string;
  totalCount: number;
  processedCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { id: string; name: string; kind: string };
  validation: { totalRows?: number; validRows?: number; duplicatesInFile?: number };
}

interface BatchReport {
  total: number;
  byStatus: Record<string, number>;
  engagement: {
    delivered: number;
    opened: number;
    downloaded: number;
    verified: number;
    openRate: number;
  };
}

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const batch = useApi<BatchDetail>(`/v1/batches/${id}`);
  const report = useApi<BatchReport>(`/v1/analytics/batches/${id}`);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const inProgress = batch.data?.status === 'processing' || batch.data?.status === 'queued';

  // While a batch is running, poll so the progress bar actually moves. Stops as
  // soon as it completes, rather than polling a finished batch forever.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      batch.reload();
      report.reload();
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress]);

  const revoke = useMutation(async () => {
    await api.post(`/v1/batches/${id}/revoke`, { reason: reason || undefined });
    setRevokeOpen(false);
    batch.reload();
    report.reload();
  });

  if (batch.loading) return <div className="skeleton" style={{ height: 300 }} />;
  if (batch.error) return <ErrorNotice error={batch.error} />;
  if (!batch.data) return null;

  const data = batch.data;
  const percent = data.totalCount === 0 ? 0 : Math.round((data.processedCount / data.totalCount) * 100);

  return (
    <div className="stack-lg stack">
      <div>
        <Link className="subtle" href="/batches">
          ← All batches
        </Link>
        <div className="row row-between row-wrap" style={{ marginTop: 'var(--sp-3)' }}>
          <div>
            <h1>{data.name}</h1>
            <p className="subtle">
              <Link href={`/templates/${data.template.id}`}>{data.template.name}</Link> ·{' '}
              {formatDateTime(data.createdAt)}
            </p>
          </div>
          <div className="row">
            <StatusBadge status={data.status} />
            <Link className="btn btn-secondary" href={`/credentials?batchId=${data.id}`}>
              View credentials
            </Link>
            {can('credentials:revoke') && (
              <Button variant="danger" onClick={() => setRevokeOpen(true)}>
                Revoke whole batch
              </Button>
            )}
          </div>
        </div>
      </div>

      {data.scheduledAt && data.status === 'queued' && (
        <Banner tone="info" title="Scheduled">
          These credentials exist but have not been issued yet. They will go out at{' '}
          {formatDateTime(data.scheduledAt)}.
        </Banner>
      )}

      <Card title="Progress">
        <div className="stack">
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: 'var(--surface-3)',
              overflow: 'hidden',
            }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Batch progress"
          >
            <div style={{ width: `${percent}%`, height: '100%', background: 'var(--brand)' }} />
          </div>

          <div className="row row-between subtle">
            <span>
              {formatNumber(data.processedCount)} of {formatNumber(data.totalCount)} issued
            </span>
            <span>{percent}%</span>
          </div>

          {inProgress && (
            <p className="subtle">
              Signing and rendering happen in the background. This page updates itself.
            </p>
          )}
        </div>
      </Card>

      {report.data && (
        <div className="grid grid-4">
          <div className="card card-pad stat">
            <span className="stat-value">{formatNumber(report.data.engagement.delivered)}</span>
            <span className="stat-label">delivered</span>
          </div>
          <div className="card card-pad stat">
            <span className="stat-value">{formatPercent(report.data.engagement.openRate)}</span>
            <span className="stat-label">email open rate</span>
          </div>
          <div className="card card-pad stat">
            <span className="stat-value">{formatNumber(report.data.engagement.downloaded)}</span>
            <span className="stat-label">downloaded</span>
          </div>
          <div className="card card-pad stat">
            <span className="stat-value">{formatNumber(report.data.engagement.verified)}</span>
            <span className="stat-label">verified by someone</span>
          </div>
        </div>
      )}

      {report.data && (
        <Card title="Credential status">
          <dl className="kv">
            {Object.entries(report.data.byStatus).map(([status, count]) => (
              <div key={status} style={{ display: 'contents' }}>
                <dt>
                  <StatusBadge status={status} />
                </dt>
                <dd>{formatNumber(count)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {data.validation?.totalRows != null && (
        <Card title="Upload validation" description="What the file looked like when it was checked">
          <dl className="kv">
            <dt>Rows in the file</dt>
            <dd>{formatNumber(data.validation.totalRows)}</dd>
            <dt>Rows accepted</dt>
            <dd>{formatNumber(data.validation.validRows ?? 0)}</dd>
            <dt>Duplicates within the file</dt>
            <dd>{formatNumber(data.validation.duplicatesInFile ?? 0)}</dd>
          </dl>
        </Card>
      )}

      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke every credential in this batch"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setRevokeOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={revoke.busy} onClick={() => void revoke.run()}>
              Revoke {formatNumber(data.processedCount)} credentials
            </Button>
          </div>
        }
      >
        <div className="stack">
          <Banner tone="warn">
            Every verification page in this batch will immediately show &ldquo;Revoked&rdquo;, and
            third parties holding copies will see it through the published status list. This cannot
            be undone.
          </Banner>
          {revoke.error && <ErrorNotice error={revoke.error} />}
          <Field label="Reason" hint="Shown publicly on every affected verification page.">
            {(props) => (
              <Textarea
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Issued against the wrong cohort list"
              />
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
