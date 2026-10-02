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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { RecipientsService } from './recipients.service';

const updateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  email: z.string().email().max(320).optional(),
  externalId: z.string().max(200).nullable().optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
});

const tagSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(10_000),
  add: z.array(z.string().max(60)).max(20).default([]),
  remove: z.array(z.string().max(60)).max(20).default([]),
});

const resendSchema = z.object({
  recipientIds: z.array(z.string().uuid()).max(10_000).optional(),
  /** Convenience selector for the segment issuers actually re-send to. */
  segment: z.enum(['bounced']).optional(),
});

const importSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().min(1).max(200),
  externalId: z.string().max(200).optional(),
  tags: z.string().max(200).optional(),
});

@ApiTags('Recipients')
@Controller('v1/recipients')
export class RecipientsController {
  constructor(private readonly recipients: RecipientsService) {}

  @Get()
  @RequirePermissions('recipients:read')
  list(
    @OrgId() organizationId: string,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.recipients.list(organizationId, {
      q,
      tag,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('export.csv')
  @RequirePermissions('data:export')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="opencred-recipients.csv"')
  @ApiOperation({ summary: 'Export every recipient as CSV (FR-REC-04)' })
  export(@OrgId() organizationId: string) {
    return this.recipients.exportCsv(organizationId);
  }

  @Get(':id')
  @RequirePermissions('recipients:read')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.recipients.get(organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('recipients:write')
  update(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(updateSchema)) dto: ReturnType<typeof updateSchema.parse>,
  ) {
    return this.recipients.update(organizationId, id, dto, principal);
  }

  @Post('tags')
  @HttpCode(200)
  @RequirePermissions('recipients:write')
  @ApiOperation({ summary: 'Add or remove tags across a set of recipients (FR-REC-03)' })
  tag(
    @OrgId() organizationId: string,
    @Body(zodPipe(tagSchema)) dto: ReturnType<typeof tagSchema.parse>,
  ) {
    return this.recipients.tag(organizationId, dto.recipientIds, dto.add, dto.remove);
  }

  @Post('resend')
  @HttpCode(202)
  @RequirePermissions('credentials:issue')
  @ApiOperation({
    summary: 'Re-send credential emails to a segment',
    description: 'Pass explicit recipientIds, or `segment: "bounced"` for everyone whose last delivery failed.',
  })
  async resend(
    @OrgId() organizationId: string,
    @Body(zodPipe(resendSchema)) dto: ReturnType<typeof resendSchema.parse>,
  ) {
    const ids =
      dto.segment === 'bounced'
        ? await this.recipients.bouncedSegment(organizationId)
        : (dto.recipientIds ?? []);
    return this.recipients.resendTo(organizationId, ids);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions('recipients:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Import recipients from a CSV without issuing anything' })
  import(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body(zodPipe(importSchema)) mapping: ReturnType<typeof importSchema.parse>,
  ) {
    if (!file) throw new Error('no file uploaded');
    return this.recipients.import(organizationId, file.buffer, mapping, principal);
  }
}
