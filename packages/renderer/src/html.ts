import {
  elementIsVisible,
  renderMergeString,
  type BrandKit,
  type MergeContext,
  type TemplateDocument,
  type TemplateElement,
} from '@opencred/schema';
import { fontFaceCss, fontStack } from './fonts';

/**
 * Template document -> HTML.
 *
 * This module is the single layout authority for the whole product. The design
 * studio renders a live preview from it and the render worker feeds the exact
 * same markup to headless Chromium for the PDF. There is no second layout
 * implementation to drift out of sync, which is the failure mode of a
 * canvas-based editor paired with a separate print path: the editor shows one
 * thing, the recipient receives another, and nobody can reproduce the report.
 *
 * It is dependency-free and DOM-free so it runs identically in Node and in the
 * browser.
 */

export interface RenderAssets {
  /** Pre-rendered QR SVG markup, keyed by element id. See `qr.ts`. */
  qr?: Record<string, string>;
  /** Resolves `opencred://asset/<id>` references to a fetchable URL. */
  resolveAsset?: (ref: string) => string;
  brandKit?: BrandKit | null;
}

export interface BuildHtmlOptions extends RenderAssets {
  /** Adds editor-only affordances (safe-area guides). Never used for output. */
  editorGuides?: boolean;
  /** Emit a full HTML document rather than just the canvas fragment. */
  fullDocument?: boolean;
  /** Scale factor applied to the whole canvas; used for thumbnails. */
  scale?: number;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Template content is issuer-supplied and merge values are recipient-supplied,
 * and both end up inside a page we then execute in a browser. Everything that
 * crosses into markup goes through here — a name containing `<script>` must
 * render as text on the certificate, not run.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** CSS values are a separate injection surface from HTML text. */
function cssValue(value: string): string {
  return value.replace(/[<>"'();{}\\]/g, '');
}

function escapeUrl(value: string, resolve?: (ref: string) => string): string {
  const resolved = value.startsWith('opencred://') && resolve ? resolve(value) : value;
  // `url()` breaks out on unescaped quotes and parentheses.
  return resolved.replace(/["'()\\\s]/g, (c) => encodeURIComponent(c));
}

function num(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

function baseStyle(el: TemplateElement, scale: number): string {
  const parts = [
    'position:absolute',
    `left:${num(el.x * scale)}px`,
    `top:${num(el.y * scale)}px`,
    `width:${num(el.width * scale)}px`,
    `height:${num(el.height * scale)}px`,
  ];
  if (el.rotation) parts.push(`transform:rotate(${num(el.rotation)}deg)`, 'transform-origin:center');
  if (el.opacity !== 1) parts.push(`opacity:${num(el.opacity)}`);
  return parts.join(';');
}

function resolveBrandColor(ref: string | undefined, kit: BrandKit | null | undefined, fallback: string): string {
  if (!ref || !kit) return fallback;
  const palette = kit.palette as Record<string, string> | undefined;
  return (palette && palette[ref]) || fallback;
}

function resolveBrandImage(ref: string | undefined, kit: BrandKit | null | undefined): string | null {
  if (!ref || !kit) return null;
  const value = (kit as unknown as Record<string, string | null>)[ref];
  return value ?? null;
}

const FLEX_ALIGN: Record<string, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

function renderText(el: Extract<TemplateElement, { type: 'text' }>, ctx: MergeContext, scale: number): string {
  const content = renderMergeString(el.content, ctx);
  const style = [
    baseStyle(el, scale),
    'display:flex',
    'box-sizing:border-box',
    `align-items:${FLEX_ALIGN[el.verticalAlign] ?? 'center'}`,
    `justify-content:${el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'}`,
    `font-family:${fontStack(el.fontFamily)}`,
    `font-size:${num(el.fontSize * scale)}px`,
    `font-weight:${el.fontWeight}`,
    `font-style:${el.fontStyle}`,
    `color:${cssValue(el.color)}`,
    `text-align:${el.align}`,
    `line-height:${num(el.lineHeight)}`,
    `letter-spacing:${num(el.letterSpacing * scale)}px`,
    `text-transform:${el.textTransform}`,
    `text-decoration:${el.textDecoration}`,
    'overflow:hidden',
    'white-space:pre-wrap',
    'word-break:break-word',
  ].join(';');

  const autofit = el.autoFit
    ? ` data-autofit="1" data-min-size="${num(el.minFontSize * scale)}" data-max-size="${num(el.fontSize * scale)}"`
    : '';

  return `<div class="oc-el oc-text" data-id="${escapeHtml(el.id)}" style="${style}"${autofit}><span>${escapeHtml(content)}</span></div>`;
}

function renderImage(
  el: Extract<TemplateElement, { type: 'image' }>,
  ctx: MergeContext,
  opts: BuildHtmlOptions,
  scale: number,
): string {
  const brandSrc = resolveBrandImage(el.brandRef, opts.brandKit);
  const src = brandSrc ?? renderMergeString(el.src, ctx);
  if (!src) return '';
  const style = [
    baseStyle(el, scale),
    `background-image:url("${escapeUrl(src, opts.resolveAsset)}")`,
    `background-size:${el.fit === 'fill' ? '100% 100%' : el.fit}`,
    'background-position:center',
    'background-repeat:no-repeat',
    el.borderRadius ? `border-radius:${num(el.borderRadius * scale)}px` : '',
    el.borderRadius ? 'overflow:hidden' : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<div class="oc-el oc-image" data-id="${escapeHtml(el.id)}" style="${style}"></div>`;
}

function renderShape(
  el: Extract<TemplateElement, { type: 'shape' }>,
  opts: BuildHtmlOptions,
  scale: number,
): string {
  const fill = el.brandRef ? resolveBrandColor(el.brandRef, opts.brandKit, el.fill) : el.fill;
  const parts = [baseStyle(el, scale), 'box-sizing:border-box'];

  if (el.shape === 'line') {
    // A line is a zero-height rule: give it the stroke as a background so that
    // rotation behaves the way a designer expects.
    parts.push(
      `background:${cssValue(el.stroke)}`,
      `height:${num(Math.max(el.strokeWidth, 1) * scale)}px`,
    );
  } else {
    parts.push(`background:${cssValue(fill)}`);
    if (el.strokeWidth > 0) {
      parts.push(`border:${num(el.strokeWidth * scale)}px ${el.strokeStyle} ${cssValue(el.stroke)}`);
    }
    if (el.shape === 'ellipse') parts.push('border-radius:50%');
    else if (el.borderRadius) parts.push(`border-radius:${num(el.borderRadius * scale)}px`);
  }

  return `<div class="oc-el oc-shape" data-id="${escapeHtml(el.id)}" style="${parts.join(';')}"></div>`;
}

function renderQr(
  el: Extract<TemplateElement, { type: 'qr' }>,
  opts: BuildHtmlOptions,
  scale: number,
): string {
  const svg = opts.qr?.[el.id];
  const style = [baseStyle(el, scale), `background:${cssValue(el.background)}`].join(';');
  if (!svg) {
    // No QR asset supplied (editor preview before resolution): draw the
    // placeholder rather than an empty hole, so the layout still reads.
    return `<div class="oc-el oc-qr oc-qr-placeholder" data-id="${escapeHtml(el.id)}" style="${style};border:1px dashed #9ca3af"></div>`;
  }
  return `<div class="oc-el oc-qr" data-id="${escapeHtml(el.id)}" style="${style}">${svg}</div>`;
}

function renderSignature(
  el: Extract<TemplateElement, { type: 'signature' }>,
  ctx: MergeContext,
  opts: BuildHtmlOptions,
  scale: number,
): string {
  const fromKit = el.signatureRef
    ? opts.brandKit?.signatures.find((s) => s.id === el.signatureRef)
    : undefined;
  const image = fromKit?.image ?? el.src;
  const name = renderMergeString(fromKit?.name || el.name, ctx);
  const title = renderMergeString(fromKit?.title || el.title, ctx);

  const labelFont = `font-family:${fontStack(el.fontFamily)};font-size:${num(el.fontSize * scale)}px;color:${cssValue(el.color)}`;
  const imageHeight = Math.max(el.height * scale - (name || title ? el.fontSize * scale * 2.4 : 0), 0);

  const parts: string[] = [];
  if (image) {
    parts.push(
      `<div style="height:${num(imageHeight)}px;background-image:url(&quot;${escapeUrl(image, opts.resolveAsset)}&quot;);background-size:contain;background-position:bottom center;background-repeat:no-repeat"></div>`,
    );
  }
  if (el.showRule) {
    parts.push(`<div style="border-top:1px solid ${cssValue(el.color)};margin:${num(4 * scale)}px 0"></div>`);
  }
  if (name) parts.push(`<div style="${labelFont};font-weight:600">${escapeHtml(name)}</div>`);
  if (title) parts.push(`<div style="${labelFont};opacity:0.75">${escapeHtml(title)}</div>`);

  const style = [
    baseStyle(el, scale),
    'display:flex',
    'flex-direction:column',
    'justify-content:flex-end',
    'text-align:center',
    'box-sizing:border-box',
  ].join(';');

  return `<div class="oc-el oc-signature" data-id="${escapeHtml(el.id)}" style="${style}">${parts.join('')}</div>`;
}

export function renderElement(
  el: TemplateElement,
  ctx: MergeContext,
  opts: BuildHtmlOptions,
  scale = 1,
): string {
  if (!elementIsVisible(el, ctx)) return '';
  switch (el.type) {
    case 'text':
      return renderText(el, ctx, scale);
    case 'image':
      return renderImage(el, ctx, opts, scale);
    case 'shape':
      return renderShape(el, opts, scale);
    case 'qr':
      return renderQr(el, opts, scale);
    case 'signature':
      return renderSignature(el, ctx, opts, scale);
    default:
      return '';
  }
}

/**
 * Shrink-to-fit pass.
 *
 * Runs in the page because only the browser knows the real measured height of
 * a string in a given font. Names in a real cohort vary from "Li Wei" to forty
 * characters with diacritics; without this the long ones silently overflow
 * their box and the issuer finds out from the recipient.
 */
const AUTOFIT_SCRIPT = `
(function(){
  var nodes = document.querySelectorAll('[data-autofit="1"]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var min = parseFloat(el.getAttribute('data-min-size')) || 8;
    var size = parseFloat(el.getAttribute('data-max-size')) || parseFloat(getComputedStyle(el).fontSize);
    var span = el.firstElementChild || el;
    var guard = 0;
    while (guard++ < 200 && size > min &&
           (span.scrollHeight > el.clientHeight + 1 || span.scrollWidth > el.clientWidth + 1)) {
      size = size - Math.max(0.5, size * 0.04);
      el.style.fontSize = size + 'px';
    }
  }
  document.documentElement.setAttribute('data-oc-ready', '1');
})();
`;

export function canvasCss(doc: TemplateDocument, scale = 1): string {
  return [
    fontFaceCss(doc),
    `*{margin:0;padding:0;box-sizing:border-box}`,
    `html,body{width:${num(doc.canvas.width * scale)}px;height:${num(doc.canvas.height * scale)}px;overflow:hidden;background:#fff}`,
    `.oc-canvas{position:relative;width:${num(doc.canvas.width * scale)}px;height:${num(doc.canvas.height * scale)}px;overflow:hidden;background:${cssValue(doc.canvas.background)};direction:${doc.direction}}`,
    `.oc-el{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`,
    `.oc-qr svg{width:100%;height:100%;display:block}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The canvas fragment: a positioned root plus every visible element. */
export function buildCanvasHtml(
  doc: TemplateDocument,
  ctx: MergeContext,
  opts: BuildHtmlOptions = {},
): string {
  const scale = opts.scale ?? 1;
  const bg = doc.canvas.backgroundImage
    ? `<div class="oc-bg" style="position:absolute;inset:0;background-image:url(&quot;${escapeUrl(doc.canvas.backgroundImage, opts.resolveAsset)}&quot;);background-size:${doc.canvas.backgroundFit === 'fill' ? '100% 100%' : doc.canvas.backgroundFit};background-position:center;background-repeat:no-repeat"></div>`
    : '';

  const guides =
    opts.editorGuides && doc.canvas.safeArea > 0
      ? `<div class="oc-safe" style="position:absolute;inset:${num(doc.canvas.safeArea * scale)}px;border:1px dashed rgba(148,163,184,0.8);pointer-events:none"></div>`
      : '';

  // Painter's order is array order, so the layer panel in the editor maps
  // one-to-one onto the array and "bring to front" is a splice.
  const elements = doc.elements.map((el) => renderElement(el, ctx, opts, scale)).join('');

  return `<div class="oc-canvas" dir="${doc.direction}" lang="${escapeHtml(doc.locale)}">${bg}${elements}${guides}</div>`;
}

/** A complete, standalone HTML document — what Playwright is handed. */
export function buildDocumentHtml(
  doc: TemplateDocument,
  ctx: MergeContext,
  opts: BuildHtmlOptions = {},
): string {
  const scale = opts.scale ?? 1;
  return `<!doctype html>
<html lang="${escapeHtml(doc.locale)}" dir="${doc.direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${num(doc.canvas.width * scale)}">
<style>
${canvasCss(doc, scale)}
@page{size:${num(doc.canvas.width * scale)}px ${num(doc.canvas.height * scale)}px;margin:0}
</style>
</head>
<body>
${buildCanvasHtml(doc, ctx, opts)}
<script>${AUTOFIT_SCRIPT}</script>
</body>
</html>`;
}
