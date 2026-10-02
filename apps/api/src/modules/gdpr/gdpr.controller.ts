import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { GdprService } from './gdpr.service';

const eraseSchema = z.object({
  email: z.string().email().max(320),
  /** Report what would happen without doing it. Erasure is irreversible. */
  dryRun: z.boolean().default(true),
  reason: z.string().max(500).optional(),
});

@ApiTags('Data protection')
@Controller('v1/gdpr')
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  @Get('subject')
  @RequirePermissions('gdpr:manage')
  @ApiOperation({
    summary: 'Export everything held about one data subject (FR-GOV-01)',
    description: 'Satisfies both the access and the portability right in one machine-readable document.',
  })
  export(@OrgId() organizationId: string, @Query('email') email: string) {
    return this.gdpr.exportSubject(organizationId, email);
  }

  @Post('subject/erase')
  @HttpCode(200)
  @RequirePermissions('gdpr:manage')
  @ApiOperation({
    summary: 'Erase a data subject',
    description:
      'Defaults to a dry run. Erasure is destructive by necessity: a credential is a signed statement ' +
      'about a named person, so removing the person invalidates the credential. Affected credentials ' +
      'are revoked and their signed documents and rendered files deleted.',
  })
  erase(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(eraseSchema)) dto: ReturnType<typeof eraseSchema.parse>,
  ) {
    return this.gdpr.eraseSubject(
      organizationId,
      dto.email,
      { dryRun: dto.dryRun, reason: dto.reason },
      principal,
    );
  }

  @Get('processing-record')
  @RequirePermissions('org:read')
  @ApiOperation({
    summary: 'A processing record generated from the live schema and configuration',
    description: 'Written for a data protection officer, generated from the system rather than by hand.',
  })
  processingRecord(@OrgId() organizationId: string) {
    return this.gdpr.processingRecord(organizationId);
  }
}
