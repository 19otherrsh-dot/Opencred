'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CopyButton,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  SkeletonRows,
  StatusBadge,
} from '@/components/ui';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

interface Delivery {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

interface EventCatalogue {
  events: string[];
  delivery: {
    guarantee: string;
    retrySchedule: string;
    timeoutMs: number;
    signatureHeader: string;
    signatureFormat: string;
    note: string;
  };
}

export default function WebhooksSettingsPage() {
  const { can, session } = useAuth();
  const endpoints = useApi<Endpoint[]>('/v1/webhooks');
  const catalogue = useApi<EventCatalogue>('/v1/webhooks/events');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ url: '', description: '', events: [] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const deliveries = useApi<Delivery[]>(
    inspecting ? `/v1/webhooks/${inspecting}/deliveries?limit=25` : null,
  );

  const create = useMutation(async () => {
    const created = await api.post<{ secret: string }>('/v1/webhooks', {
      url: form.url,
      description: form.description || undefined,
      events: form.events,
    });
    setSecret(created.secret);
    setCreateOpen(false);
    setForm({ url: '', description: '', events: [] });
    endpoints.reload();
  });

  const test = useMutation(async (id: string) => {
    await api.post(`/v1/webhooks/${id}/test`);
    setInspecting(id);
    setTimeout(() => deliveries.reload(), 1500);
  });

  const remove = useMutation(async (id: string) => {
    await api.delete(`/v1/webhooks/${id}`);
    if (inspecting === id) setInspecting(null);
    endpoints.reload();
  });

  if (!session?.features.webhooks) {
    return (
      <Banner tone="info" title="Webhooks are not on this plan">
        Webhooks are included on Cloud Growth and above, and on every self-hosted installation.
      </Banner>
    );
  }

  return (
    <div className="stack">
      {secret && (
        <Banner tone="warn" title="Save your signing secret">
          <p style={{ marginBottom: 8 }}>
            Shown once. Use it to verify the <code className="mono">X-OpenCred-Signature</code>{' '}
            header on every delivery.
          </p>
          <div className="row" style={{ gap: 6 }}>
            <code
              className="mono"
              style={{
                background: 'var(--surface)',
                padding: '6px 10px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                overflowWrap: 'anywhere',
              }}
            >
              {secret}
            </code>
            <CopyButton value={secret} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSecret(null)} style={{ marginTop: 8 }}>
            Saved
          </Button>
        </Banner>
      )}

      <Card
        title="Endpoints"
        action={
          can('webhooks:manage') ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Add endpoint
            </Button>
          ) : undefined
        }
      >
        {endpoints.error && <ErrorNotice error={endpoints.error} />}

        {endpoints.loading ? (
          <SkeletonRows rows={2} />
        ) : (endpoints.data?.length ?? 0) === 0 ? (
          <p className="subtle">No endpoints registered.</p>
        ) : (
          <div className="stack">
            {endpoints.data?.map((endpoint) => (
              <div key={endpoint.id} className="card card-pad stack-sm stack">
                <div className="row row-between row-wrap">
                  <div style={{ minWidth: 0 }}>
                    <code className="mono truncate" style={{ display: 'block', maxWidth: 420 }}>
                      {endpoint.url}
                    </code>
                    {endpoint.description && (
                      <span className="subtle">{endpoint.description}</span>
                    )}
                  </div>
                  <div className="row">
                    <StatusBadge status={endpoint.active ? 'active' : 'failed'} />
                    {can('webhooks:manage') && (
                      <>
                        <Button size="sm" onClick={() => void test.run(endpoint.id)}>
                          Send test
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setInspecting(inspecting === endpoint.id ? null : endpoint.id)
                          }
                        >
                          {inspecting === endpoint.id ? 'Hide' : 'Deliveries'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void remove.run(endpoint.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="row row-wrap" style={{ gap: 4 }}>
                  {endpoint.events.length === 0 ? (
                    <span className="badge badge-neutral">all events</span>
                  ) : (
                    endpoint.events.map((event) => (
                      <span key={event} className="badge badge-neutral">
                        {event}
                      </span>
                    ))
                  )}
                </div>

                {endpoint.failureCount > 0 && (
                  <p className="subtle">
                    {endpoint.failureCount} consecutive failures. Last failure{' '}
                    {formatDateTime(endpoint.lastFailureAt)}.
                  </p>
                )}

                {inspecting === endpoint.id && (
                  <div className="table-wrap">
                    <table className="table">
                      <caption className="sr-only">Recent deliveries</caption>
                      <thead>
                        <tr>
                          <th scope="col">Event</th>
                          <th scope="col">Status</th>
                          <th scope="col">Attempts</th>
                          <th scope="col">Response</th>
                          <th scope="col">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(deliveries.data ?? []).map((delivery) => (
                          <tr key={delivery.id}>
                            <td className="mono">{delivery.event}</td>
                            <td>
                              <StatusBadge
                                status={
                                  delivery.status === 'delivered'
                                    ? 'sent'
                                    : delivery.status === 'failed'
                                      ? 'failed'
                                      : 'pending'
                                }
                              />
                            </td>
                            <td>{delivery.attempts}</td>
                            <td className="subtle truncate" style={{ maxWidth: 220 }}>
                              {delivery.responseStatus ?? delivery.error ?? '—'}
                            </td>
                            <td className="subtle">{formatDateTime(delivery.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {catalogue.data && (
        <Card title="Delivery contract" description="Design your consumer against these guarantees">
          <dl className="kv">
            <dt>Guarantee</dt>
            <dd>{catalogue.data.delivery.guarantee}</dd>
            <dt>Retries</dt>
            <dd>{catalogue.data.delivery.retrySchedule}</dd>
            <dt>Timeout</dt>
            <dd>{catalogue.data.delivery.timeoutMs / 1000} seconds</dd>
            <dt>Signature header</dt>
            <dd>
              <code className="mono">{catalogue.data.delivery.signatureHeader}</code>
            </dd>
            <dt>Signature format</dt>
            <dd>
              <code className="mono" style={{ fontSize: '0.75rem' }}>
                {catalogue.data.delivery.signatureFormat}
              </code>
            </dd>
          </dl>
          <Banner tone="info">{catalogue.data.delivery.note}</Banner>
        </Card>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a webhook endpoint"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={create.busy}
              onClick={() => void create.run()}
              disabled={!form.url.trim()}
            >
              Add endpoint
            </Button>
          </div>
        }
      >
        <div className="stack">
          {create.error && <ErrorNotice error={create.error} />}

          <Field label="URL" required hint="Must be HTTPS in production.">
            {(props) => (
              <Input
                {...props}
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/hooks/opencred"
                required
              />
            )}
          </Field>

          <Field label="Description">
            {(props) => (
              <Input
                {...props}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Sync issuance into the CRM"
              />
            )}
          </Field>

          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>
              Events
            </legend>
            <p className="hint" style={{ marginBottom: 8 }}>
              Select none to receive everything.
            </p>
            <div className="stack" style={{ gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {(catalogue.data?.events ?? []).map((event) => (
                <label key={event} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.events.includes(event)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        events: e.target.checked
                          ? [...form.events, event]
                          : form.events.filter((x) => x !== event),
                      })
                    }
                  />
                  <code className="mono" style={{ fontSize: '0.8rem' }}>
                    {event}
                  </code>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>
    </div>
  );
}
