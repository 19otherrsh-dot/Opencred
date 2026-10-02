'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { PUBLIC_API_URL } from '@/lib/config';
import { formatDateShort } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  CopyButton,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Select,
  SkeletonRows,
} from '@/components/ui';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function ApiKeysSettingsPage() {
  const { can } = useAuth();
  const keys = useApi<ApiKey[]>('/v1/org/api-keys');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'issuer' });
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation(async () => {
    const key = await api.post<{ secret: string }>('/v1/org/api-keys', form);
    setSecret(key.secret);
    setCreateOpen(false);
    setForm({ name: '', role: 'issuer' });
    keys.reload();
  });

  const revoke = useMutation(async (id: string) => {
    await api.delete(`/v1/org/api-keys/${id}`);
    keys.reload();
  });

  return (
    <div className="stack">
      {secret && (
        <Banner tone="warn" title="Copy this key now">
          <p style={{ marginBottom: 8 }}>
            This is the only time it will ever be shown. Only a hash is stored, so we cannot
            retrieve it for you later.
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
            I have saved it
          </Button>
        </Banner>
      )}

      <Card
        title="API keys"
        description="For server-to-server issuance. A key can never exceed the role it was created with."
        action={
          can('apikeys:manage') ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Create a key
            </Button>
          ) : undefined
        }
      >
        {keys.error && <ErrorNotice error={keys.error} />}

        {keys.loading ? (
          <SkeletonRows rows={3} />
        ) : (keys.data?.length ?? 0) === 0 ? (
          <p className="subtle">No API keys yet.</p>
        ) : (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="table">
              <caption className="sr-only">API keys</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Role</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.data?.map((key) => (
                  <tr key={key.id} style={{ opacity: key.revokedAt ? 0.55 : 1 }}>
                    <td>
                      {key.name}
                      {key.revokedAt && (
                        <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                          Revoked
                        </span>
                      )}
                    </td>
                    <td>
                      <code className="mono">{key.prefix}…</code>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{key.role}</span>
                    </td>
                    <td className="subtle">
                      {key.lastUsedAt ? formatDateShort(key.lastUsedAt) : 'never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {can('apikeys:manage') && !key.revokedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void revoke.run(key.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Using a key">
        <div className="stack-sm stack">
          <p className="subtle">Issue a credential with one request:</p>
          <pre
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: 'var(--sp-4)',
              overflowX: 'auto',
              fontSize: '0.78rem',
              lineHeight: 1.6,
            }}
          >
            <code>{`curl -X POST ${PUBLIC_API_URL}/v1/credentials \\
  -H "Authorization: Bearer ock_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "<template uuid>",
    "recipient": { "name": "Ada Lovelace", "email": "ada@example.com" },
    "data": { "course": "Advanced Data Engineering", "grade": "Distinction" },
    "idempotencyKey": "course-42-user-1071"
  }'`}</code>
          </pre>
          <p className="subtle">
            Always send an <code className="mono">idempotencyKey</code> from an event handler that
            might retry — otherwise one redelivered webhook means one duplicate certificate.
          </p>
          <a className="subtle" href={`${PUBLIC_API_URL}/docs`} rel="noopener">
            Full API reference →
          </a>
        </div>
      </Card>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create an API key"
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={create.busy}
              onClick={() => void create.run()}
              disabled={!form.name.trim()}
            >
              Create key
            </Button>
          </div>
        }
      >
        <div className="stack">
          {create.error && <ErrorNotice error={create.error} />}

          <Field label="Name" hint="How you will recognise it later." required>
            {(props) => (
              <Input
                {...props}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="LMS course-completion hook"
                required
              />
            )}
          </Field>

          <Field
            label="Role"
            hint="Issuer is enough for automated issuance and nothing more. Grant admin only if the integration genuinely manages settings."
          >
            {(props) => (
              <Select
                {...props}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="viewer">Viewer — read only</option>
                <option value="issuer">Issuer — issue and revoke</option>
                <option value="admin">Admin — settings too</option>
              </Select>
            )}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
