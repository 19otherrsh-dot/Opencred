'use client';

import { useState } from 'react';
import { api, downloadFile } from '@/lib/api';
import { useApi, useMutation } from '@/lib/use-api';
import { useAuth } from '@/lib/auth';
import { Banner, Button, Card, ErrorNotice, Field, Input } from '@/components/ui';

interface EraseResult {
  dryRun: boolean;
  recipientId: string | null;
  credentialsAffected: number;
  artefactsDeleted: number;
  completedAt: string | null;
}

interface ProcessingRecord {
  controller: { name: string; contactEmail: string | null; website: string | null };
  dataRegion: string;
  categories: Array<{
    category: string;
    fields: string[];
    purpose: string;
    lawfulBasis: string;
    retention: string;
    note?: string;
  }>;
  subjectRights: Record<string, string>;
}

/**
 * FR-GOV-01 — data-subject request tooling.
 *
 * The erasure flow is deliberately a two-step, dry-run-first operation with
 * blunt copy, because the honest answer is uncomfortable: you cannot erase a
 * person from a signed statement about that person and leave a valid credential
 * behind. Pretending otherwise would be the easy product decision and the wrong
 * one.
 */
export default function DataProtectionPage() {
  const { can } = useAuth();
  const record = useApi<ProcessingRecord>('/v1/gdpr/processing-record');
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState<EraseResult | null>(null);
  const [done, setDone] = useState<EraseResult | null>(null);

  const dryRun = useMutation(async () => {
    const result = await api.post<EraseResult>('/v1/gdpr/subject/erase', {
      email,
      dryRun: true,
    });
    setPreview(result);
    setDone(null);
  });

  const erase = useMutation(async () => {
    const result = await api.post<EraseResult>('/v1/gdpr/subject/erase', {
      email,
      dryRun: false,
      reason: 'data subject request',
    });
    setDone(result);
    setPreview(null);
  });

  return (
    <div className="stack">
      <Card
        title="Subject access and portability"
        description="Everything held about one person, as machine-readable JSON."
      >
        <div className="stack">
          <Field label="Recipient email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPreview(null);
                  setDone(null);
                }}
                placeholder="person@example.com"
              />
            )}
          </Field>

          <div className="row">
            <Button
              disabled={!email.trim() || !can('gdpr:manage')}
              onClick={() =>
                void downloadFile(
                  `/v1/gdpr/subject?email=${encodeURIComponent(email.trim())}`,
                  `subject-${email.trim()}.json`,
                )
              }
            >
              Download their data
            </Button>
          </div>

          <p className="subtle">
            Includes their recipient record, every credential issued to them, the merge values, the
            full event history, and the signed credential documents themselves.
          </p>
        </div>
      </Card>

      {can('gdpr:manage') && (
        <Card title="Erasure" description="Irreversible. Preview first.">
          <div className="stack">
            {dryRun.error && <ErrorNotice error={dryRun.error} />}
            {erase.error && <ErrorNotice error={erase.error} />}

            <Banner tone="warn" title="Read this before you use it">
              A credential is a signed statement about a named person. Removing the person does not
              leave a valid credential behind — it leaves a signature over data that no longer
              exists. So erasure here <strong>revokes</strong> every affected credential, deletes
              its signed document and rendered files, and pseudonymises the recipient record. The
              credential rows survive without personal data, so you can still show an auditor that
              a credential was issued and later erased.
            </Banner>

            <div className="row">
              <Button
                loading={dryRun.busy}
                disabled={!email.trim()}
                onClick={() => void dryRun.run()}
              >
                Preview the impact
              </Button>
            </div>

            {preview && (
              <>
                <Banner tone="info" title="This is what would happen">
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    <li>{preview.credentialsAffected} credentials revoked and stripped</li>
                    <li>{preview.artefactsDeleted} rendered files deleted</li>
                    <li>The recipient record pseudonymised</li>
                  </ul>
                </Banner>

                <div className="row">
                  <Button
                    variant="danger"
                    loading={erase.busy}
                    onClick={() => void erase.run()}
                  >
                    Erase {email} permanently
                  </Button>
                </div>
              </>
            )}

            {done && (
              <Banner tone="ok" title="Erasure complete">
                {done.credentialsAffected} credentials revoked, {done.artefactsDeleted} files
                deleted. Recorded in the audit log.
              </Banner>
            )}
          </div>
        </Card>
      )}

      {record.data && (
        <Card
          title="Processing record"
          description="Generated from the live schema and configuration, not written by hand."
        >
          <div className="stack">
            <dl className="kv">
              <dt>Controller</dt>
              <dd>{record.data.controller.name}</dd>
              <dt>Data region</dt>
              <dd style={{ textTransform: 'capitalize' }}>{record.data.dataRegion}</dd>
            </dl>

            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Categories of personal data processed</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Fields</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {record.data.categories.map((category) => (
                    <tr key={category.category}>
                      <td>
                        <strong>{category.category}</strong>
                        {category.note && <div className="subtle">{category.note}</div>}
                      </td>
                      <td className="subtle">{category.fields.join(', ')}</td>
                      <td className="subtle">{category.purpose}</td>
                      <td className="subtle">{category.retention}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      <Card title="Export everything" description="No support ticket, no notice period, no export fee.">
        <div className="row row-wrap">
          <Button onClick={() => void downloadFile('/v1/credentials/export.csv', 'credentials.csv')}>
            All credentials (CSV)
          </Button>
          <Button onClick={() => void downloadFile('/v1/recipients/export.csv', 'recipients.csv')}>
            All recipients (CSV)
          </Button>
          <Button onClick={() => void downloadFile('/v1/analytics/export.csv', 'events.csv')}>
            All events (CSV)
          </Button>
        </div>
        <p className="subtle" style={{ marginTop: 'var(--sp-3)' }}>
          Signed credential documents are downloadable individually and are included in the
          subject-data export. Leaving should be easy; that is the point of building it this way.
        </p>
      </Card>
    </div>
  );
}
