'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import {
  Banner,
  Button,
  Card,
  ErrorNotice,
  Field,
  Input,
  Select,
} from '@/components/ui';

/**
 * The bulk-issuance wizard (FR-REC-01, FR-ISS-01).
 *
 * Four steps, and the third one is the reason the wizard exists. Every
 * competitor lets you upload a CSV; what generates support tickets is
 * discovering after ten thousand emails have gone out that forty rows had a
 * malformed address. So validation is a mandatory step with its own screen, and
 * the issue button stays disabled until the issuer has seen the report.
 */

type Step = 'upload' | 'map' | 'review' | 'done';

interface UploadResult {
  batchId: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  requiredFields: string[];
  optionalFields: string[];
  sample: Array<Record<string, string>>;
  totalRows: number;
}

interface ValidationReport {
  totalRows: number;
  validRows: number;
  duplicatesInFile: number;
  existingRecipients: number;
  issues: Array<{ row: number; field: string; code: string; message: string }>;
}

const FIELD_LABELS: Record<string, string> = {
  'recipient.name': 'Recipient name',
  'recipient.email': 'Recipient email',
  'recipient.external_id': 'External ID',
};

export default function NewBatchPage() {
  const router = useRouter();
  const templates = useApi<Array<{ id: string; name: string; kind: string }>>('/v1/templates');

  const [step, setStep] = useState<Step>('upload');
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [options, setOptions] = useState({
    skipInvalidRows: true,
    suppressEmail: false,
    scheduledAt: '',
    expiresAt: '',
  });

  const doUpload = useMutation(async () => {
    if (!file || !templateId) return;
    const form = new FormData();
    form.set('file', file);
    form.set('templateId', templateId);
    if (name.trim()) form.set('name', name.trim());

    const result = await api.post<UploadResult>('/v1/batches/upload', form);
    setUpload(result);
    setMapping(result.suggestedMapping);
    setStep('map');
  });

  const doValidate = useMutation(async () => {
    if (!upload) return;
    const result = await api.post<ValidationReport>(`/v1/batches/${upload.batchId}/validate`, {
      mapping,
      defaults,
    });
    setReport(result);
    setStep('review');
  });

  const doIssue = useMutation(async () => {
    if (!upload) return;
    await api.post(`/v1/batches/${upload.batchId}/issue`, {
      skipInvalidRows: options.skipInvalidRows,
      suppressEmail: options.suppressEmail,
      ...(options.scheduledAt
        ? { scheduledAt: new Date(options.scheduledAt).toISOString() }
        : {}),
      ...(options.expiresAt ? { expiresAt: new Date(options.expiresAt).toISOString() } : {}),
    });
    router.push(`/batches/${upload.batchId}`);
  });

  const allFields = [...(upload?.requiredFields ?? []), ...(upload?.optionalFields ?? [])];
  const unmappedRequired = (upload?.requiredFields ?? []).filter(
    (field) => !mapping[field] && !defaults[field],
  );

  return (
    <div className="stack-lg stack">
      <div>
        <Link className="subtle" href="/batches">
          ← All batches
        </Link>
        <h1 style={{ marginTop: 'var(--sp-3)' }}>New batch</h1>
      </div>

      <ol
        className="row row-wrap"
        style={{ listStyle: 'none', padding: 0, gap: 'var(--sp-4)' }}
        aria-label="Progress"
      >
        {(
          [
            ['upload', '1. Upload'],
            ['map', '2. Map columns'],
            ['review', '3. Review'],
            ['done', '4. Issue'],
          ] as Array<[Step, string]>
        ).map(([key, label]) => (
          <li
            key={key}
            aria-current={step === key ? 'step' : undefined}
            className={step === key ? '' : 'subtle'}
            style={{ fontWeight: step === key ? 650 : 400 }}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <Card title="Upload your spreadsheet">
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void doUpload.run();
            }}
          >
            {doUpload.error && <ErrorNotice error={doUpload.error} />}

            <Field label="Template" required>
              {(props) => (
                <Select
                  {...props}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
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

            <Field label="Batch name" hint="How you will find this later. Defaults to the filename.">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Spring 2026 cohort"
                />
              )}
            </Field>

            <Field
              label="CSV file"
              required
              hint="One row per recipient, with a header row. Up to 100,000 rows."
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              )}
            </Field>

            <Banner tone="info">
              Nothing is issued at this step. You will see the columns we detected, then a
              validation report, before anything is created.
            </Banner>

            <div className="row">
              <Button
                type="submit"
                variant="primary"
                loading={doUpload.busy}
                disabled={!file || !templateId}
              >
                Continue
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 'map' && upload && (
        <Card
          title="Map your columns"
          description={`${formatNumber(upload.totalRows)} rows detected. We have guessed the mapping — check it.`}
        >
          <div className="stack">
            {doValidate.error && <ErrorNotice error={doValidate.error} />}

            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <caption className="sr-only">Column mapping</caption>
                <thead>
                  <tr>
                    <th scope="col">Credential field</th>
                    <th scope="col">Your column</th>
                    <th scope="col">Or a fixed value</th>
                    <th scope="col">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {allFields.map((field) => {
                    const required = upload.requiredFields.includes(field);
                    const column = mapping[field];
                    return (
                      <tr key={field}>
                        <td>
                          <strong>{FIELD_LABELS[field] ?? field}</strong>
                          {required && (
                            <span style={{ color: 'var(--danger)' }} title="Required">
                              {' '}
                              *
                            </span>
                          )}
                          <div className="subtle">
                            <code className="mono">{field}</code>
                          </div>
                        </td>
                        <td>
                          <Select
                            value={column ?? ''}
                            aria-label={`Column for ${field}`}
                            onChange={(e) => {
                              const next = { ...mapping };
                              if (e.target.value) next[field] = e.target.value;
                              else delete next[field];
                              setMapping(next);
                            }}
                          >
                            <option value="">Not mapped</option>
                            {upload.headers.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td>
                          <Input
                            value={defaults[field] ?? ''}
                            aria-label={`Fixed value for ${field}`}
                            placeholder="same for every row"
                            onChange={(e) =>
                              setDefaults({ ...defaults, [field]: e.target.value })
                            }
                          />
                        </td>
                        <td className="subtle truncate" style={{ maxWidth: 180 }}>
                          {column ? (upload.sample[0]?.[column] ?? '—') : (defaults[field] || '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {unmappedRequired.length > 0 && (
              <Banner tone="warn">
                Still to map: {unmappedRequired.join(', ')}. Every credential needs these.
              </Banner>
            )}

            <div className="row">
              <Button onClick={() => setStep('upload')}>Back</Button>
              <Button
                variant="primary"
                loading={doValidate.busy}
                disabled={unmappedRequired.length > 0}
                onClick={() => void doValidate.run()}
              >
                Validate {formatNumber(upload.totalRows)} rows
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'review' && report && upload && (
        <div className="stack">
          <div className="grid grid-4">
            <div className="card card-pad stat">
              <span className="stat-value">{formatNumber(report.validRows)}</span>
              <span className="stat-label">rows ready to issue</span>
            </div>
            <div className="card card-pad stat">
              <span className="stat-value" style={{ color: report.issues.length ? 'var(--warn)' : undefined }}>
                {formatNumber(report.totalRows - report.validRows)}
              </span>
              <span className="stat-label">rows with problems</span>
            </div>
            <div className="card card-pad stat">
              <span className="stat-value">{formatNumber(report.duplicatesInFile)}</span>
              <span className="stat-label">duplicates inside the file</span>
            </div>
            <div className="card card-pad stat">
              <span className="stat-value">{formatNumber(report.existingRecipients)}</span>
              <span className="stat-label">recipients you already have</span>
            </div>
          </div>

          {report.issues.length > 0 && (
            <Card
              title="What needs attention"
              description={`Showing ${Math.min(report.issues.length, 500)} issues. Fix them in your spreadsheet, or skip those rows.`}
            >
              <div className="table-wrap" style={{ border: 0, maxHeight: 320, overflowY: 'auto' }}>
                <table className="table">
                  <caption className="sr-only">Validation issues</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Field</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.issues.map((issue, index) => (
                      <tr key={index}>
                        <td className="mono">{issue.row}</td>
                        <td className="subtle">
                          <code className="mono">{issue.field}</code>
                        </td>
                        <td>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Issue options">
            <div className="stack">
              {doIssue.error && <ErrorNotice error={doIssue.error} />}

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={options.skipInvalidRows}
                  onChange={(e) => setOptions({ ...options, skipInvalidRows: e.target.checked })}
                />
                <span>
                  Skip the {formatNumber(report.totalRows - report.validRows)} rows with problems
                  <span className="hint" style={{ display: 'block' }}>
                    Turn this off and the batch will refuse to run until the file is clean.
                  </span>
                </span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={options.suppressEmail}
                  onChange={(e) => setOptions({ ...options, suppressEmail: e.target.checked })}
                />
                <span>
                  Do not email recipients
                  <span className="hint" style={{ display: 'block' }}>
                    Credentials are still issued and verifiable; you distribute them yourself.
                  </span>
                </span>
              </label>

              <div className="grid grid-2">
                <Field
                  label="Send at"
                  hint="Leave empty to issue immediately."
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="datetime-local"
                      value={options.scheduledAt}
                      onChange={(e) => setOptions({ ...options, scheduledAt: e.target.value })}
                    />
                  )}
                </Field>

                <Field label="Credentials expire on" hint="Leave empty for no expiry.">
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={options.expiresAt}
                      onChange={(e) => setOptions({ ...options, expiresAt: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              <Banner tone={report.validRows > 0 ? 'info' : 'danger'}>
                {report.validRows > 0 ? (
                  <>
                    About to issue <strong>{formatNumber(report.validRows)}</strong> credentials
                    {options.suppressEmail ? ' without sending email' : ' and email each recipient'}
                    {options.scheduledAt ? ', scheduled for later' : ''}. This cannot be undone,
                    though credentials can be revoked afterwards.
                  </>
                ) : (
                  'No rows are issuable. Fix the file and upload it again.'
                )}
              </Banner>

              <div className="row">
                <Button onClick={() => setStep('map')}>Back to mapping</Button>
                <Button
                  variant="primary"
                  loading={doIssue.busy}
                  disabled={report.validRows === 0}
                  onClick={() => void doIssue.run()}
                >
                  Issue {formatNumber(report.validRows)} credentials
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
