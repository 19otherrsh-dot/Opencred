/**
 * Formatting helpers.
 *
 * Dates are rendered in UTC with an explicit locale rather than the visitor's
 * locale, for one specific reason: a verification page must show the same issue
 * date to the recipient in Mumbai and the employer in Berlin. A credential
 * that appears to have been issued on different days depending on who is
 * looking is a credential someone will question.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_SHORT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATETIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATE_SHORT.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATETIME.format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(Math.round(seconds), 'second');
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'Custom';
  if (cents === 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

export type CredentialStatus = 'draft' | 'issued' | 'expired' | 'revoked';

export function statusBadge(status: string): { className: string; label: string } {
  switch (status) {
    case 'issued':
      return { className: 'badge badge-ok', label: 'Valid' };
    case 'draft':
      return { className: 'badge badge-neutral', label: 'Processing' };
    case 'expired':
      return { className: 'badge badge-warn', label: 'Expired' };
    case 'revoked':
      return { className: 'badge badge-danger', label: 'Revoked' };
    case 'completed':
      return { className: 'badge badge-ok', label: 'Completed' };
    case 'processing':
      return { className: 'badge badge-info', label: 'Processing' };
    case 'queued':
      return { className: 'badge badge-info', label: 'Scheduled' };
    case 'ready':
      return { className: 'badge badge-neutral', label: 'Ready' };
    case 'failed':
      return { className: 'badge badge-danger', label: 'Failed' };
    case 'sent':
      return { className: 'badge badge-ok', label: 'Delivered' };
    case 'pending':
      return { className: 'badge badge-neutral', label: 'Pending' };
    case 'bounced':
      return { className: 'badge badge-danger', label: 'Bounced' };
    default:
      return { className: 'badge badge-neutral', label: status };
  }
}

/** Human labels for the credential event vocabulary. */
export const EVENT_LABELS: Record<string, string> = {
  created: 'Credential created',
  rendered: 'Rendered',
  email_queued: 'Email queued',
  email_sent: 'Email delivered',
  email_failed: 'Email failed',
  email_bounced: 'Email bounced',
  email_opened: 'Email opened',
  downloaded: 'Downloaded',
  viewed: 'Verification page viewed',
  verified: 'Verified',
  shared: 'Shared',
  linkedin_added: 'Added to LinkedIn',
  wallet_added: 'Added to wallet',
  edited: 'Edited',
  revoked: 'Revoked',
  expired: 'Expired',
  reissued: 'Reissued',
};
