import QRCode from 'qrcode';
import { renderMergeString, type MergeContext, type TemplateDocument } from '@opencred/schema';

/**
 * FR-VER-01 — every credential carries a QR code that resolves to its public
 * verification page.
 *
 * QR codes are emitted as SVG rather than raster. A certificate is routinely
 * printed at A4 and scanned from paper under bad lighting; a 200 px PNG scaled
 * up to 5 cm is the difference between a code that scans first time and one an
 * employer gives up on.
 */

export interface QrRenderOptions {
  foreground?: string;
  background?: string;
  margin?: number;
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
}

export async function renderQrSvg(value: string, options: QrRenderOptions = {}): Promise<string> {
  const svg = await QRCode.toString(value, {
    type: 'svg',
    margin: options.margin ?? 1,
    // 'M' recovers ~15% damage, which is the right trade for a printed page.
    // 'H' is offered for templates that overlay a logo on the code.
    errorCorrectionLevel: options.errorCorrection ?? 'M',
    color: {
      dark: options.foreground ?? '#111827',
      light: options.background ?? '#ffffff',
    },
  });
  // The library emits fixed width/height attributes; strip them so the SVG
  // scales to whatever box the template gives it.
  return svg.replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, '<svg$1 preserveAspectRatio="xMidYMid meet"');
}

/**
 * Resolve every QR element in a template for one recipient row.
 *
 * Returned keyed by element id and handed to `buildDocumentHtml`, which keeps
 * the HTML builder synchronous and usable in the browser preview.
 */
export async function resolveQrCodes(
  doc: TemplateDocument,
  ctx: MergeContext,
  fallbackUrl?: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const el of doc.elements) {
    if (el.type !== 'qr' || el.hidden) continue;
    const value =
      el.source === 'custom' && el.value
        ? renderMergeString(el.value, ctx)
        : String(ctx['credential.verification_url'] ?? fallbackUrl ?? '');
    if (!value) continue;
    out[el.id] = await renderQrSvg(value, {
      foreground: el.foreground,
      background: el.background,
      margin: el.margin,
      errorCorrection: el.errorCorrection,
    });
  }
  return out;
}

/** Standalone QR PNG data URI, for the delivery email and recipient portal. */
export async function renderQrDataUrl(value: string, size = 512): Promise<string> {
  return QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' });
}
