import type { TemplateDocument, TemplateElement } from './template';

/**
 * FR-DES-02 — merge fields.
 *
 * `{{recipient.name}}`, `{{credential.title | upper}}`, `{{issued_at | date:"D MMMM YYYY"}}`.
 *
 * Deliberately not a general template language. Templates are user-supplied
 * data that the render worker executes against a headless browser, so anything
 * with control flow or property traversal into arbitrary objects is a code
 * execution surface. This resolver reads a flat, pre-built context and applies
 * a closed list of formatting filters — nothing else is reachable.
 */

export interface MergeContext {
  [key: string]: string | number | null | undefined;
}

export const MERGE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(\|[^}]*)?\}\}/g;

/** Context keys the platform always provides, independent of the CSV columns. */
export const SYSTEM_MERGE_FIELDS = [
  'recipient.name',
  'recipient.first_name',
  'recipient.last_name',
  'recipient.email',
  'recipient.external_id',
  'credential.id',
  'credential.title',
  'credential.description',
  'credential.public_id',
  'credential.verification_url',
  'issuer.name',
  'issuer.url',
  'issued_at',
  'expires_at',
  'batch.name',
] as const;

type FilterFn = (input: string, arg: string | undefined, ctx: MergeContext) => string;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/**
 * A small date formatter rather than a dependency: templates are rendered
 * inside a sandboxed browser page where a locale-aware library would need the
 * full ICU dataset shipped alongside. Tokens follow the common
 * YYYY/MM/DD/HH/mm/ss + MMMM/MMM/dddd/ddd set.
 */
function formatDate(iso: string, pattern: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const map: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    YY: pad(d.getUTCFullYear() % 100),
    MMMM: MONTHS[d.getUTCMonth()],
    MMM: MONTHS[d.getUTCMonth()].slice(0, 3),
    MM: pad(d.getUTCMonth() + 1),
    M: String(d.getUTCMonth() + 1),
    DDDD: DAYS[d.getUTCDay()],
    dddd: DAYS[d.getUTCDay()],
    ddd: DAYS[d.getUTCDay()].slice(0, 3),
    DD: pad(d.getUTCDate()),
    D: String(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return pattern.replace(
    /YYYY|YY|MMMM|MMM|MM|M|DDDD|dddd|ddd|DD|D|HH|mm|ss/g,
    (t) => map[t] ?? t,
  );
}

const FILTERS: Record<string, FilterFn> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  title: (v) => v.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  trim: (v) => v.trim(),
  date: (v, arg) => (v ? formatDate(v, arg || 'D MMMM YYYY') : ''),
  default: (v, arg) => (v === '' ? arg ?? '' : v),
  truncate: (v, arg) => {
    const n = Number(arg ?? 40);
    return v.length > n ? `${v.slice(0, Math.max(0, n - 1))}…` : v;
  },
  ordinal: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    const s = ['th', 'st', 'nd', 'rd'];
    const m = n % 100;
    return `${n}${s[(m - 20) % 10] ?? s[m] ?? s[0]}`;
  },
  number: (v, arg) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    const digits = arg === undefined ? undefined : Number(arg);
    return digits === undefined ? n.toLocaleString('en-US') : n.toFixed(digits);
  },
};

export const AVAILABLE_FILTERS = Object.keys(FILTERS);

function parseFilters(raw: string | undefined): Array<{ name: string; arg?: string }> {
  if (!raw) return [];
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const idx = chunk.indexOf(':');
      if (idx === -1) return { name: chunk };
      const name = chunk.slice(0, idx).trim();
      let arg = chunk.slice(idx + 1).trim();
      if (
        (arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))
      ) {
        arg = arg.slice(1, -1);
      }
      return { name, arg };
    });
}

function stringify(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value) : value;
}

/** Resolve every `{{token}}` in a string against the context. */
export function renderMergeString(input: string, ctx: MergeContext): string {
  return input.replace(MERGE_TOKEN_RE, (_match, key: string, filterPart?: string) => {
    let value = stringify(ctx[key]);
    for (const f of parseFilters(filterPart?.slice(1))) {
      const fn = FILTERS[f.name];
      // Unknown filters pass the value through untouched rather than throwing:
      // a typo in one template must not fail a 10,000-row batch at render time.
      if (fn) value = fn(value, f.arg, ctx);
    }
    return value;
  });
}

/** Every distinct token key used anywhere in a template document. */
export function collectMergeTokens(doc: TemplateDocument): string[] {
  const found = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(MERGE_TOKEN_RE)) found.add(m[1]);
  };
  for (const el of doc.elements) {
    scan(el.showIf);
    if (el.type === 'text') scan(el.content);
    if (el.type === 'qr' && el.source === 'custom') scan(el.value);
    if (el.type === 'signature') {
      scan(el.name);
      scan(el.title);
    }
    if (el.type === 'image') scan(el.src);
  }
  return [...found].sort();
}

/**
 * Tokens a template needs that the platform does not supply itself — i.e. the
 * columns a CSV must provide. This drives the column-mapping UI and the
 * pre-issuance validation pass.
 */
export function requiredDataFields(doc: TemplateDocument): string[] {
  const system = new Set<string>(SYSTEM_MERGE_FIELDS);
  const declared = new Map(doc.fields.map((f) => [f.key, f]));
  return collectMergeTokens(doc).filter((token) => {
    if (system.has(token)) return false;

    const def = declared.get(token);
    // A declared field's `required` flag is the authority. A template that
    // renders `{{grade}}` behind a `showIf` guard is explicitly saying the
    // column is optional, and demanding it would force issuers to invent a
    // value for every learner who does not have one.
    if (def) return def.required;

    // An undeclared token is required by construction: nothing has declared it
    // optional and nothing supplies a default, so issuing without it would
    // leave a visible blank on the certificate.
    return true;
  });
}

/** Non-system tokens a template can use but does not insist on. */
export function optionalDataFields(doc: TemplateDocument): string[] {
  const system = new Set<string>(SYSTEM_MERGE_FIELDS);
  const required = new Set(requiredDataFields(doc));
  return collectMergeTokens(doc).filter((t) => !system.has(t) && !required.has(t));
}

/** True when an element's `showIf` condition passes for this row. */
export function elementIsVisible(el: TemplateElement, ctx: MergeContext): boolean {
  if (el.hidden) return false;
  if (!el.showIf) return true;
  const resolved = renderMergeString(
    el.showIf.includes('{{') ? el.showIf : `{{${el.showIf}}}`,
    ctx,
  ).trim();
  return resolved !== '' && resolved !== 'false' && resolved !== '0';
}
