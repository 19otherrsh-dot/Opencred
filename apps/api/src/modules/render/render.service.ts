import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  RenderEngine,
  buildMergeContext,
  resolveQrCodes,
  type MergeContextInput,
  type RenderFormat,
} from '@opencred/renderer';
import {
  templateDocumentSchema,
  brandKitSchema,
  type BrandKit,
  type MergeContext,
  type TemplateDocument,
} from '@opencred/schema';
import { loadConfig } from '../../config';
import { StorageService } from '../storage/storage.service';

/**
 * Wraps the render engine with storage and asset resolution.
 *
 * One browser per process, shared by every render. See `RenderEngine` for why
 * that matters to the bulk-issuance benchmark.
 */
@Injectable()
export class RenderService implements OnModuleDestroy {
  private readonly logger = new Logger(RenderService.name);
  private readonly config = loadConfig();
  private readonly engine: RenderEngine;
  private warnedAboutDegradation = false;

  constructor(private readonly storage: StorageService) {
    this.engine = new RenderEngine({
      concurrency: this.config.RENDER_CONCURRENCY,
      timeoutMs: this.config.RENDER_TIMEOUT_MS,
      deviceScaleFactor: 2,
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.engine.isAvailable();
  }

  parseDocument(raw: unknown): TemplateDocument {
    return templateDocumentSchema.parse(raw);
  }

  parseBrandKit(raw: unknown): BrandKit {
    return brandKitSchema.parse(raw ?? {});
  }

  /**
   * Render one credential to the requested format and store the bytes.
   *
   * Assets referenced as `opencred://asset/<id>` are rewritten to data URIs
   * before the page is built. The render page runs with the network disabled
   * (see RenderEngine), so inlining is not an optimisation — it is the only
   * way an image reaches the page, and it is what keeps a template from being
   * used to make the render node fetch internal URLs.
   */
  async renderCredential(params: {
    organizationId: string;
    credentialId: string;
    document: TemplateDocument;
    context: MergeContext;
    brandKit: BrandKit;
    verificationUrl: string;
    formats: RenderFormat[];
  }): Promise<Record<string, { key: string; contentType: string; degraded: boolean }>> {
    const inlinedKit = await this.inlineBrandKit(params.brandKit);
    const document = await this.inlineDocumentAssets(params.document);
    const qr = await resolveQrCodes(document, params.context, params.verificationUrl);

    const out: Record<string, { key: string; contentType: string; degraded: boolean }> = {};

    for (const format of params.formats) {
      const result = await this.engine.render({
        document,
        context: params.context,
        format,
        verificationUrl: params.verificationUrl,
        assets: { qr, brandKit: inlinedKit },
      });

      if (result.degraded && !this.warnedAboutDegradation) {
        this.warnedAboutDegradation = true;
        this.logger.warn(
          'Chromium is unavailable, so credentials are being rendered as SVG instead of PDF/PNG. ' +
            'Install it with: npx playwright install --with-deps chromium',
        );
      }

      const extension = result.degraded ? 'svg' : format;
      const key = this.storage.credentialKey(params.organizationId, params.credentialId, extension);
      await this.storage.put(key, result.buffer, result.contentType);
      out[format] = { key, contentType: result.contentType, degraded: result.degraded };
    }

    return out;
  }

  /** Small PNG for list views and share cards. */
  async renderThumbnail(params: {
    organizationId: string;
    credentialId: string;
    document: TemplateDocument;
    context: MergeContext;
    brandKit: BrandKit;
    verificationUrl: string;
  }): Promise<string | null> {
    const document = await this.inlineDocumentAssets(params.document);
    const scale = Math.min(1, 640 / document.canvas.width);
    const result = await this.engine.render({
      document,
      context: params.context,
      format: 'png',
      verificationUrl: params.verificationUrl,
      assets: {
        qr: await resolveQrCodes(document, params.context, params.verificationUrl),
        brandKit: await this.inlineBrandKit(params.brandKit),
      },
      scale,
    });

    const key = `${this.storage.credentialKey(params.organizationId, params.credentialId, 'thumb')}.${result.degraded ? 'svg' : 'png'}`;
    await this.storage.put(key, result.buffer, result.contentType);
    return key;
  }

  /** A preview for the design studio; returns bytes rather than storing them. */
  async preview(params: {
    document: TemplateDocument;
    context: MergeContext;
    brandKit: BrandKit;
    verificationUrl: string;
    format: RenderFormat;
    scale?: number;
  }): Promise<{ buffer: Buffer; contentType: string; degraded: boolean }> {
    const document = await this.inlineDocumentAssets(params.document);
    const result = await this.engine.render({
      document,
      context: params.context,
      format: params.format,
      verificationUrl: params.verificationUrl,
      assets: {
        qr: await resolveQrCodes(document, params.context, params.verificationUrl),
        brandKit: await this.inlineBrandKit(params.brandKit),
      },
      scale: params.scale,
    });
    return { buffer: result.buffer, contentType: result.contentType, degraded: result.degraded };
  }

  buildContext(input: MergeContextInput): MergeContext {
    return buildMergeContext(input);
  }

  // --- Asset inlining -------------------------------------------------------

  private assetCache = new Map<string, string>();

  private async toDataUri(reference: string): Promise<string> {
    if (!reference.startsWith('opencred://asset/')) return reference;

    const cached = this.assetCache.get(reference);
    if (cached) return cached;

    try {
      const key = reference.slice('opencred://asset/'.length);
      const buffer = await this.storage.get(key);
      const contentType = guessContentType(key);
      const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      // Bounded so a tenant with thousands of assets cannot grow this without
      // limit inside a long-lived worker.
      if (this.assetCache.size > 200) this.assetCache.clear();
      this.assetCache.set(reference, dataUri);
      return dataUri;
    } catch (err) {
      this.logger.warn(`asset ${reference} could not be inlined: ${(err as Error).message}`);
      return '';
    }
  }

  private async inlineBrandKit(kit: BrandKit): Promise<BrandKit> {
    return {
      ...kit,
      logo: kit.logo ? await this.toDataUri(kit.logo) : null,
      logoMark: kit.logoMark ? await this.toDataUri(kit.logoMark) : null,
      watermark: kit.watermark ? await this.toDataUri(kit.watermark) : null,
      signatures: await Promise.all(
        kit.signatures.map(async (s) => ({ ...s, image: await this.toDataUri(s.image) })),
      ),
    };
  }

  private async inlineDocumentAssets(doc: TemplateDocument): Promise<TemplateDocument> {
    const needsInlining =
      doc.canvas.backgroundImage?.startsWith('opencred://') ||
      doc.elements.some(
        (el) =>
          (el.type === 'image' && el.src.startsWith('opencred://')) ||
          (el.type === 'signature' && el.src.startsWith('opencred://')),
      );
    if (!needsInlining) return doc;

    const elements = await Promise.all(
      doc.elements.map(async (el) => {
        if (el.type === 'image' && el.src.startsWith('opencred://')) {
          return { ...el, src: await this.toDataUri(el.src) };
        }
        if (el.type === 'signature' && el.src.startsWith('opencred://')) {
          return { ...el, src: await this.toDataUri(el.src) };
        }
        return el;
      }),
    );

    return {
      ...doc,
      canvas: {
        ...doc.canvas,
        ...(doc.canvas.backgroundImage?.startsWith('opencred://')
          ? { backgroundImage: await this.toDataUri(doc.canvas.backgroundImage) }
          : {}),
      },
      elements,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.engine.close();
  }
}

function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}
