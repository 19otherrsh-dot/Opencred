import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { AuditService } from '../../common/audit.service';
import { IssuanceService } from '../credentials/issuance.service';
import { BatchesService } from './batches.service';

const uploadSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().max(200).optional(),
});

const validateSchema = z.object({
  mapping: z.record(z.string().max(200)),
  defaults: z.record(z.string().max(500)).default({}),
});

const issueSchema = z.object({
  skipInvalidRows: z.boolean().default(false),
  suppressEmail: z.boolean().default(false),
  scheduledAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const revokeSchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Bulk issuance (FR-ISS-01).
 *
 * Four steps, each independently retryable: upload, map/validate, confirm,
 * monitor. The deliberate friction is between validation and confirmation —
 * nothing is issued until an issuer has seen the validation report.
 */
@ApiTags('Bulk issuance')
@Controller('v1/batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly issuance: IssuanceService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('credentials:read')
  list(
    @OrgId() organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.batches.list(organizationId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Post('upload')
  @HttpCode(200)
  @RequirePermissions('credentials:issue')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 64 * 1024 * 1024 } }))
  @ApiOperation({
    summary: 'Upload a CSV and get a suggested column mapping (FR-REC-01)',
    description: 'Nothing is issued at this step. Returns headers, a sample and a proposed mapping.',
  })
  upload(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body(zodPipe(uploadSchema)) dto: ReturnType<typeof uploadSchema.parse>,
  ) {
    if (!file) throw new BadRequestException('no file uploaded');
    return this.batches.upload({
      organizationId,
      templateId: dto.templateId,
      name: dto.name ?? file.originalname.replace(/\.csv$/i, ''),
      file: file.buffer,
      filename: file.originalname,
      principal,
    });
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermissions('credentials:issue')
  @ApiOperation({
    summary: 'Validate every row against the mapping before issuing',
    description:
      'Returns per-row issues: missing fields, malformed emails, duplicates within the file, and ' +
      'how many recipients already exist. Still issues nothing.',
  })
  validate(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(validateSchema)) dto: ReturnType<typeof validateSchema.parse>,
  ) {
    return this.batches.validate(organizationId, id, dto.mapping, dto.defaults);
  }

  @Post(':id/issue')
  @HttpCode(202)
  @RequirePermissions('credentials:issue')
  @ApiOperation({
    summary: 'Confirm and issue the batch (FR-ISS-01, FR-ISS-03)',
    description:
      'Returns as soon as the credentials exist. Pass `scheduledAt` to queue the batch for a future moment.',
  })
  async issue(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(issueSchema)) dto: ReturnType<typeof issueSchema.parse>,
  ) {
    const result = await this.batches.issue({
      organizationId,
      batchId: id,
      principal,
      skipInvalidRows: dto.skipInvalidRows,
      suppressEmail: dto.suppressEmail,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'batch.issued',
      targetType: 'batch',
      targetId: id,
      metadata: { queued: result.queued, skipped: result.skipped, scheduledAt: result.scheduledAt },
    });

    return result;
  }

  @Get(':id')
  @RequirePermissions('credentials:read')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.batches.get(organizationId, id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('credentials:revoke')
  @ApiOperation({
    summary: 'Revoke every credential in a batch (FR-ISS-06)',
    description:
      'Status-list bits are flipped in a single write per list, so the public verification pages for ' +
      'the whole batch reflect the revocation immediately.',
  })
  async revoke(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(revokeSchema)) dto: { reason?: string },
  ) {
    const result = await this.issuance.revokeBatch(organizationId, id, dto.reason, principal);
    await this.audit.record({
      organizationId,
      principal,
      action: 'batch.revoked',
      targetType: 'batch',
      targetId: id,
      metadata: { revoked: result.revoked, reason: dto.reason ?? null },
    });
    return result;
  }
}
