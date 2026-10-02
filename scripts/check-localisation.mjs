#!/usr/bin/env node
/**
 * Localisation smoke test (§9.4, FR-DES-07).
 *
 * Fetches a real verification page in every supported language and asserts the
 * response actually changed — that the locale was negotiated, the strings were
 * translated, and the document direction flipped for Arabic.
 *
 *   node scripts/check-localisation.mjs [--web http://localhost:3000] [--api http://localhost:4000]
 *
 * This exists because a translation layer that silently falls back to English
 * looks identical to one that works, right up until a customer in São Paulo
 * opens it.
 */

import './load-env.mjs';

const WEB = argValue('--web') ?? process.env.PUBLIC_URL ?? 'http://localhost:3000';
const API = argValue('--api') ?? process.env.API_URL ?? 'http://localhost:4000';

let pass = 0;
let fail = 0;
const failures = [];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    process.stdout.write(`  \x1b[32mok\x1b[0m   ${name}\n`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

/**
 * A distinctive phrase per locale, chosen to be unambiguous: a word that could
 * not plausibly appear in any of the other translations or in English.
 */
const MARKERS = {
  en: 'This credential is valid',
  es: 'Esta credencial es válida',
  fr: 'Cette attestation est valide',
  pt: 'Esta credencial é válida',
  hi: 'यह प्रमाणपत्र वैध है',
  ar: 'هذه الشهادة صالحة',
};

const ACCEPT_LANGUAGE = {
  en: 'en-US,en;q=0.9',
  es: 'es-ES,es;q=0.9,en;q=0.5',
  fr: 'fr-FR,fr;q=0.9,en;q=0.5',
  pt: 'pt-BR,pt;q=0.9,en;q=0.5',
  hi: 'hi-IN,hi;q=0.9,en;q=0.5',
  ar: 'ar-EG,ar;q=0.9,en;q=0.5',
};

async function findValidCredential() {
  // Issue one so the test does not depend on seeded data being present.
  const stamp = Date.now();
  const register = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationName: `Localisation ${stamp}`,
      name: 'Localisation Runner',
      email: `l10n-${stamp}@localisation.invalid`,
      password: 'localisation-password-long-enough',
    }),
  }).then((r) => r.json());

  const auth = {
    authorization: `Bearer ${register.accessToken}`,
    'content-type': 'application/json',
  };

  const templates = await fetch(`${API}/v1/templates`, { headers: auth }).then((r) => r.json());
  const template = templates.find((t) => t.kind === 'certificate') ?? templates[0];

  const issued = await fetch(`${API}/v1/credentials`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      templateId: template.id,
      // A name in a non-Latin script, so the page is exercised with the kind of
      // content that breaks font stacks rather than with "Test User".
      recipient: { name: 'أحمد بن سالم', email: `l10n-${stamp}@localisation.invalid` },
      title: 'Advanced Data Engineering',
      data: { course: 'Advanced Data Engineering', grade: 'Distinction' },
      suppressEmail: true,
    }),
  }).then((r) => r.json());

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${API}/v1/public/credentials/${issued.publicId}`);
    if (response.ok) return issued.publicId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('the credential never finished issuing — is the worker running?');
}

async function main() {
  process.stdout.write(`OpenCred localisation check\n  web: ${WEB}\n  api: ${API}\n\n`);

  const publicId = await findValidCredential();
  process.stdout.write(`Using credential ${publicId}\n\n`);

  // --- Accept-Language negotiation -----------------------------------------
  process.stdout.write('Accept-Language negotiation\n');

  for (const [locale, marker] of Object.entries(MARKERS)) {
    const response = await fetch(`${WEB}/v/${publicId}`, {
      headers: { 'accept-language': ACCEPT_LANGUAGE[locale] },
    });
    const html = await response.text();

    check(
      `${locale}: page renders`,
      response.ok,
      response.ok ? undefined : `status ${response.status}`,
    );
    check(`${locale}: translated headline present`, html.includes(marker));
    check(`${locale}: lang attribute set`, html.includes(`lang="${locale}"`));
  }

  // --- Explicit override ----------------------------------------------------
  process.stdout.write('\nExplicit ?lang= override\n');

  const overridden = await fetch(`${WEB}/v/${publicId}?lang=hi`, {
    // A browser asking for French must still get Hindi when the link says so.
    headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
  }).then((r) => r.text());

  check('?lang= beats Accept-Language', overridden.includes(MARKERS.hi));
  check('French is not rendered when overridden', !overridden.includes(MARKERS.fr));

  const unknown = await fetch(`${WEB}/v/${publicId}?lang=klingon`, {
    headers: { 'accept-language': 'en-US' },
  }).then((r) => r.text());
  check('an unknown ?lang= falls back rather than erroring', unknown.includes(MARKERS.en));

  // --- Right to left (FR-DES-07) -------------------------------------------
  process.stdout.write('\nRight-to-left\n');

  const arabic = await fetch(`${WEB}/v/${publicId}?lang=ar`).then((r) => r.text());
  check('Arabic sets dir="rtl"', arabic.includes('dir="rtl"'));
  check('Arabic renders Arabic script', /[؀-ۿ]/.test(arabic));
  check(
    'the credential identifier stays LTR inside RTL text',
    arabic.includes('dir="ltr"'),
    'an ASCII identifier reorders visually in an RTL paragraph without this',
  );

  const english = await fetch(`${WEB}/v/${publicId}?lang=en`).then((r) => r.text());
  check('English does not set rtl', !english.includes('dir="rtl"'));

  // --- Dates ----------------------------------------------------------------
  process.stdout.write('\nDates\n');

  // Formatted per locale but always UTC, so the same credential never appears
  // to have been issued on two different days.
  const spanish = await fetch(`${WEB}/v/${publicId}?lang=es`).then((r) => r.text());
  check(
    'dates are localised, not left in English',
    /\bde\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.test(
      spanish,
    ),
  );

  // --- Untranslated content is still shown ---------------------------------
  process.stdout.write('\nIssuer content\n');
  check(
    'the credential title is not machine-translated',
    arabic.includes('Advanced Data Engineering'),
    "issuer-supplied content must render verbatim — we localise our interface, not somebody's credential",
  );

  process.stdout.write(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }
  process.stdout.write(`${'='.repeat(60)}\n`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`localisation check failed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
