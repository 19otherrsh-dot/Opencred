#!/usr/bin/env node
/**
 * Accessibility inspection of the recipient-facing surfaces (§9.4).
 *
 *   node scripts/check-accessibility.mjs [--web http://localhost:3000]
 *
 * BE CLEAR ABOUT WHAT THIS IS. It inspects the rendered HTML for structural
 * WCAG 2.1 AA properties that can be checked statically: landmarks, heading
 * order, labelled controls, alt text, language and direction, focus targets.
 *
 * It is NOT an accessibility audit and it is NOT Lighthouse. It cannot judge
 * colour contrast in context, keyboard traps, screen-reader announcement order,
 * or whether the page makes sense to someone using it. Those need a real audit
 * with real assistive technology, and §9.4's "meets WCAG 2.1 AA" claim is not
 * earned until that happens.
 *
 * What this does buy: the structural regressions — a heading level skipped, an
 * input that lost its label, an image that lost its alt — get caught in CI
 * rather than by a user.
 */

import './load-env.mjs';

const WEB = argValue('--web') ?? process.env.PUBLIC_URL ?? 'http://localhost:3000';
const API = argValue('--api') ?? process.env.API_URL ?? 'http://localhost:4000';

let pass = 0;
let fail = 0;
const failures = [];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function check(page, name, condition, detail) {
  if (condition) {
    pass += 1;
    process.stdout.write(`  \x1b[32mok\x1b[0m   ${name}\n`);
  } else {
    fail += 1;
    failures.push(`${page}: ${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

/** Heading levels must not skip: h1 → h3 leaves a screen-reader user guessing. */
function headingOrderIsSane(html) {
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  if (levels.length === 0) return { ok: false, detail: 'no headings at all' };
  if (levels[0] !== 1) return { ok: false, detail: `first heading is h${levels[0]}, not h1` };

  const h1Count = levels.filter((l) => l === 1).length;
  if (h1Count !== 1) return { ok: false, detail: `${h1Count} h1 elements; expected exactly one` };

  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      return { ok: false, detail: `h${levels[i - 1]} followed by h${levels[i]}` };
    }
  }
  return { ok: true, detail: `${levels.length} headings, order ${levels.join('→')}` };
}

/** Every <img> needs alt. An empty alt is legal (decorative); a missing one is not. */
function imagesHaveAlt(html) {
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const missing = imgs.filter((tag) => !/\balt\s*=/.test(tag));
  return { ok: missing.length === 0, detail: `${imgs.length} images, ${missing.length} without alt` };
}

/** Inputs need a label, an aria-label, or an aria-labelledby. */
function inputsAreLabelled(html) {
  const inputs = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
  const relevant = inputs.filter((tag) => !/type\s*=\s*["'](hidden|submit|button)["']/.test(tag));

  const labelledIds = new Set(
    [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
  );

  const unlabelled = relevant.filter((tag) => {
    if (/aria-label(ledby)?\s*=/.test(tag)) return false;
    const id = tag.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1];
    return !(id && labelledIds.has(id));
  });

  return {
    ok: unlabelled.length === 0,
    detail: `${relevant.length} controls, ${unlabelled.length} unlabelled`,
  };
}

/**
 * Media-query checks read the stylesheet, not the HTML.
 *
 * An earlier version of this script grepped the page markup for
 * `prefers-reduced-motion`, which is never there — the rules live in the linked
 * stylesheet. It reported a false failure on every page, and `prefers-color-scheme`
 * passed only by accident, because the theme-color meta tag happens to contain it.
 */
async function fetchStylesheet(html, baseUrl) {
  const href = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
  if (!href) return null;
  const url = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

async function inspect(label, url, options = {}) {
  process.stdout.write(`\n${label}\n`);
  const response = await fetch(url, { headers: options.headers ?? {} });
  const html = await response.text();

  check(
    label,
    'page responds successfully',
    response.status === (options.expectStatus ?? 200),
    `got ${response.status}`,
  );

  check(label, 'declares a language', /<html[^>]*\blang\s*=/.test(html));
  check(label, 'has a main landmark', /<main\b/.test(html));
  check(
    label,
    'main landmark is targetable by the skip link',
    /<main[^>]*\bid\s*=\s*["']main["']/.test(html),
  );
  check(label, 'provides a skip link', /class="skip-link"|Skip to main content/.test(html));

  const headings = headingOrderIsSane(html);
  check(label, 'heading levels do not skip', headings.ok, headings.detail);

  const images = imagesHaveAlt(html);
  check(label, 'every image has an alt attribute', images.ok, images.detail);

  const inputs = inputsAreLabelled(html);
  check(label, 'every form control is labelled', inputs.ok, inputs.detail);

  // Only meaningful on pages that actually display a verification outcome; a
  // form with nothing to report has no status to announce.
  if (options.hasStatus) {
    check(
      label,
      'the verification outcome is announced',
      /role="status"|role="alert"|aria-live=/.test(html),
      'a result that is not announced is invisible to a screen reader',
    );

    check(
      label,
      'decorative glyphs are hidden from assistive technology',
      /aria-hidden="true"/.test(html),
      'tick and cross marks must not be read out as punctuation',
    );
  }

  const css = await fetchStylesheet(html, url);
  check(label, 'a stylesheet is linked', css !== null);

  if (css) {
    check(label, 'respects reduced-motion preferences', css.includes('prefers-reduced-motion'));
    check(
      label,
      'supports dark mode rather than forcing a light page',
      css.includes('prefers-color-scheme'),
    );
    check(
      label,
      'uses logical properties so RTL mirrors correctly',
      /margin-inline|padding-inline|inset-inline|border-inline/.test(css),
    );
    check(
      label,
      'provides a visible focus indicator',
      css.includes(':focus-visible'),
      'keyboard users navigate by it',
    );
  }

  return html;
}

async function main() {
  process.stdout.write(`OpenCred accessibility inspection\n  web: ${WEB}\n`);
  process.stdout.write(
    '\x1b[2mStructural checks only. Not a substitute for an audit with assistive technology.\x1b[0m\n',
  );

  // A real credential, so the verification page is inspected with real content.
  const stamp = Date.now();
  const register = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationName: `A11y ${stamp}`,
      name: 'A11y Runner',
      email: `a11y-${stamp}@a11y.invalid`,
      password: 'a11y-password-long-enough',
    }),
  }).then((r) => r.json());

  const auth = { authorization: `Bearer ${register.accessToken}`, 'content-type': 'application/json' };
  const templates = await fetch(`${API}/v1/templates`, { headers: auth }).then((r) => r.json());
  const template = templates.find((t) => t.kind === 'certificate') ?? templates[0];

  const issued = await fetch(`${API}/v1/credentials`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      templateId: template.id,
      recipient: { name: 'Accessibility Auditee', email: `a11y-r-${stamp}@a11y.invalid` },
      title: 'Accessibility Audit',
      data: { course: 'Auditing', grade: 'Pass' },
      suppressEmail: true,
    }),
  }).then((r) => r.json());

  for (let i = 0; i < 60; i += 1) {
    const r = await fetch(`${API}/v1/public/credentials/${issued.publicId}`);
    if (r.ok) break;
    await new Promise((res) => setTimeout(res, 500));
  }

  await inspect('Verification page', `${WEB}/v/${issued.publicId}`, { hasStatus: true });
  await inspect('Verification page (Arabic, RTL)', `${WEB}/v/${issued.publicId}?lang=ar`, {
    hasStatus: true,
  });
  await inspect('Credential not found', `${WEB}/v/doesnotexist9`, { hasStatus: true });
  await inspect('Recipient wallet', `${WEB}/wallet`);
  await inspect('Verify a credential', `${WEB}/verify`);
  await inspect('Site 404', `${WEB}/no-such-page`, { expectStatus: 404 });

  process.stdout.write(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
  }
  process.stdout.write(`${'='.repeat(64)}\n`);
  process.stdout.write(
    '\nStill unverified: colour contrast in context, keyboard navigation, screen-reader\n' +
      'announcement order, and the Lighthouse 90+ target in FR-DEL-04.\n',
  );

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`accessibility inspection failed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
