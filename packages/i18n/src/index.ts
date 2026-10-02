import { en, type Catalogue, type MessageKey } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { pt } from './locales/pt';
import { hi } from './locales/hi';
import { ar } from './locales/ar';

/**
 * Interface localisation (§9.4).
 *
 * A deliberately small runtime — catalogue lookup, `{placeholder}`
 * interpolation, locale negotiation and direction — rather than a full i18n
 * library. The reasoning is the same as everywhere else in this codebase: the
 * verification page is the surface that must load fast on a bad connection, and
 * it does not need a message-format parser with a plural-rule dataset attached
 * to render sixty strings.
 *
 * Scope is the recipient-facing surfaces. The issuer dashboard is English-only
 * and can adopt this catalogue incrementally. Shipping a language selector that
 * translates a third of the product would be worse than the honest gap.
 */

export type { Catalogue, MessageKey };
export { en };

export const LOCALES = ['en', 'es', 'fr', 'pt', 'hi', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

const CATALOGUES: Record<Locale, Catalogue> = { en, es, fr, pt, hi, ar };

export const LOCALE_NAMES: Record<Locale, { english: string; native: string }> = {
  en: { english: 'English', native: 'English' },
  es: { english: 'Spanish', native: 'Español' },
  fr: { english: 'French', native: 'Français' },
  pt: { english: 'Portuguese', native: 'Português' },
  hi: { english: 'Hindi', native: 'हिन्दी' },
  ar: { english: 'Arabic', native: 'العربية' },
};

/**
 * Translation review status, reported honestly.
 *
 * English is written by the product team. Everything else was drafted and has
 * not been through a native speaker. On a page whose entire job is to be
 * believed, that distinction is worth surfacing rather than burying, and
 * `GET /v1/instance` exposes it so an operator can see what they are serving.
 */
export const LOCALE_REVIEW: Record<Locale, 'source' | 'unreviewed' | 'reviewed'> = {
  en: 'source',
  es: 'unreviewed',
  fr: 'unreviewed',
  pt: 'unreviewed',
  hi: 'unreviewed',
  ar: 'unreviewed',
};

const RTL_LOCALES = new Set<Locale>(['ar']);

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Text direction for a locale. Drives `dir` on the document element. */
export function direction(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/**
 * Pick the best locale from an `Accept-Language` header.
 *
 * Handles quality values and falls back from a region to its base language, so
 * `pt-BR` finds `pt` and `es-419` finds `es`. Anything unrecognised falls
 * through to English rather than to a partially translated page.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  available: readonly Locale[] = LOCALES,
): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    if (tag === '*') return DEFAULT_LOCALE;

    const exact = available.find((locale) => locale === tag);
    if (exact) return exact;

    const base = tag.split('-')[0];
    const partial = available.find((locale) => locale === base);
    if (partial) return partial;
  }

  return DEFAULT_LOCALE;
}

export type Values = Record<string, string | number>;

/**
 * Look up and interpolate a message.
 *
 * A missing key falls back to English rather than rendering the key itself. A
 * visitor should never see `verify.checks.signature` on a credential page — a
 * partially translated page is a small problem, a page displaying internal
 * identifiers is an embarrassing one.
 */
export function translate(locale: Locale, key: MessageKey, values?: Values): string {
  const catalogue = CATALOGUES[locale] ?? en;
  const template = catalogue[key] ?? en[key];

  if (template === undefined) {
    // Only reachable if a key is removed from `en` while a caller still uses
    // it, which the type system prevents at compile time.
    return String(key);
  }

  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

/** A bound translator, so callers do not repeat the locale on every line. */
export interface Translator {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, values?: Values) => string;
  /** Locale-aware date formatting, always in UTC. See the note below. */
  date: (value: string | Date | null | undefined) => string;
  dateTime: (value: string | Date | null | undefined) => string;
  number: (value: number) => string;
}

/**
 * The BCP 47 tag used for formatting, which is not always the catalogue key.
 *
 * `en` maps to `en-GB` deliberately. Bare `en` gives US ordering
 * ("March 1, 2026"), and this is an international credential product whose
 * dates are read by people who order dates differently. Day-month-year is
 * unambiguous to the widest audience, and it matches the convention the rest of
 * the product already uses. The numeric form is never used anywhere, because
 * "3/1/2026" means two different days depending on the reader.
 */
const FORMAT_TAGS: Record<Locale, string> = {
  en: 'en-GB',
  es: 'es',
  fr: 'fr',
  pt: 'pt-BR',
  hi: 'hi-IN',
  ar: 'ar',
};

export function getTranslator(locale: Locale): Translator {
  const tag = FORMAT_TAGS[locale] ?? locale;

  /*
   * Dates render in the visitor's language but always in UTC.
   *
   * The language part is a courtesy; the UTC part is a correctness requirement.
   * A verification page must show the same issue date to the recipient in
   * Mumbai and the employer in Berlin — a credential that appears to have been
   * issued on different days depending on who is looking is a credential
   * somebody will question.
   */
  const dateFormat = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const dateTimeFormat = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

  const numberFormat = new Intl.NumberFormat(tag);

  const toDate = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const date = typeof value === 'string' ? new Date(value) : value;
    return Number.isNaN(date.getTime()) ? null : date;
  };

  return {
    locale,
    dir: direction(locale),
    t: (key, values) => translate(locale, key, values),
    date: (value) => {
      const date = toDate(value);
      return date ? dateFormat.format(date) : '—';
    },
    dateTime: (value) => {
      const date = toDate(value);
      return date ? dateTimeFormat.format(date) : '—';
    },
    number: (value) => numberFormat.format(value),
  };
}

/** Every key present in `en`, for coverage checks and tooling. */
export function messageKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}

/** Keys a locale is missing relative to English. */
export function missingKeys(locale: Locale): MessageKey[] {
  const catalogue = CATALOGUES[locale];
  return messageKeys().filter((key) => !catalogue[key]);
}
