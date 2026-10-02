'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { api, downloadFile } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { EVENT_LABELS, formatDate, formatDateTime } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CopyButton,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  StatusBadge,
  Textarea,
} from '@/components/ui';

interface CredentialDetail {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  data: Record<string, string>;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  emailStatus: string;
  emailSentAt: string | null;
  emailError: string | null;
  credentialHash: string | null;
  recipient: { id: string; name: string; email: string; externalId: string | null };
  template: { id: string; name: string; kind: string; version: number };
  batch: { id: string; name: string } | null;
  verificationUrl: string;
  badgeUrl: string;
  linkedInUrl: string;
  events: Array<{ id: string; type: string; createdAt: string; metadata: Record<string, unknown> }>;
}

export default function CredentialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16 hands route params to client components as a promise; `use` unwraps
  // it during render rather than in an effect.
  const { id } = use(params);
  const { can } = useAuth();

  const { data, error, loading, reload } = useApi<CredentialDetail>(`/v1/credentials/${id}`);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState({ recipientName: '', title: '', reason: '', notify: false });

  const revoke = useMutation(async () => {
    await api.post(`/v1/credentials/${id}/revoke`, { reason: reason || undefined });
    setRevokeOpen(false);
    reload();
  });

  const resend = useMutation(async () => {
    await api.post(`/v1/credentials/${id}/resend`);
    reload();
  });

  const save = useMutation(async () => {
    const payload: Record<string, unknown> = { notify: edit.notify };
    if (edit.recipientName.trim()) payload.recipientName = edit.recipientName.trim();
    if (edit.title.trim()) payload.title = edit.title.trim();
    if (edit.reason.trim()) payload.reason = edit.reason.trim();
    await api.patch(`/v1/credentials/${id}`, payload);
    setEditOpen(false);
    reload();
  });

  if (loading) return <div className="skeleton" style={{ height: 360 }} />;
  if (error) return <ErrorNotice error={error} />;
  if (!data) return null;

  return (
    <div className="stack-lg stack">
      <div>
        <Link className="subtle" href="/credentials">
          ← All credentials
        </Link>
        <div className="row row-between row-wrap" style={{ marginTop: 'var(--sp-3)' }}>
          <div>
            <h1>{data.title}</h1>
            <p className="subtle">
              {data.recipient.name} · {data.recipient.email}
            </p>
          </div>
          <div className="row">
            <StatusBadge status={data.status} />
            {can('credentials:issue') && data.status !== 'revoked' && (
              <>
                <Button onClick={() => setEditOpen(true)}>Correct</Button>
                <Button onClick={() => void resend.run()} loading={resend.busy}>
                  Re-send email
                </Button>
              </>
            )}
            {can('credentials:revoke') && data.status !== 'revoked' && (
              <Button variant="danger" onClick={() => setRevokeOpen(true)}>
                Revoke
              </Button>
            )}
          </div>
        </div>
      </div>

      {data.status === 'revoked' && (
        <Banner tone="danger" title="This credential is revoked">
          Revoked {formatDateTime(data.revokedAt)}.{' '}
          {data.revocationReason ? `Reason given: ${data.revocationReason}.` : ''} The public
          verification page and the issuer&rsquo;s published status list both reflect this.
        </Banner>
      )}

      {data.emailStatus === 'failed' && (
        <Banner tone="warn" title="Delivery failed">
          {data.emailError ?? 'The delivery email could not be sent.'} The credential itself is
          issued and valid — only the email failed.
        </Banner>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <div className="stack">
          <Card title="Credential">
            <dl className="kv">
              <dt>Credential ID</dt>
              <dd className="row" style={{ gap: 4 }}>
                <code className="mono">{data.publicId}</code>
                <CopyButton value={data.publicId} />
              </dd>

              <dt>Verification page</dt>
              <dd className="row" style={{ gap: 4, minWidth: 0 }}>
                <a
                  className="truncate"
                  href={data.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {data.verificationUrl}
                </a>
                <CopyButton value={data.verificationUrl} label="" />
              </dd>

              <dt>Template</dt>
              <dd>
                <Link href={`/templates/${data.template.id}`}>{data.template.name}</Link>
                <span className="subtle"> · version {data.template.version}</span>
              </dd>

              {data.batch && (
                <>
                  <dt>Batch</dt>
                  <dd>
                    <Link href={`/batches/${data.batch.id}`}>{data.batch.name}</Link>
                  </dd>
                </>
              )}

              <dt>Issued</dt>
              <dd>{formatDate(data.issuedAt)}</dd>

              <dt>Expires</dt>
              <dd>{data.expiresAt ? formatDate(data.expiresAt) : 'Does not expire'}</dd>

              <dt>Content hash</dt>
              <dd>
                <code className="mono" style={{ fontSize: '0.75rem' }}>
                  {data.credentialHash ?? 'not yet signed'}
                </code>
              </dd>
            </dl>
          </Card>

          {Object.keys(data.data ?? {}).length > 0 && (
            <Card title="Merge field values" description="What was substituted into the template">
              <dl className="kv">
                {Object.entries(data.data).map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>
                      <code className="mono">{key}</code>
                    </dt>
                    <dd>{String(value) || <span className="subtle">empty</span>}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card
            title="Activity"
            description="Every recorded event for this credential, in order"
          >
            {data.events.length === 0 ? (
              <p className="subtle">No events recorded yet.</p>
            ) : (
              <ol style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack-sm stack">
                {data.events.map((event) => (
                  <li key={event.id} className="row" style={{ alignItems: 'baseline' }}>
                    <span className="dot" style={{ color: 'var(--border-strong)' }} aria-hidden="true" />
                    <span>{EVENT_LABELS[event.type] ?? event.type}</span>
                    <span className="spacer" />
                    <span className="subtle">{formatDateTime(event.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Files">
            <div className="stack-sm stack">
              <Button
                onClick={() =>
                  void downloadFile(`/v1/credentials/${id}/download?format=pdf`, 'credential.pdf')
                }
              >
                Download PDF
              </Button>
              <Button
                onClick={() =>
                  void downloadFile(`/v1/credentials/${id}/download?format=png`, 'credential.png')
                }
              >
                Download PNG
              </Button>
              <a className="btn btn-ghost" href={data.badgeUrl} rel="noopener">
                Signed credential JSON
              </a>
            </div>
          </Card>

          <Card title="Delivery">
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <StatusBadge status={data.emailStatus} />
              </dd>
              <dt>Sent</dt>
              <dd>{data.emailSentAt ? formatDateTime(data.emailSentAt) : '—'}</dd>
              <dt>To</dt>
              <dd className="truncate">{data.recipient.email}</dd>
            </dl>
          </Card>

          <Card title="Recipient">
            <dl className="kv">
              <dt>Name</dt>
              <dd>
                <Link href={`/recipients/${data.recipient.id}`}>{data.recipient.name}</Link>
              </dd>
              <dt>Email</dt>
              <dd className="truncate">{data.recipient.email}</dd>
              {data.recipient.externalId && (
                <>
                  <dt>External ID</dt>
                  <dd>
                    <code className="mono">{data.recipient.externalId}</code>
                  </dd>
                </>
              )}
            </dl>
          </Card>
        </div>
      </div>

      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke this credential"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setRevokeOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={revoke.busy} onClick={() => void revoke.run()}>
              Revoke permanently
            </Button>
          </div>
        }
      >
        <div className="stack">
          <Banner tone="warn">
            Revocation is immediate and public. The verification page will show
            &ldquo;Revoked&rdquo;, and any third party holding a copy of this credential will see
            it through the published status list. This cannot be undone — to fix a mistake in the
            data, use <strong>Correct</strong> instead.
          </Banner>
          {revoke.error && <ErrorNotice error={revoke.error} />}
          <Field label="Reason" hint="Shown on the public verification page.">
            {(props) => (
              <Textarea
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Issued in error"
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Correct this credential"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
              Save and re-sign
            </Button>
          </div>
        }
      >
        <div className="stack">
          <Banner tone="info">
            Only this credential is affected. Its ID, QR code and verification link stay the same,
            so anything already shared keeps working, and the rest of its batch is untouched.
          </Banner>
          {save.error && <ErrorNotice error={save.error} />}

          <Field label="Recipient name" hint={`Currently: ${data.recipient.name}`}>
            {(props) => (
              <Input
                {...props}
                value={edit.recipientName}
                onChange={(e) => setEdit({ ...edit, recipientName: e.target.value })}
                placeholder={data.recipient.name}
              />
            )}
          </Field>

          <Field label="Credential title" hint={`Currently: ${data.title}`}>
            {(props) => (
              <Input
                {...props}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                placeholder={data.title}
              />
            )}
          </Field>

          <Field label="Reason for the correction" hint="Recorded in the audit log.">
            {(props) => (
              <Input
                {...props}
                value={edit.reason}
                onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                placeholder="Name spelt incorrectly on the original list"
              />
            )}
          </Field>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={edit.notify}
              onChange={(e) => setEdit({ ...edit, notify: e.target.checked })}
            />
            <span>
              Email the recipient again with the corrected credential
              <span className="hint" style={{ display: 'block' }}>
                Leave off for a silent fix, such as a typo nobody noticed.
              </span>
            </span>
          </label>
        </div>
      </Dialog>
    </div>
  );
}
