import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { credentialPatchSchema, issueRequestSchema } from '@opencred/schema';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  Public,
  RequirePermissions,
  type AuthPrincipal,
  type AuthenticatedRequest,
} from '../../common/request-context';
import { AuditService } from '../../common/audit.service';
import { QueueService } from '../queue/queue.service';
import { TokenService } from '../auth/token.service';
import { CredentialsService } from './credentials.service';
import { IssuanceService } from './issuance.service';

const revokeSchema = z.object({ reason: z.string().max(500).optional() });

const listQuerySchema = z.object({
  status: z.enum(['draft', 'issued', 'expired', 'revoked']).optional(),
  templateId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  recipientId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  issuedAfter: z.string().datetime().optional(),
  issuedBefore: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

@ApiTags('Credentials')
@Controller('v1/credentials')
export class CredentialsController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly issuance: IssuanceService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions('credentials:issue')
  @ApiOperation({
    summary: 'Issue a single credential (FR-ISS-02, FR-ISS-04)',
    description:
      'Returns 202 as soon as the credential is accepted; signing, rendering and delivery happen ' +
      'in the background. Pass `idempotencyKey` when calling from an event handler that may retry.',
  })
  async issue(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(issueRequestSchema)) dto: ReturnType<typeof issueRequestSchema.parse>,
  ) {
    const result = await this.issuance.issueOne(organizationId, dto, principal);
    if (!result.deduplicated) {
      await this.audit.record({
        organizationId,
        principal,
        action: 'credential.issued',
        targetType: 'credential',
        targetId: result.id,
        metadata: { recipient: dto.recipient.email, templateId: dto.templateId },
      });
    }
    return result;
  }

  @Get()
  @RequirePermissions('credentials:read')
  @ApiOperation({ summary: 'List and filter issued credentials' })
  list(
    @OrgId() organizationId: string,
    @Query(zodPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
  ) {
    return this.credentials.list(organizationId, query);
  }

  @Get('export.csv')
  @RequirePermissions('data:export')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="opencred-credentials.csv"')
  @ApiOperation({
    summary: 'Export every credential as CSV (FR-REC-04)',
    description:
      'Streamed, unpaginated and available at any time without contacting support. ' +
      'This is the anti-lock-in guarantee, so it is a first-class endpoint rather than a settings toggle.',
  })
  async export(
    @OrgId() organizationId: string,
    @Query(zodPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    for await (const chunk of this.credentials.exportCsv(organizationId, query)) {
      res.write(chunk);
    }
    res.end();
  }

  @Get(':id')
  @RequirePermissions('credentials:read')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.credentials.get(organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('credentials:issue')
  @ApiOperation({
    summary: 'Correct an issued credential in place (FR-ISS-05)',
    description:
      'Re-signs and re-renders this credential only. The public identifier, QR code and status-list ' +
      'slot are preserved, so links already shared keep working and the rest of the batch is untouched.',
  })
  async update(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(credentialPatchSchema)) dto: ReturnType<typeof credentialPatchSchema.parse>,
  ) {
    const result = await this.issuance.updateCredential(organizationId, id, dto, principal);
    await this.audit.record({
      organizationId,
      principal,
      action: 'credential.updated',
      targetType: 'credential',
      targetId: id,
      metadata: { reason: dto.reason ?? null, fields: Object.keys(dto) },
    });
    return result;
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('credentials:revoke')
  @ApiOperation({ summary: 'Revoke a credential (FR-ISS-06)' })
  async revoke(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(revokeSchema)) dto: { reason?: string },
  ) {
    await this.issuance.revoke(organizationId, id, dto.reason, principal);
    await this.audit.record({
      organizationId,
      principal,
      action: 'credential.revoked',
      targetType: 'credential',
      targetId: id,
      metadata: { reason: dto.reason ?? null },
    });
    return { revoked: true };
  }

  @Post(':id/resend')
  @HttpCode(202)
  @RequirePermissions('credentials:issue')
  @ApiOperation({ summary: 'Re-send the delivery email for one credential' })
  async resend(@OrgId() organizationId: string, @Param('id') id: string) {
    await this.queue.enqueueEmail({ credentialId: id, organizationId });
    return { queued: true };
  }

  @Get(':id/download')
  @RequirePermissions('credentials:read')
  @ApiOperation({ summary: 'Download the rendered credential as an issuer' })
  async download(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const artefact = await this.issuance.artefact(
      organizationId,
      id,
      format === 'png' ? 'png' : 'pdf',
    );
    res
      .status(200)
      .setHeader('content-type', artefact.contentType)
      .setHeader('content-disposition', `attachment; filename="${artefact.filename}"`)
      .send(artefact.buffer);
  }
}

/**
 * The recipient wallet (FR-DEL-02).
 *
 * Separate controller because these routes are authenticated by a recipient
 * magic-link token rather than by workspace membership, and mixing the two
 * authorisation models on one controller is how cross-tenant leaks happen.
 */
@ApiTags('Recipient wallet')
@Controller('v1/wallet')
export class WalletController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly tokens: TokenService,
  ) {}

  @Get('credentials')
  @Public()
  @ApiOperation({
    summary: 'Every credential issued to the signed-in recipient, across all issuers',
    description:
      'Authenticated by the recipient token from a magic link, not by workspace membership. ' +
      'The token carries only an email address, so it can read nothing else.',
  })
  async wallet(@Req() req: AuthenticatedRequest) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('sign in with the link emailed to you');
    }

    const claims = this.tokens.verifyAccessToken(header.slice(7).trim());
    if (claims.typ !== 'recipient' || !claims.email) {
      throw new UnauthorizedException('this endpoint needs a recipient session');
    }

    return { email: claims.email, credentials: await this.credentials.walletFor(claims.email) };
  }
}
