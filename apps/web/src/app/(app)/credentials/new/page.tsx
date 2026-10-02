'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { Banner, Button, Card, ErrorNotice, Field, Input, Select, Textarea } from '@/components/ui';
import { TemplatePreview } from '@/components/template-preview';

interface TemplateSummary {
  id: string;
  name: string;
  kind: string;
}

interface TemplateDetail {
  id: string;
  name: string;
  kind: string;
  requiredFields: string[];
  document: {
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      example?: string;
    }>;
  };
}

/**
 * Single-credential issuance (FR-ISS-02).
 *
 * The form is generated from the selected template's declared merge fields, so
 * an issuer is asked for exactly what their design needs and nothing else —
 * and the same validation that would reject the request server-side is visible
 * before they submit.
 */
export default function NewCredentialPage() {
  const router = useRouter();
  const templates = useApi<TemplateSummary[]>('/v1/templates');
  const [templateId, setTemplateId] = useState('');

  const detail = useApi<TemplateDetail>(templateId ? `/v1/templates/${templateId}` : null);

  const [recipient, setRecipient] = useState({ name: '', email: '', externalId: '' });
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [suppressEmail, setSuppressEmail] = useState(false);

  // Preselect the first template so the form is usable immediately.
  useEffect(() => {
    if (!templateId && templates.data && templates.data.length > 0) {
      setTemplateId(templates.data[0].id);
    }
  }, [templates.data, templateId]);

  const fields = detail.data?.document.fields ?? [];
  const requiredKeys = useMemo(
    () => new Set(detail.data?.requiredFields ?? []),
    [detail.data?.requiredFields],
  );

  const missing = [...requiredKeys].filter((key) => !values[key]?.trim());
  const canSubmit =
    Boolean(templateId) && recipient.name.trim() && recipient.email.trim() && missing.length === 0;

  const issue = useMutation(async () => {
    const result = await api.post<{ id: string; publicId: string }>('/v1/credentials', {
      templateId,
      recipient: {
        name: recipient.name.trim(),
        email: recipient.email.trim(),
        ...(recipient.externalId.trim() ? { externalId: recipient.externalId.trim() } : {}),
      },
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      data: values,
      suppressEmail,
    });
    router.push(`/credentials/${result.id}`);
  });

  return (
    <div className="stack-lg stack">
      <div>
        <Link className="subtle" href="/credentials">
          ← All credentials
        </Link>
        <h1 style={{ marginTop: 'var(--sp-3)' }}>Issue a credential</h1>
        <p className="subtle">
          For one recipient. To issue to a whole cohort, use{' '}
          <Link href="/batches/new">bulk issuance</Link>.
        </p>
      </div>

      {issue.error && <ErrorNotice error={issue.error} />}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void issue.run();
          }}
        >
          <Card title="Template">
            <Field label="Design" required>
              {(props) => (
                <Select
                  {...props}
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setValues({});
                  }}
                  required
                >
                  <option value="">Choose a template…</option>
                  {(templates.data ?? []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.kind})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </Card>

          <Card title="Recipient">
            <div className="stack">
              <Field label="Full name" required hint="Rendered on the credential exactly as typed.">
                {(props) => (
                  <Input
                    {...props}
                    value={recipient.name}
                    onChange={(e) => setRecipient({ ...recipient, name: e.target.value })}
                    required
                  />
                )}
              </Field>

              <Field label="Email" required hint="Where the credential is delivered.">
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    value={recipient.email}
                    onChange={(e) => setRecipient({ ...recipient, email: e.target.value })}
                    required
                  />
                )}
              </Field>

              <Field
                label="External ID"
                hint="Optional. Your student number or HR identifier — used to de-duplicate."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={recipient.externalId}
                    onChange={(e) => setRecipient({ ...recipient, externalId: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </Card>

          {fields.length > 0 && (
            <Card
              title="Credential details"
              description="These fill the merge fields this template declares."
            >
              <div className="stack">
                {fields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    required={requiredKeys.has(field.key)}
                    hint={
                      field.example
                        ? `For example: ${field.example}`
                        : requiredKeys.has(field.key)
                          ? undefined
                          : 'Optional — the design hides this when it is empty.'
                    }
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                        required={requiredKeys.has(field.key)}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </Card>
          )}

          <Card title="Options">
            <div className="stack">
              <Field label="Credential title" hint="Defaults to the template name.">
                {(props) => (
                  <Input
                    {...props}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={detail.data?.name ?? ''}
                  />
                )}
              </Field>

              <Field label="Description" hint="Shown on the verification page.">
                {(props) => (
                  <Textarea
                    {...props}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                )}
              </Field>

              <Field
                label="Expiry date"
                hint="Leave empty for a credential that never expires."
              >
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                )}
              </Field>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={suppressEmail}
                  onChange={(e) => setSuppressEmail(e.target.checked)}
                />
                <span>
                  Do not email the recipient
                  <span className="hint" style={{ display: 'block' }}>
                    The credential is still issued and verifiable; you deliver it yourself.
                  </span>
                </span>
              </label>
            </div>
          </Card>

          {missing.length > 0 && (
            <Banner tone="warn">
              Still needed: {missing.join(', ')}. The API would reject this before issuing anything.
            </Banner>
          )}

          <div className="row">
            <Button type="submit" variant="primary" loading={issue.busy} disabled={!canSubmit}>
              Issue credential
            </Button>
            <Link className="btn btn-ghost" href="/credentials">
              Cancel
            </Link>
          </div>
        </form>

        <div className="stack">
          <Card title="Preview" description="Rendered from the real template with your values.">
            {templateId ? (
              <TemplatePreview
                templateId={templateId}
                data={{
                  ...values,
                  'recipient.name': recipient.name || 'Recipient name',
                }}
              />
            ) : (
              <p className="subtle">Choose a template to see a preview.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
