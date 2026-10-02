import { headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  negotiateLocale,
  type Locale,
  type Translator,
} from '@opencred/i18n';

/**
 * Resolves the locale for a server-rendered recipient-facing page.
 *
 * Precedence, and the reasoning for it:
 *
 *  1. An explicit `?lang=` in the URL. A credential is frequently forwarded to
 *     someone whose browser is set to a different language from the recipient's
 *     — an issuer emailing a Spanish cohort, a candidate sending a link to an
 *     employer abroad. An explicit choice must win, and it makes the link
 *     shareable in a chosen language.
 *  2. The `Accept-Language` header.
 *  3. English.
 *
 * There is deliberately no cookie and no persistence: a verification page is a
 * document someone opens once, not an application they configure.
 */
export async function resolveLocale(searchParams?: {
  lang?: string | string[];
}): Promise<Locale> {
  const requested = Array.isArray(searchParams?.lang) ? searchParams?.lang[0] : searchParams?.lang;
  if (isLocale(requested)) return requested;

  try {
    const headerList = await headers();
    return negotiateLocale(headerList.get('accept-language'));
  } catch {
    // `headers()` is unavailable during static generation; those pages are
    // English until a request supplies something better.
    return DEFAULT_LOCALE;
  }
}

export async function getPageTranslator(searchParams?: {
  lang?: string | string[];
}): Promise<Translator> {
  return getTranslator(await resolveLocale(searchParams));
}

export { getTranslator, type Locale, type Translator };
