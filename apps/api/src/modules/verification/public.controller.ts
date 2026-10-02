import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, type AuthenticatedRequest } from '../../common/request-context';
import { zodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../common/prisma.service';
import { normalizePublicId } from '../../common/ids';
import { StorageService } from '../storage/storage.service';
import { IssuerService } from '../issuer/issuer.service';
import { PassesService } from '../passes/passes.service';
import { VerificationService } from './verification.service';

const bulkVerifySchema = z.object({
  credentialIds: z.array(z.string().min(4).max(64)).min(1).max(1_000),
});

const verifyDocumentSchema = z.object({
  credential: z.record(z.unknown()),
  checkStatus: z.boolean().default(true),
});

/**
 * Everything on this controller is unauthenticated by design.
 *
 * A verification page that requires an account is not a verification page —
 * the employer checking a candidate has no relationship with the issuer and
 * never will. FR-VER-01 says "requiring no login", and that constraint runs all
 * the way down: the JSON, the status lists and the DID documents are public
 * too, because a verifier that cannot fetch them cannot verify.
 */
@ApiTags('Public verification')
@Public()
@Controller('v1/public')
export class PublicController {
  constructor(
    private readonly verification: VerificationService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly issuer: IssuerService,
    private readonly passes: PassesService,
  ) {}

  @Get('credentials/:publicId')
  @ApiOperation({
    summary: 'Verify a credential by its public identifier (FR-VER-03)',
    description:
      'Returns issuer, recipient, status and the individual verification checks. No authentication.',
  })
  async verify(@Param('publicId') publicId: string, @Req() req: AuthenticatedRequest) {
    return this.verification.verifyByPublicId(publicId, { request: req });
  }

  @Get('credentials/:publicId/page')
  @ApiOperation({ summary: 'Verification result plus the issuer branding for the public page' })
  async page(@Param('publicId') publicId: string, @Req() req: AuthenticatedRequest) {
    const [result, branding] = await Promise.all([
      this.verification.verifyByPublicId(publicId, { request: req }),
      this.verification.publicPageContext(publicId),
    ]);
    // Wallet availability travels with the page payload so the server-rendered
    // page can decide whether to show the buttons at all. A client-side probe
    // would mean the buttons appear a beat late, or appear and then fail.
    return { ...result, branding, wallets: this.passes.availability() };
  }

  @Get('credentials/:publicId/credential.json')
  @Header('content-type', 'application/vc+ld+json')
  // Signed documents are immutable for their lifetime; a revocation shows up
  // through the status list, not through this document changing.
  @Header('cache-control', 'public, max-age=300, stale-while-revalidate=86400')
  @ApiOperation({ summary: 'The signed Open Badges 3.0 / W3C Verifiable Credential document' })
  async credentialJson(@Param('publicId') publicId: string) {
    return this.verification.credentialDocument(publicId);
  }

  @Get('credentials/:publicId/download')
  @ApiOperation({ summary: 'Download the rendered credential (PDF, or PNG for badges)' })
  async download(
    @Param('publicId') publicId: string,
    @Query('format') format: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(publicId) },
      include: { recipient: true },
    });
    if (!credential || credential.status === 'draft') {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const wantsPng = format === 'png' || (!format && credential.kind === 'badge');
    const key = wantsPng ? credential.pngKey : credential.pdfKey;
    if (!key) {
      res.status(404).json({ error: 'not_rendered', message: 'This credential has no rendered file yet.' });
      return;
    }

    const buffer = await this.storage.get(key);
    const extension = key.split('.').pop() ?? (wantsPng ? 'png' : 'pdf');
    const safeName =
      credential.recipient.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'credential';

    await this.verification.recordEvent(publicId, 'downloaded', req, { format: extension });

    res
      .status(200)
      .setHeader(
        'content-type',
        extension === 'svg' ? 'image/svg+xml' : wantsPng ? 'image/png' : 'application/pdf',
      )
      .setHeader(
        'content-disposition',
        `attachment; filename="${safeName}-${credential.publicId}.${extension}"`,
      )
      .send(buffer);
  }

  @Get('credentials/:publicId/thumbnail')
  async thumbnail(@Param('publicId') publicId: string, @Res() res: Response): Promise<void> {
    const credential = await this.prisma.credential.findUnique({
      where: { publicId: normalizePublicId(publicId) },
      select: { thumbnailKey: true, status: true },
    });
    if (!credential?.thumbnailKey || credential.status === 'draft') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const buffer = await this.storage.get(credential.thumbnailKey);
    res
      .status(200)
      .setHeader('content-type', credential.thumbnailKey.endsWith('.svg') ? 'image/svg+xml' : 'image/png')
      .setHeader('cache-control', 'public, max-age=3600')
      .send(buffer);
  }

  // --- Wallet passes (FR-STD-04) --------------------------------------------

  @Get('credentials/:publicId/wallet')
  @ApiOperation({
    summary: 'Which wallet passes this deployment can issue',
    description:
      'Apple and Google both require the operator to enrol with the platform. A deployment ' +
      'that has not is reported as unavailable, so the page can hide the button rather than ' +
      'offer one that fails.',
  })
  wallets() {
    return this.passes.availability();
  }

  @Get('credentials/:publicId/wallet/google')
  @ApiOperation({ summary: 'Redirect to the Google Wallet save link for this credential' })
  async googleWallet(
    @Param('publicId') publicId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.passes.googleSaveUrl(publicId);
    await this.verification.recordEvent(publicId, 'wallet_added', req, { wallet: 'google' });
    // The link embeds a signed JWT with a timestamp; caching it anywhere would
    // hand a stale pass to the next recipient who taps the button.
    res.setHeader('cache-control', 'no-store').redirect(302, url);
  }

  @Get('credentials/:publicId/wallet/apple')
  @ApiOperation({ summary: 'Download the signed .pkpass for this credential' })
  async appleWallet(
    @Param('publicId') publicId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const pass = await this.passes.applePass(publicId);
    await this.verification.recordEvent(publicId, 'wallet_added', req, { wallet: 'apple' });
    res
      .status(200)
      .setHeader('content-type', 'application/vnd.apple.pkpass')
      .setHeader('content-disposition', `attachment; filename="${pass.filename}"`)
      .setHeader('cache-control', 'no-store')
      .send(pass.bundle);
  }

  @Get('credentials/:publicId/brand-logo.png')
  @ApiOperation({
    summary: "The issuer's brand logo",
    description:
      'Public because Google Wallet fetches pass images from its own servers and cannot ' +
      'present a credential of ours to do it.',
  })
  async brandLogo(@Param('publicId') publicId: string, @Res() res: Response): Promise<void> {
    const logo = await this.passes.brandLogoForCredential(publicId);
    if (!logo) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res
      .status(200)
      .setHeader('content-type', logo.contentType)
      .setHeader('cache-control', 'public, max-age=3600')
      .send(logo.buffer);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify a credential document supplied in the request',
    description:
      'Checks the signature, the issuer DID and the status list without consulting our database. ' +
      'Works for credentials issued by any conformant issuer, not only OpenCred.',
  })
  async verifyDocument(
    @Body(zodPipe(verifyDocumentSchema)) dto: { credential: Record<string, unknown>; checkStatus: boolean },
  ) {
    return this.verification.verifyDocumentPayload(dto.credential as never, {
      checkStatus: dto.checkStatus,
    });
  }

  @Post('verify/bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify many credential identifiers in one call (FR-VER-05)' })
  async verifyBulk(@Body(zodPipe(bulkVerifySchema)) dto: { credentialIds: string[] }) {
    const results = await this.verification.verifyMany(dto.credentialIds);
    return {
      results,
      summary: {
        requested: dto.credentialIds.length,
        found: results.filter((r) => r.found).length,
        valid: results.filter((r) => r.valid).length,
      },
    };
  }

  @Get('verify/bulk.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'Bulk verification as CSV',
    description: 'Pass ids as a comma-separated `ids` query parameter. Returns a CSV.',
  })
  async verifyBulkCsv(@Query('ids') ids: string): Promise<string> {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const results = await this.verification.verifyMany(list);
    const header = 'credential_id,found,valid,status,title,issuer,issued_at';
    const rows = results.map((r) =>
      [
        r.publicId,
        r.found,
        r.valid,
        r.status,
        csvEscape(r.title ?? ''),
        csvEscape(r.issuer ?? ''),
        r.issuedAt ?? '',
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  // --- Issuer identity and revocation ---------------------------------------

  @Get('issuers/:slug/did.json')
  @Header('content-type', 'application/did+json')
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({ summary: 'The issuer DID document (FR-STD-03)' })
  async didDocument(@Param('slug') slug: string) {
    return this.issuer.didDocument(slug);
  }

  @Get('status/:slug/:listIndex')
  @Header('content-type', 'application/vc+ld+json')
  // Short cache: revocation must propagate to third-party verifiers quickly,
  // and the TTL declared inside the credential says the same thing.
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({ summary: 'A signed W3C Bitstring Status List credential' })
  async statusList(@Param('slug') slug: string, @Param('listIndex') listIndex: string) {
    return this.issuer.statusListCredential(slug, Number(listIndex) || 1);
  }

  // --- Tracking endpoints (FR-ANA-01) ---------------------------------------

  @Get('t/open/:publicId.gif')
  @ApiOperation({ summary: 'Email open pixel' })
  async openPixel(
    @Param('publicId') publicId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.verification.recordEvent(publicId, 'email_opened', req);
    // 1x1 transparent GIF.
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    );
    res
      .status(200)
      .setHeader('content-type', 'image/gif')
      .setHeader('cache-control', 'no-store, no-cache, must-revalidate, private')
      .send(pixel);
  }

  @Post('t/:publicId/:event')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record a share, LinkedIn add or wallet add from the public page' })
  async trackEvent(
    @Param('publicId') publicId: string,
    @Param('event') event: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const allowed = ['viewed', 'shared', 'linkedin_added', 'wallet_added'] as const;
    if (!(allowed as readonly string[]).includes(event)) return;
    await this.verification.recordEvent(
      publicId,
      event as (typeof allowed)[number],
      req,
    );
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
