'use client';

import { useState } from 'react';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { Banner, Button, Card, ErrorNotice, Input, SkeletonRows } from '@/components/ui';

interface AuditEntry {
  id: string;
  actorType: string;
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export default function AuditLogPage() {
  const { session } = useAuth();
  const [action, setAction] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: '50' });
  if (action.trim()) params.set('action', action.trim());
  if (cursor) params.set('cursor', cursor);

  const { data, error, loading } = useApi<{ data: AuditEntry[]; nextCursor: string | null }>(
    `/v1/org/audit-log?${params.toString()}`,
  );

  if (!session?.features.auditLog) {
    return (
      <Banner tone="info" title="Audit log is not on this plan">
        The audit log is included on Cloud Growth and above, and on every self-hosted
        installation.
      </Banner>
    );
  }

  return (
    <div className="stack">
      <Card
        title="Audit log"
        description="Append-only. There is no endpoint in this product that edits or deletes an entry."
      >
        {error && <ErrorNotice error={error} />}

        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <label className="sr-only" htmlFor="audit-filter">
            Filter by action
          </label>
          <Input
            id="audit-filter"
            type="search"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setCursor(null);
            }}
            placeholder="Filter by action, e.g. credential.revoked"
            style={{ maxWidth: 340 }}
          />
        </div>

        {loading ? (
          <SkeletonRows rows={8} />
        ) : (data?.data.length ?? 0) === 0 ? (
          <p className="subtle">No matching entries.</p>
        ) : (
          <>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <caption className="sr-only">Administrative actions</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="subtle" style={{ whiteSpace: 'nowrap' }}>
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td>
                        {entry.actorLabel}
                        <div className="subtle">{entry.actorType}</div>
                      </td>
                      <td>
                        <code className="mono">{entry.action}</code>
                      </td>
                      <td className="subtle">
                        {entry.targetType ? (
                          <>
                            {entry.targetType}
                            <div className="mono truncate" style={{ maxWidth: 160 }}>
                              {entry.targetId}
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="subtle truncate" style={{ maxWidth: 260 }}>
                        {Object.keys(entry.metadata ?? {}).length > 0
                          ? JSON.stringify(entry.metadata)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data?.nextCursor && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
                <Button onClick={() => setCursor(data.nextCursor)}>Load older entries</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Banner tone="info" title="What is recorded">
        Organisation and branding changes, member invitations and role changes, API key creation
        and revocation, template creation and edits, issuance, corrections, revocations, key
        rotation, plan changes and data-subject erasures. IP addresses are truncated before
        storage.
      </Banner>
    </div>
  );
}
