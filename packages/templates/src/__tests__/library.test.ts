import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMergeTokens, requiredDataFields, SYSTEM_MERGE_FIELDS } from '@opencred/schema';
import { buildCanvasHtml, sampleMergeContext } from '@opencred/renderer';
import { getTemplate, listTemplates, searchTemplates, templateCategories } from '../index';

test('the library ships at least the 150 starter templates FR-DES-03 requires', () => {
  assert.ok(listTemplates().length >= 150, `only ${listTemplates().length} templates generated`);
});

test('slugs are unique', () => {
  const slugs = listTemplates().map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('the library covers both certificates and badges, and all three orientations', () => {
  const index = listTemplates();
  assert.ok(index.some((t) => t.kind === 'certificate'));
  assert.ok(index.some((t) => t.kind === 'badge'));
  for (const orientation of ['landscape', 'portrait', 'square'] as const) {
    assert.ok(index.some((t) => t.orientation === orientation), `missing ${orientation}`);
  }
  assert.ok(templateCategories().length >= 4);
});

test('every template carries a QR element and a public credential id', () => {
  for (const entry of listTemplates()) {
    const doc = getTemplate(entry.slug).document;
    assert.ok(
      doc.elements.some((el) => el.type === 'qr'),
      `${entry.slug} has no QR element`,
    );
    const tokens = collectMergeTokens(doc);
    assert.ok(
      tokens.includes('credential.public_id') || tokens.includes('credential.verification_url'),
      `${entry.slug} shows no verification reference`,
    );
  }
});

test('every template declares every non-system merge field it uses', () => {
  const system = new Set<string>(SYSTEM_MERGE_FIELDS);
  for (const entry of listTemplates()) {
    const doc = getTemplate(entry.slug).document;
    const declared = new Set(doc.fields.map((f) => f.key));
    for (const token of requiredDataFields(doc)) {
      assert.ok(
        system.has(token) || declared.has(token),
        `${entry.slug} uses undeclared field "${token}"`,
      );
    }
  }
});

test('every template stays inside its canvas bounds', () => {
  for (const entry of listTemplates()) {
    const doc = getTemplate(entry.slug).document;
    for (const el of doc.elements) {
      // Rotated decorative shapes are allowed to bleed off-canvas on purpose.
      if (el.rotation) continue;
      assert.ok(el.x >= -1, `${entry.slug}/${el.id} starts left of the canvas`);
      assert.ok(el.y >= -1, `${entry.slug}/${el.id} starts above the canvas`);
      assert.ok(
        el.x + el.width <= doc.canvas.width + 1,
        `${entry.slug}/${el.id} overflows the right edge`,
      );
      assert.ok(
        el.y + el.height <= doc.canvas.height + 1,
        `${entry.slug}/${el.id} overflows the bottom edge`,
      );
    }
  }
});

test('the recipient name is the largest text on every certificate', () => {
  for (const entry of listTemplates().filter((t) => t.kind === 'certificate')) {
    const doc = getTemplate(entry.slug).document;
    const texts = doc.elements.filter((el) => el.type === 'text') as Array<{
      content: string;
      fontSize: number;
      id: string;
    }>;
    const nameEl = texts.find((t) => t.content.includes('{{recipient.name}}'));
    assert.ok(nameEl, `${entry.slug} never renders the recipient name`);
    const largest = texts.reduce((a, b) => (b.fontSize > a.fontSize ? b : a));
    assert.equal(largest.id, nameEl!.id, `${entry.slug}: "${largest.content}" outsizes the name`);
  }
});

test('every template renders to markup with no unresolved tokens', () => {
  for (const entry of listTemplates()) {
    const doc = getTemplate(entry.slug).document;
    const html = buildCanvasHtml(doc, sampleMergeContext({ level: 'Professional' }));
    assert.doesNotMatch(html, /\{\{/, `${entry.slug} left an unresolved merge token`);
    assert.match(html, /Priya Raman/, `${entry.slug} did not render the recipient name`);
  }
});

test('the library ships right-to-left templates (FR-DES-07)', () => {
  const rtl = listTemplates().filter((entry) => getTemplate(entry.slug).document.direction === 'rtl');
  assert.ok(rtl.length > 0, 'no RTL template ships, so the RTL path is never exercised');

  for (const entry of rtl) {
    const doc = getTemplate(entry.slug).document;
    assert.equal(doc.locale, 'ar', `${entry.slug} is rtl but not tagged with an RTL locale`);

    // The identifier must stay Latin and left-aligned: an ASCII token inside an
    // RTL paragraph reorders visually and gets transcribed wrong.
    const idElement = doc.elements.find(
      (el) => el.type === 'text' && el.content.includes('{{credential.public_id}}'),
    ) as { align?: string } | undefined;
    assert.ok(idElement, `${entry.slug} does not show the credential identifier`);
    assert.equal(
      idElement?.align,
      'left',
      `${entry.slug} right-aligns the credential ID, which reorders it visually`,
    );
  }
});

test('RTL templates render with the direction set on the canvas root', () => {
  const rtl = listTemplates().filter((entry) => getTemplate(entry.slug).document.direction === 'rtl');
  for (const entry of rtl.slice(0, 3)) {
    const html = buildCanvasHtml(getTemplate(entry.slug).document, sampleMergeContext());
    assert.match(html, /dir="rtl"/, `${entry.slug} did not emit dir="rtl"`);
    assert.match(html, /lang="ar"/, `${entry.slug} did not emit lang="ar"`);
  }
});

test('search filters by kind, category and free text', () => {
  assert.ok(searchTemplates({ kind: 'badge' }).every((t) => t.kind === 'badge'));
  assert.ok(searchTemplates({ q: 'oxford' }).length >= 1);
  assert.equal(searchTemplates({ q: 'no-such-template-anywhere' }).length, 0);
});

test('unknown or unsafe slugs are rejected rather than read from disk', () => {
  assert.throws(() => getTemplate('../../../etc/passwd'), /invalid template slug/);
  assert.throws(() => getTemplate('does-not-exist'), /not found/);
});
