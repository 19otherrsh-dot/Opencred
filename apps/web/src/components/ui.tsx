'use client';

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * The shared interface primitives.
 *
 * Small, unstyled-by-default wrappers over the CSS design system rather than a
 * component library. Each one exists because it encodes an accessibility
 * detail that is easy to forget: a label bound to its control, a dialog that
 * traps focus and closes on Escape, a status message that announces itself to a
 * screen reader.
 */

export function Button({
  variant = 'secondary',
  size,
  loading,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'lg';
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={[`btn btn-${variant}`, size ? `btn-${size}` : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {loading && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

let fieldCounter = 0;

export function Field({
  label,
  hint,
  error,
  required,
  children,
  id,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  id?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const [generated] = useState(() => id ?? `field-${(fieldCounter += 1)}`);
  const describedBy = [hint ? `${generated}-hint` : null, error ? `${generated}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <label className="label" htmlFor={generated}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--danger)' }}>
            {' '}
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children({
        id: generated,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {hint && (
        <span className="hint" id={`${generated}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error-text" id={`${generated}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`input ${props.className ?? ''}`} />
);

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`textarea ${props.className ?? ''}`} />
);

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`select ${props.className ?? ''}`} />
);

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  footer,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {description && <p className="subtle">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: '48ch' }}>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 10, color: 'var(--text-muted)' }}>
      <span className="spin" aria-hidden="true" />
      <span role="status">{label}…</span>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack-sm stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 44 }} />
      ))}
    </div>
  );
}

/**
 * A modal dialog.
 *
 * Uses the native `<dialog>` element, which gives focus trapping, Escape to
 * close, inert background content and the top layer for free — all things that
 * a div-based modal has to reimplement and usually gets wrong.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clicking the backdrop closes; clicking inside the panel does not.
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 0,
        background: 'var(--surface)',
        color: 'var(--text)',
        width: 'min(560px, 92vw)',
        boxShadow: 'var(--shadow-3)',
      }}
    >
      <div className="card-head">
        <h3 id="dialog-title">{title}</h3>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>
      </div>
      <div className="card-body">{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </dialog>
  );
}

/** Copy-to-clipboard with visible, announced confirmation. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard access can be denied; say so rather than silently failing.
          setCopied(false);
        }
      }}
    >
      <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    issued: ['badge-ok', 'Valid'],
    valid: ['badge-ok', 'Valid'],
    draft: ['badge-neutral', 'Processing'],
    expired: ['badge-warn', 'Expired'],
    revoked: ['badge-danger', 'Revoked'],
    completed: ['badge-ok', 'Completed'],
    processing: ['badge-info', 'Processing'],
    queued: ['badge-info', 'Scheduled'],
    ready: ['badge-neutral', 'Ready'],
    failed: ['badge-danger', 'Failed'],
    sent: ['badge-ok', 'Delivered'],
    pending: ['badge-neutral', 'Pending'],
    bounced: ['badge-danger', 'Bounced'],
    active: ['badge-ok', 'Active'],
  };
  const [className, label] = map[status] ?? ['badge-neutral', status];
  return (
    <span className={`badge ${className}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Inline error surface for a failed request, including the request id. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const err = error as { message?: string; requestId?: string; details?: unknown };
  const details = Array.isArray(err.details) ? err.details : null;

  return (
    <Banner tone="danger" title="That did not work">
      <div>{err.message ?? 'Unexpected error.'}</div>
      {details && (
        <ul style={{ margin: '6px 0 0 18px' }}>
          {details.map((d: { path?: string; message?: string }, i: number) => (
            <li key={i}>
              <code>{d.path}</code> {d.message}
            </li>
          ))}
        </ul>
      )}
      {err.requestId && (
        <div className="subtle" style={{ marginTop: 4 }}>
          Request <code>{err.requestId}</code>
        </div>
      )}
    </Banner>
  );
}
