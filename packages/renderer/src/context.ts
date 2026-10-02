import type { MergeContext } from '@opencred/schema';

/**
 * Builds the flat merge context a template is rendered against.
 *
 * Kept in one place because three call sites must agree exactly: the render
 * worker, the design-studio live preview, and the delivery-email templating.
 * If the preview resolved `{{recipient.first_name}}` differently from the
 * worker, the studio would be lying to the designer.
 */

export interface MergeContextInput {
  recipient: {
    name: string;
    email?: string | null;
    externalId?: string | null;
  };
  credential: {
    id: string;
    publicId: string;
    title: string;
    description?: string | null;
    verificationUrl: string;
    issuedAt: string | Date;
    expiresAt?: string | Date | null;
  };
  issuer: { name: string; url?: string | null };
  batch?: { name?: string | null };
  /** Values from the CSV row or API payload, exposed under their own keys. */
  data?: Record<string, string | number | null | undefined>;
}

function iso(value: string | Date | null | undefined): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Split a display name into first/last parts.
 *
 * Deliberately simple, and deliberately not clever: the last whitespace-
 * separated token is treated as the family name and everything before it as
 * the given name. That is wrong for a meaningful share of the world's names,
 * which is exactly why `{{recipient.name}}` is the field templates use by
 * default and why an issuer can always map explicit first/last columns from
 * their CSV instead. This helper exists for greetings, not for records.
 */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function buildMergeContext(input: MergeContextInput): MergeContext {
  const { first, last } = splitName(input.recipient.name);

  const ctx: MergeContext = {
    'recipient.name': input.recipient.name,
    'recipient.first_name': first,
    'recipient.last_name': last,
    'recipient.email': input.recipient.email ?? '',
    'recipient.external_id': input.recipient.externalId ?? '',
    'credential.id': input.credential.id,
    'credential.public_id': input.credential.publicId,
    'credential.title': input.credential.title,
    'credential.description': input.credential.description ?? '',
    'credential.verification_url': input.credential.verificationUrl,
    'issuer.name': input.issuer.name,
    'issuer.url': input.issuer.url ?? '',
    issued_at: iso(input.credential.issuedAt),
    expires_at: iso(input.credential.expiresAt),
    'batch.name': input.batch?.name ?? '',
  };

  // Custom columns land both bare (`{{score}}`) and namespaced
  // (`{{data.score}}`). The bare form is what a non-technical template author
  // reaches for; the namespaced form disambiguates a column named `issued_at`.
  for (const [key, value] of Object.entries(input.data ?? {})) {
    if (value === undefined) continue;
    const normalized = value === null ? '' : value;
    ctx[key] = normalized;
    ctx[`data.${key}`] = normalized;
  }

  return ctx;
}

/** A context of plausible sample values, for the studio preview and thumbnails. */
export function sampleMergeContext(overrides: MergeContext = {}): MergeContext {
  return {
    ...buildMergeContext({
      recipient: {
        name: 'Priya Raman',
        email: 'priya.raman@example.com',
        externalId: 'STU-100244',
      },
      credential: {
        id: 'urn:uuid:6f5c1f7e-0f45-4a2a-9b7f-2c7d8a1c9e01',
        publicId: 'k7m2q9xb4t',
        title: 'Advanced Data Engineering',
        description: 'Completed the 12-week advanced data engineering programme.',
        verificationUrl: 'https://example.org/v/k7m2q9xb4t',
        issuedAt: '2026-03-01T00:00:00.000Z',
        expiresAt: '2029-03-01T00:00:00.000Z',
      },
      issuer: { name: 'Example Institute', url: 'https://example.org' },
      batch: { name: 'Spring 2026 cohort' },
      data: { score: '94', grade: 'Distinction', hours: '120', course: 'Data Engineering' },
    }),
    ...overrides,
  };
}
