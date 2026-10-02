import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  LOCALE_REVIEW,
  direction,
  getTranslator,
  isLocale,
  messageKeys,
  missingKeys,
  negotiateLocale,
  translate,
} from '../index';

test('every locale has every message key', () => {
  for (const locale of LOCALES) {
    const missing = missingKeys(locale);
    assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`);
  }
});

test('no locale has an empty string where English has text', () => {
  for (const locale of LOCALES) {
    for (const key of messageKeys()) {
      assert.notEqual(translate(locale, key).trim(), '', `${locale}.${key} is empty`);
    }
  }
});

test('placeholders survive translation in every locale', () => {
  // A translator dropping `{issuer}` would silently produce "revoked this
  // credential on ." — grammatically odd and missing the fact that matters.
  const withPlaceholders: Array<[Parameters<typeof translate>[1], string[]]> = [
    ['verify.valid.subtitle', ['issuer']],
    ['verify.revoked.subtitle', ['issuer', 'date']],
    ['verify.expired.subtitle', ['date']],
    ['verify.checks.subtitle', ['timestamp']],
    ['verify.checks.validityDetail', ['date']],
    ['verify.contact', ['email']],
    ['wallet.checkInboxBody', ['email']],
    ['wallet.count', ['count', 'email']],
  ];

  for (const locale of LOCALES) {
    for (const [key, placeholders] of withPlaceholders) {
      const raw = translate(locale, key);
      for (const placeholder of placeholders) {
        assert.ok(
          raw.includes(`{${placeholder}}`),
          `${locale}.${String(key)} lost the {${placeholder}} placeholder`,
        );
      }
    }
  }
});

test('interpolation substitutes values and leaves unknown placeholders alone', () => {
  assert.equal(
    translate('en', 'verify.valid.subtitle', { issuer: 'Example University' }),
    'Issued by Example University and cryptographically verified just now.',
  );

  // A missing value leaves the placeholder visible rather than printing
  // "undefined", which at least reads as a bug rather than as content.
  assert.equal(translate('en', 'verify.expired.subtitle'), 'It was valid until {date}.');
});

test('an unknown locale falls back to English rather than to raw keys', () => {
  const result = translate('zz' as never, 'verify.valid.title');
  assert.equal(result, 'This credential is valid');
});

test('Accept-Language negotiation honours quality values', () => {
  assert.equal(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(negotiateLocale('en-US,en;q=0.9'), 'en');
  assert.equal(negotiateLocale('de;q=0.9,es;q=0.8'), 'es');
  // Higher quality wins even when it appears later.
  assert.equal(negotiateLocale('de;q=0.9,hi;q=1.0'), 'hi');
});

test('a regional tag falls back to its base language', () => {
  assert.equal(negotiateLocale('pt-BR'), 'pt');
  assert.equal(negotiateLocale('es-419,es-MX'), 'es');
  assert.equal(negotiateLocale('ar-EG'), 'ar');
});

test('unrecognised or absent headers fall back to English', () => {
  assert.equal(negotiateLocale(null), DEFAULT_LOCALE);
  assert.equal(negotiateLocale(''), DEFAULT_LOCALE);
  assert.equal(negotiateLocale('de-DE,ja;q=0.8'), DEFAULT_LOCALE);
  assert.equal(negotiateLocale('*'), DEFAULT_LOCALE);
  // q=0 means "explicitly not this one".
  assert.equal(negotiateLocale('fr;q=0'), DEFAULT_LOCALE);
});

test('Arabic is right-to-left and everything else is not', () => {
  assert.equal(direction('ar'), 'rtl');
  for (const locale of LOCALES.filter((l) => l !== 'ar')) {
    assert.equal(direction(locale), 'ltr', `${locale} should be ltr`);
  }
});

test('dates render in the locale but always in UTC', () => {
  // 23:30 UTC on the 1st is still the 1st everywhere, which is the point:
  // a credential must not appear to have been issued on different days to
  // different viewers.
  const instant = '2026-03-01T23:30:00.000Z';

  assert.match(getTranslator('en').date(instant), /1 March 2026/);
  assert.match(getTranslator('es').date(instant), /1 de marzo de 2026/);
  assert.match(getTranslator('fr').date(instant), /1 mars 2026/);

  for (const locale of LOCALES) {
    const rendered = getTranslator(locale).date(instant);
    assert.ok(rendered.length > 0 && rendered !== '—', `${locale} produced no date`);
  }
});

test('invalid dates render as an em dash rather than "Invalid Date"', () => {
  const t = getTranslator('en');
  assert.equal(t.date(null), '—');
  assert.equal(t.date('not-a-date'), '—');
  assert.equal(t.dateTime(undefined), '—');
});

test('locale metadata is complete and honest about review status', () => {
  for (const locale of LOCALES) {
    assert.ok(LOCALE_NAMES[locale]?.native, `${locale} has no native name`);
    assert.ok(LOCALE_REVIEW[locale], `${locale} has no review status`);
  }

  // English is the source of truth; nothing else may claim to be.
  assert.equal(LOCALE_REVIEW.en, 'source');
  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    assert.notEqual(LOCALE_REVIEW[locale], 'source', `${locale} cannot also be the source`);
  }
});

test('isLocale narrows correctly', () => {
  assert.equal(isLocale('hi'), true);
  assert.equal(isLocale('klingon'), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(undefined), false);
});

test('translations are not simply copies of the English string', () => {
  // A guard against a locale file being stubbed out with English and forgotten.
  // A handful of legitimately identical strings (brand names, "LinkedIn") are
  // expected, so this asserts on the proportion rather than on any one key.
  const keys = messageKeys();

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    const identical = keys.filter((key) => translate(locale, key) === translate('en', key));
    assert.ok(
      identical.length < keys.length * 0.1,
      `${locale} is ${Math.round((identical.length / keys.length) * 100)}% identical to English — likely untranslated`,
    );
  }
});
