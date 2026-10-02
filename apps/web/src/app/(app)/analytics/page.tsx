'use client';

import { useState } from 'react';
import { downloadFile } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { formatNumber, formatPercent } from '@/lib/format';
import { Button, Card, ErrorNotice } from '@/components/ui';
import { Sparkline } from '@/components/sparkline';

interface Overview {
  range: { from: string; to: string };
  credentials: { total: number; byStatus: Record<string, number>; issuedInRange: number };
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
  topTemplates: Array<{ templateId: string; name: string; count: number }>;
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const overview = useApi<Overview>(`/v1/analytics/overview?from=${encodeURIComponent(from)}`);
  const series = useApi<Array<{ date: string; issued: number; verified: number; viewed: number }>>(
    `/v1/analytics/timeseries?days=${days}`,
  );

  return (
    <div className="stack-lg stack">
      <div className="row row-between row-wrap">
        <div>
          <h1>Analytics</h1>
          <p className="subtle">
            Every number here is also available through the API and as a CSV export.
          </p>
        </div>
        <div className="row">
          <div className="pill-tabs" role="tablist" aria-label="Time range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                role="tab"
                aria-selected={days === range.days}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Button onClick={() => void downloadFile('/v1/analytics/export.csv', 'events.csv')}>
            Export events
          </Button>
        </div>
      </div>

      {overview.error && <ErrorNotice error={overview.error} />}

      <div className="grid grid-4">
        <Tile label="Issued" value={overview.data?.credentials.issuedInRange} loading={overview.loading} />
        <Tile label="Delivered" value={overview.data?.engagement.delivered} loading={overview.loading} />
        <Tile label="Verified" value={overview.data?.engagement.verified} loading={overview.loading} />
        <Tile
          label="Added to LinkedIn"
          value={overview.data?.engagement.linkedInAdded}
          loading={overview.loading}
        />
      </div>

      <Card
        title="Activity"
        description="Credentials issued, verified and viewed per day"
      >
        {series.loading ? (
          <div className="skeleton" style={{ height: 200 }} />
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

      <div className="grid grid-2">
        <Card title="Engagement rates" description="As a share of credentials delivered">
          {overview.loading ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (
            <dl className="kv">
              <dt>Email opened</dt>
              <dd>{formatPercent(overview.data?.engagement.openRate)}</dd>
              <dt>Downloaded</dt>
              <dd>{formatPercent(overview.data?.engagement.downloadRate)}</dd>
              <dt>Verified by someone</dt>
              <dd>{formatPercent(overview.data?.engagement.verificationRate)}</dd>
              <dt>Shared</dt>
              <dd>{formatNumber(overview.data?.engagement.shared)}</dd>
            </dl>
          )}
          <p className="subtle" style={{ marginTop: 'var(--sp-3)' }}>
            Open tracking uses a pixel and is blocked by many mail clients, so treat the open rate
            as a floor rather than a measurement. Downloads and verifications are counted server
            side and are reliable.
          </p>
        </Card>

        <Card title="Most used templates">
          {overview.loading ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (overview.data?.topTemplates.length ?? 0) === 0 ? (
            <p className="subtle">Nothing issued in this period.</p>
          ) : (
            <dl className="kv">
              {overview.data?.topTemplates.map((template) => (
                <div key={template.templateId} style={{ display: 'contents' }}>
                  <dt className="truncate">{template.name}</dt>
                  <dd>{formatNumber(template.count)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <Card title="Credential status" description="All time">
        {overview.loading ? (
          <div className="skeleton" style={{ height: 90 }} />
        ) : (
          <dl className="kv">
            {Object.entries(overview.data?.credentials.byStatus ?? {}).map(([status, count]) => (
              <div key={status} style={{ display: 'contents' }}>
                <dt style={{ textTransform: 'capitalize' }}>{status}</dt>
                <dd>{formatNumber(count)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="card card-pad">
      {loading ? (
        <div className="skeleton" style={{ height: 48 }} />
      ) : (
        <div className="stat">
          <span className="stat-value">{formatNumber(value)}</span>
          <span className="stat-label">{label}</span>
        </div>
      )}
    </div>
  );
}
