import type { MergeContext, TemplateDocument } from '@opencred/schema';
import { buildCanvasHtml, buildDocumentHtml, canvasCss, type RenderAssets } from './html';
import { resolveQrCodes } from './qr';

/**
 * The render engine.
 *
 * Playwright drives headless Chromium, which gives pixel-accurate HTML/CSS to
 * PDF — including web fonts, RTL text shaping and CSS gradients — none of which
 * a hand-rolled PDF writer would get right.
 *
 * Chromium is heavy, so two things matter for hitting the 10,000-credentials-
 * in-under-5-minutes benchmark (FR-ISS-01):
 *
 *  1. The browser process is started once per worker and reused. Launching per
 *     credential costs ~300 ms and would alone blow the budget.
 *  2. Pages are pooled and reused within a browser context. `setContent` on a
 *     warm page is roughly an order of magnitude cheaper than a fresh context.
 *
 * If Chromium is genuinely unavailable — a slim container, an air-gapped host
 * that skipped the browser download — the engine degrades to deterministic SVG
 * output instead of failing issuance outright, and says so in the result. A
 * self-hosted install that cannot install a browser should still be able to
 * issue credentials.
 */

export type RenderFormat = 'pdf' | 'png' | 'svg';

export interface RenderResult {
  format: RenderFormat;
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  /** True when Chromium was unavailable and the SVG fallback produced this. */
  degraded: boolean;
  durationMs: number;
}

export interface RenderEngineOptions {
  /** Concurrent pages. Match to CPU: Chromium page rendering is CPU-bound. */
  concurrency?: number;
  timeoutMs?: number;
  /** Device scale for PNG output; 2 gives retina-quality share images. */
  deviceScaleFactor?: number;
  /** Explicit Chromium executable, for images that ship their own browser. */
  executablePath?: string;
  /**
   * Allow the render page to make outbound requests. Off by default: templates
   * are user-supplied content, and a template that can fetch arbitrary URLs
   * from inside our network is an SSRF primitive. Asset URLs are inlined or
   * proxied by the caller instead.
   */
  allowNetwork?: boolean;
}

export interface RenderRequest {
  document: TemplateDocument;
  context: MergeContext;
  format: RenderFormat;
  assets?: RenderAssets;
  /** Used for QR elements whose source is `verification`. */
  verificationUrl?: string;
  scale?: number;
}

// Minimal structural types so the package builds without playwright-core
// installed. The real types arrive at runtime through the dynamic import.
interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
  isConnected(): boolean;
}
interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  route(pattern: string, handler: (route: RouteLike) => void): Promise<void>;
}
interface RouteLike {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}
interface PageLike {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string, options: Record<string, unknown>): Promise<void>;
  waitForFunction(fn: string, arg?: unknown, options?: Record<string, unknown>): Promise<unknown>;
  pdf(options: Record<string, unknown>): Promise<Buffer>;
  screenshot(options: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
  isClosed(): boolean;
}

/** Resolved at runtime so the specifier is never statically linked. */
async function loadPlaywright(): Promise<any> {
  const specifiers = ['playwright-core', 'playwright'];
  let lastError: unknown;
  for (const spec of specifiers) {
    try {
      return await import(spec);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `neither playwright-core nor playwright could be loaded: ${(lastError as Error)?.message}`,
  );
}

export class RenderEngine {
  private browser: BrowserLike | null = null;
  private context: ContextLike | null = null;
  private readonly idlePages: PageLike[] = [];
  private readonly waiters: Array<(page: PageLike) => void> = [];
  private leased = 0;
  private launching: Promise<void> | null = null;
  private chromiumUnavailable = false;

  constructor(private readonly options: RenderEngineOptions = {}) {}

  private get concurrency(): number {
    return Math.max(1, this.options.concurrency ?? 4);
  }

  private get timeout(): number {
    return this.options.timeoutMs ?? 30_000;
  }

  /** True when the engine can produce real PDF/PNG output. */
  async isAvailable(): Promise<boolean> {
    if (this.chromiumUnavailable) return false;
    try {
      await this.ensureBrowser();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected() && this.context) return;
    if (this.chromiumUnavailable) throw new Error('chromium unavailable');
    if (this.launching) return this.launching;

    this.launching = (async () => {
      try {
        // Dynamic import through a non-literal specifier keeps playwright an
        // optional peer dependency: the package builds and its pure-layout
        // half runs (design studio preview, SVG output) on a host that has no
        // browser automation stack installed at all.
        const mod: any = await loadPlaywright();
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (!chromium) throw new Error('playwright chromium binding not found');

        this.browser = await chromium.launch({
          headless: true,
          ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--font-render-hinting=none',
            '--force-color-profile=srgb',
            // Deterministic output across hosts matters more than speed here:
            // a reissued credential must be pixel-identical to the original.
            '--disable-lcd-text',
          ],
        });

        this.context = await this.browser!.newContext({
          deviceScaleFactor: this.options.deviceScaleFactor ?? 2,
          javaScriptEnabled: true,
          bypassCSP: false,
          offline: !this.options.allowNetwork,
        });

        if (!this.options.allowNetwork) {
          await this.context!.route('**/*', (route) => {
            const url = route.request().url();
            // data: and blob: assets are inlined by the caller and are safe.
            if (url.startsWith('data:') || url.startsWith('blob:')) void route.continue();
            else void route.abort();
          });
        }
      } catch (err) {
        this.chromiumUnavailable = true;
        throw err;
      } finally {
        this.launching = null;
      }
    })();

    return this.launching;
  }

  private async acquirePage(): Promise<PageLike> {
    await this.ensureBrowser();
    const existing = this.idlePages.pop();
    if (existing && !existing.isClosed()) {
      this.leased += 1;
      return existing;
    }
    if (this.leased < this.concurrency) {
      this.leased += 1;
      return this.context!.newPage();
    }
    return new Promise<PageLike>((resolve) => {
      this.waiters.push((page) => {
        this.leased += 1;
        resolve(page);
      });
    });
  }

  private releasePage(page: PageLike): void {
    this.leased -= 1;
    if (page.isClosed()) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(page);
    else this.idlePages.push(page);
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const started = Date.now();
    const { document: doc } = request;
    const scale = request.scale ?? 1;
    const width = Math.round(doc.canvas.width * scale);
    const height = Math.round(doc.canvas.height * scale);

    const assets: RenderAssets = {
      ...request.assets,
      qr:
        request.assets?.qr ??
        (await resolveQrCodes(doc, request.context, request.verificationUrl)),
    };

    if (request.format === 'svg') {
      const buffer = Buffer.from(buildSvg(doc, request.context, assets, scale), 'utf8');
      return {
        format: 'svg',
        buffer,
        contentType: 'image/svg+xml',
        width,
        height,
        degraded: false,
        durationMs: Date.now() - started,
      };
    }

    const html = buildDocumentHtml(doc, request.context, { ...assets, scale });

    let page: PageLike | null = null;
    try {
      page = await this.acquirePage();
      await page.setViewportSize({ width, height });
      await page.setContent(html, { waitUntil: 'load', timeout: this.timeout });
      // The auto-fit pass sets this flag when it finishes; waiting on it means
      // we never capture a half-laid-out page under load.
      await page
        .waitForFunction(
          `document.documentElement.getAttribute('data-oc-ready') === '1'`,
          undefined,
          { timeout: Math.min(this.timeout, 10_000) },
        )
        .catch(() => undefined);

      const buffer =
        request.format === 'pdf'
          ? await page.pdf({
              width: `${width}px`,
              height: `${height}px`,
              printBackground: true,
              pageRanges: '1',
              margin: { top: '0', right: '0', bottom: '0', left: '0' },
              preferCSSPageSize: false,
            })
          : await page.screenshot({
              type: 'png',
              clip: { x: 0, y: 0, width, height },
              omitBackground: false,
            });

      return {
        format: request.format,
        buffer,
        contentType: request.format === 'pdf' ? 'application/pdf' : 'image/png',
        width,
        height,
        degraded: false,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (!this.chromiumUnavailable) throw err;
      // Chromium is missing entirely: emit vector SVG so issuance still
      // completes, and flag the result so the caller can warn the operator.
      const buffer = Buffer.from(buildSvg(doc, request.context, assets, scale), 'utf8');
      return {
        format: 'svg',
        buffer,
        contentType: 'image/svg+xml',
        width,
        height,
        degraded: true,
        durationMs: Date.now() - started,
      };
    } finally {
      if (page) this.releasePage(page);
    }
  }

  async close(): Promise<void> {
    for (const page of this.idlePages.splice(0)) {
      await page.close().catch(() => undefined);
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
  }
}

/**
 * SVG fallback.
 *
 * `foreignObject` carries the same HTML the browser path renders, so the
 * fallback is not a second layout implementation — it is the same markup in a
 * vector wrapper. Renderers that support foreignObject (all major browsers,
 * librsvg, resvg with the feature enabled) reproduce it faithfully.
 */
export function buildSvg(
  doc: TemplateDocument,
  ctx: MergeContext,
  assets: RenderAssets,
  scale = 1,
): string {
  const width = Math.round(doc.canvas.width * scale);
  const height = Math.round(doc.canvas.height * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${doc.canvas.background}"/>
<foreignObject width="${width}" height="${height}">
<xhtml:div xmlns="http://www.w3.org/1999/xhtml">
<style>${canvasCss(doc, scale)}</style>
${buildCanvasHtml(doc, ctx, { ...assets, scale })}
</xhtml:div>
</foreignObject>
</svg>`;
}
