'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { Banner, Button, Card, CopyButton, ErrorNotice, Field, Input, Textarea } from '@/components/ui';

interface Organization {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  website: string | null;
  contactEmail: string | null;
  plan: string;
  planName: string;
  did: string;
  didDocumentUrl: string;
  verificationOrigin: string;
  memberCount: number;
  credentialCount: number;
  createdAt: string;
  edition: string;
}

export default function OrganizationSettingsPage() {
  const { can, refresh } = useAuth();
  const org = useApi<Organization>('/v1/org');
  const [form, setForm] = useState({ name: '', description: '', website: '', contactEmail: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!org.data) return;
    setForm({
      name: org.data.name,
      description: org.data.description ?? '',
      website: org.data.website ?? '',
      contactEmail: org.data.contactEmail ?? '',
    });
  }, [org.data]);

  const save = useMutation(async () => {
    await api.patch('/v1/org', {
      name: form.name,
      description: form.description || null,
      website: form.website || null,
      contactEmail: form.contactEmail || null,
    });
    setSaved(true);
    org.reload();
    await refresh();
  });

  if (org.loading) return <div className="skeleton" style={{ height: 300 }} />;
  if (org.error) return <ErrorNotice error={org.error} />;
  if (!org.data) return null;

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
      <Card
        title="Organisation profile"
        description="This appears on every credential you issue and on every verification page."
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run();
          }}
        >
          {save.error && <ErrorNotice error={save.error} />}
          {saved && !save.error && <Banner tone="ok">Saved.</Banner>}

          <Field label="Name" required>
            {(props) => (
              <Input
                {...props}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={!can('org:update')}
                required
              />
            )}
          </Field>

          <Field label="Description" hint="Shown to recipients and included in the credential.">
            {(props) => (
              <Textarea
                {...props}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={!can('org:update')}
                rows={3}
              />
            )}
          </Field>

          <Field label="Website">
            {(props) => (
              <Input
                {...props}
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                disabled={!can('org:update')}
                placeholder="https://example.edu"
              />
            )}
          </Field>

          <Field
            label="Contact email"
            hint="Offered to anyone who has a question about a credential you issued."
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                disabled={!can('org:update')}
              />
            )}
          </Field>

          {can('org:update') && (
            <div className="row">
              <Button type="submit" variant="primary" loading={save.busy}>
                Save changes
              </Button>
            </div>
          )}
        </form>
      </Card>

      <div className="stack">
        <Card title="At a glance">
          <dl className="kv">
            <dt>Plan</dt>
            <dd>{org.data.planName}</dd>
            <dt>Edition</dt>
            <dd style={{ textTransform: 'capitalize' }}>{org.data.edition}</dd>
            <dt>Credentials</dt>
            <dd>{formatNumber(org.data.credentialCount)}</dd>
            <dt>Team members</dt>
            <dd>{formatNumber(org.data.memberCount)}</dd>
            <dt>Created</dt>
            <dd>{formatDate(org.data.createdAt)}</dd>
            <dt>Workspace slug</dt>
            <dd>
              <code className="mono">{org.data.slug}</code>
            </dd>
          </dl>
        </Card>

        <Card title="Issuer identity">
          <div className="stack-sm stack">
            <div className="subtle">Credentials you issue are signed as:</div>
            <div className="row" style={{ gap: 4, minWidth: 0 }}>
              <code className="mono truncate">{org.data.did}</code>
              <CopyButton value={org.data.did} label="" />
            </div>
            <a className="subtle" href={org.data.didDocumentUrl} rel="noopener">
              DID document →
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
