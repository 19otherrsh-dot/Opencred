import test from 'node:test';
import assert from 'node:assert/strict';
import { templateDocumentSchema, renderMergeString, requiredDataFields } from '@opencred/schema';
import { buildCanvasHtml, buildDocumentHtml, escapeHtml } from '../html';
import { buildMergeContext, sampleMergeContext, splitName } from '../context';

function doc(elements: unknown[], extra: Record<string, unknown> = {}) {
  return templateDocumentSchema.parse({
    version: 1,
    kind: 'certificate',
    canvas: { width: 1123, height: 794, unit: 'px', background: '#ffffff' },
    elements,
    ...extra,
  });
}

const text = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  type: 'text',
  x: 100,
  y: 300,
  width: 900,
  height: 90,
  content: '{{recipient.name}}',
  fontSize: 48,
  ...over,
});

test('merge tokens resolve into the rendered markup', () => {
  const html = buildCanvasHtml(doc([text()]), sampleMergeContext());
  assert.match(html, /Priya Raman/);
  assert.doesNotMatch(html, /\{\{/);
});

test('recipient names are HTML-escaped, not executed', () => {
  const html = buildCanvasHtml(
    doc([text()]),
    buildMergeContext({
      recipient: { name: '<script>alert(1)</script>' },
      credential: {
        id: 'x',
        publicId: 'x',
        title: 'T',
        verificationUrl: 'https://e/v/x',
        issuedAt: '2026-01-01T00:00:00.000Z',
      },
      issuer: { name: 'Issuer' },
    }),
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a template author cannot break out of a style attribute through a colour', () => {
  const html = buildCanvasHtml(
    doc([text({ color: '#000' })]).elements.length
      ? doc([{ ...text(), color: '#000000' }])
      : doc([]),
    sampleMergeContext(),
  );
  assert.match(html, /color:#000000/);
});

test('escapeHtml covers the five significant characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('showIf hides an element when its value is empty', () => {
  const withGrade = buildCanvasHtml(
    doc([text({ id: 'grade', content: '{{grade}}', showIf: 'grade' })]),
    sampleMergeContext(),
  );
  assert.match(withGrade, /Distinction/);

  const withoutGrade = buildCanvasHtml(
    doc([text({ id: 'grade', content: '{{grade}}', showIf: 'grade' })]),
    sampleMergeContext({ grade: '' }),
  );
  assert.doesNotMatch(withoutGrade, /data-id="grade"/);
});

test('auto-fit metadata is emitted so the in-page pass can shrink long names', () => {
  const html = buildCanvasHtml(doc([text({ autoFit: true, fontSize: 48, minFontSize: 18 })]), sampleMergeContext());
  assert.match(html, /data-autofit="1"/);
  assert.match(html, /data-min-size="18"/);
  assert.match(html, /data-max-size="48"/);
});

test('QR elements render supplied SVG and fall back to a placeholder', () => {
  const qr = {
    id: 'q1',
    type: 'qr',
    x: 900,
    y: 600,
    width: 120,
    height: 120,
    source: 'verification',
  };
  const withAsset = buildCanvasHtml(doc([qr]), sampleMergeContext(), {
    qr: { q1: '<svg data-test="qr"></svg>' },
  });
  assert.match(withAsset, /data-test="qr"/);

  const withoutAsset = buildCanvasHtml(doc([qr]), sampleMergeContext());
  assert.match(withoutAsset, /oc-qr-placeholder/);
});

test('brand kit references resolve at render time rather than being copied in', () => {
  const html = buildCanvasHtml(
    doc([
      { id: 'logo', type: 'image', x: 40, y: 40, width: 200, height: 80, src: '', brandRef: 'logo' },
      { id: 'bar', type: 'shape', x: 0, y: 0, width: 1123, height: 16, shape: 'rectangle', brandRef: 'primary', fill: '#cccccc' },
    ]),
    sampleMergeContext(),
    {
      brandKit: {
        logo: 'https://cdn.example.org/logo.png',
        logoMark: null,
        watermark: null,
        palette: { primary: '#004080', secondary: '#0f172a', accent: '#b45309', surface: '#fff', text: '#111827' },
        fonts: { heading: 'Inter', body: 'Inter', accent: 'Playfair Display' },
        signatures: [],
      },
    },
  );
  assert.match(html, /cdn\.example\.org\/logo\.png/);
  assert.match(html, /background:#004080/);
});

test('RTL templates set direction on the canvas root', () => {
  const html = buildCanvasHtml(doc([text({ content: 'شهادة' })], { direction: 'rtl', locale: 'ar' }), sampleMergeContext());
  assert.match(html, /dir="rtl"/);
  assert.match(html, /lang="ar"/);
});

test('the full document sets an exact @page size for print', () => {
  const html = buildDocumentHtml(doc([text()]), sampleMergeContext());
  assert.match(html, /@page\{size:1123px 794px;margin:0\}/);
  assert.match(html, /<!doctype html>/);
});

test('requiredDataFields lists only what the CSV must supply', () => {
  const d = doc([
    text({ id: 'a', content: '{{recipient.name}}' }),
    text({ id: 'b', content: '{{course}} — {{score}}' }),
  ]);
  assert.deepEqual(requiredDataFields(d), ['course', 'score']);
});

test('merge filters format dates and case', () => {
  const ctx = sampleMergeContext();
  assert.equal(renderMergeString('{{issued_at | date:"D MMMM YYYY"}}', ctx), '1 March 2026');
  assert.equal(renderMergeString('{{recipient.name | upper}}', ctx), 'PRIYA RAMAN');
  assert.equal(renderMergeString('{{missing | default:"—"}}', ctx), '—');
  assert.equal(renderMergeString('{{score | ordinal}}', ctx), '94th');
});

test('splitName is conservative about family names', () => {
  assert.deepEqual(splitName('Priya Raman'), { first: 'Priya', last: 'Raman' });
  assert.deepEqual(splitName('Ana Maria da Silva'), { first: 'Ana Maria da', last: 'Silva' });
  assert.deepEqual(splitName('Prince'), { first: 'Prince', last: '' });
  assert.deepEqual(splitName('   '), { first: '', last: '' });
});
