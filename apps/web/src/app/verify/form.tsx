'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, Textarea, Banner } from '@/components/ui';

type Mode = 'id' | 'bulk' | 'file';

interface BulkResult {
  publicId: string;
  found: boolean;
  valid: boolean;
  status: string;
  title?: string;
  issuer?: string;
  issuedAt?: string;
}

/**
 * The verification form.
 *
 * The single-ID path is a plain navigation to `/v/:id` rather than a fetch,
 * because the destination is a real, shareable, server-rendered page and the
 * verifier will very often want to send that link to someone else.
 */
export function VerifyForm({ apiBase }: { apiBase: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('id');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkResult[] | null>(null);
  const [fileResult, setFileResult] = useState<{
    verified: boolean;
    errors: string[];
    hash: string;
    checks: Record<string, { ok: boolean }>;
  } | null>(null);

  const submitId = (event: React.FormEvent) => {
    event.preventDefault();
    const id = value.trim().toLowerCase().replace(/[\s_-]/g, '');
    if (!id) {
      setError('Enter the credential ID printed on the certificate.');
      return;
    }
    router.push(`/v/${encodeURIComponent(id)}`);
  };

  const submitBulk = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setBulk(null);

    const ids = value
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 1000);

    if (ids.length === 0) {
      setError('Paste one or more credential IDs, separated by commas or new lines.');
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${apiBase}/v1/public/verify/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialIds: ids }),
      });
      if (!response.ok) throw new Error(`Verification service returned ${response.status}`);
      const data = (await response.json()) as { results: BulkResult[] };
      setBulk(data.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFileResult(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setError('That is not valid JSON. Paste the full contents of the credential file.');
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${apiBase}/v1/public/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: parsed, checkStatus: true }),
      });
      const data = await response.json();
      setFileResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad stack">
      <div className="pill-tabs" role="tablist" aria-label="Verification method">
        {(
          [
            ['id', 'By credential ID'],
            ['bulk', 'Many at once'],
            ['file', 'Paste a credential file'],
          ] as Array<[Mode, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={mode === key}
            onClick={() => {
              setMode(key);
              setValue('');
              setError(null);
              setBulk(null);
              setFileResult(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {mode === 'id' && (
        <form onSubmit={submitId} className="stack">
          <Field
            label="Credential ID"
            hint="Printed on the certificate, usually next to the QR code. Ten characters."
          >
            {(props) => (
              <Input
                {...props}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="k7m2q9xb4t"
                autoComplete="off"
                spellCheck={false}
                className="input mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary">
            Verify
          </Button>
        </form>
      )}

      {mode === 'bulk' && (
        <form onSubmit={submitBulk} className="stack">
          <Field
            label="Credential IDs"
            hint="One per line, or comma-separated. Up to 1,000 at a time."
          >
            {(props) => (
              <Textarea
                {...props}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={'k7m2q9xb4t\nj4h8p2mq7v'}
                rows={6}
                spellCheck={false}
                className="textarea mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Verify all
          </Button>

          {bulk && (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Bulk verification results</caption>
                <thead>
                  <tr>
                    <th scope="col">Credential ID</th>
                    <th scope="col">Result</th>
                    <th scope="col">Credential</th>
                    <th scope="col">Issuer</th>
                  </tr>
                </thead>
                <tbody>
                  {bulk.map((row) => (
                    <tr key={row.publicId}>
                      <td>
                        <code className="mono">{row.publicId}</code>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            row.valid
                              ? 'badge-ok'
                              : row.found
                                ? 'badge-warn'
                                : 'badge-danger'
                          }`}
                        >
                          {row.valid ? 'Valid' : row.found ? row.status : 'Not found'}
                        </span>
                      </td>
                      <td>{row.title ?? '—'}</td>
                      <td>{row.issuer ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      )}

      {mode === 'file' && (
        <form onSubmit={submitFile} className="stack">
          <Field
            label="Credential JSON"
            hint="The signed Open Badges 3.0 document. Checked against the issuer's own DID — we do not need to have issued it."
          >
            {(props) => (
              <Textarea
                {...props}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder='{"@context": ["https://www.w3.org/ns/credentials/v2", …'
                rows={10}
                spellCheck={false}
                className="textarea mono"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Verify document
          </Button>

          {fileResult && (
            <div className="stack-sm stack">
              <Banner tone={fileResult.verified ? 'ok' : 'danger'}>
                {fileResult.verified
                  ? 'This credential is authentic and currently valid.'
                  : 'This credential did not verify.'}
              </Banner>
              <ul className="check-list">
                {Object.entries(fileResult.checks ?? {}).map(([name, check]) => (
                  <li key={name}>
                    <span
                      className={`check-mark ${check.ok ? 'check-pass' : 'check-fail'}`}
                      aria-hidden="true"
                    >
                      {check.ok ? '✓' : '✕'}
                    </span>
                    <span style={{ textTransform: 'capitalize' }}>{name}</span>
                  </li>
                ))}
              </ul>
              {fileResult.errors?.length > 0 && (
                <ul className="subtle" style={{ paddingLeft: 20 }}>
                  {fileResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <div className="subtle">
                Content hash: <code className="mono">{fileResult.hash}</code>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
