'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Server-rendered template preview.
 *
 * Deliberately renders through the same API endpoint and the same headless
 * browser that produces the issued PDF, rather than approximating the layout in
 * the page. A preview that is drawn by different code from the output is a
 * preview that eventually lies, and in this product the lie arrives as a
 * thousand wrong certificates.
 *
 * Requests are debounced and superseded: typing in a form must not queue up
 * twenty Chromium renders.
 */
export function TemplatePreview({
  templateId,
  document: documentJson,
  data,
  format = 'png',
}: {
  templateId?: string;
  document?: unknown;
  data?: Record<string, string>;
  format?: 'png' | 'pdf';
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const objectUrl = useRef<string | null>(null);
  const sequence = useRef(0);

  const payload = JSON.stringify({ templateId, document: documentJson, data, format });

  useEffect(() => {
    if (!templateId && !documentJson) return;

    const id = ++sequence.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.raw('/v1/templates/preview', {
          method: 'POST',
          body: JSON.parse(payload),
        });
        if (id !== sequence.current) return;

        setDegraded(response.headers.get('x-opencred-degraded-rendering') === 'true');
        const blob = await response.blob();
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setUrl(objectUrl.current);
      } catch (err) {
        if (id !== sequence.current) return;
        setError((err as Error).message);
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [payload, templateId, documentJson]);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  return (
    <div className="stack-sm stack">
      <div
        className="credential-preview"
        style={{ minHeight: 160, display: 'grid', placeItems: 'center', position: 'relative' }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Template preview" style={{ width: '100%', height: 'auto' }} />
        ) : (
          <div className="skeleton" style={{ width: '100%', height: 200 }} />
        )}

        {loading && url && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in srgb, var(--surface) 55%, transparent)',
            }}
          >
            <span className="spin" aria-label="Rendering preview" />
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {degraded && (
        <p className="subtle">
          Chromium is not installed on the render worker, so this is vector SVG rather than a
          rasterised PDF preview. Issued credentials will be SVG too until it is installed.
        </p>
      )}
    </div>
  );
}
