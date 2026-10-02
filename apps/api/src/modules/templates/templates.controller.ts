import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { credentialKindSchema, templateDocumentSchema } from '@opencred/schema';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  Public,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { TemplatesService } from './templates.service';

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  kind: credentialKindSchema.optional(),
  document: z.unknown().optional(),
  /** Slug from the starter library, e.g. `modern-minimal-cobalt`. */
  fromLibrary: z.string().max(120).optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(1000).nullable().optional(),
    document: z.unknown().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

const previewSchema = z.object({
  templateId: z.string().uuid().optional(),
  document: z.unknown().optional(),
  data: z.record(z.string()).optional(),
  format: z.enum(['png', 'pdf', 'svg']).default('png'),
  scale: z.number().min(0.1).max(2).optional(),
});

@ApiTags('Templates')
@Controller('v1/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('templates:read')
  @ApiOperation({ summary: 'List the workspace templates' })
  list(
    @OrgId() organizationId: string,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.templates.list(organizationId, {
      q,
      kind: kind === 'badge' || kind === 'certificate' ? kind : undefined,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('library')
  @Public()
  @ApiOperation({
    summary: 'Browse the open starter template library (FR-DES-03)',
    description:
      'Public on purpose: the library is CC0 and browsing it should not require an account. ' +
      'Every entry is a JSON file in the repository.',
  })
  library(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('kind') kind?: string,
    @Query('orientation') orientation?: string,
  ) {
    return this.templates.library({
      q,
      category,
      kind: kind === 'badge' || kind === 'certificate' ? kind : undefined,
      orientation:
        orientation === 'landscape' || orientation === 'portrait' || orientation === 'square'
          ? orientation
          : undefined,
    });
  }

  @Get('library/:slug')
  @Public()
  libraryTemplate(@Param('slug') slug: string) {
    return this.templates.libraryTemplate(slug);
  }

  @Post('preview')
  @RequirePermissions('templates:read')
  @ApiOperation({ summary: 'Render a preview of a template against sample data (FR-DES-02)' })
  async preview(
    @OrgId() organizationId: string,
    @Body(zodPipe(previewSchema)) dto: ReturnType<typeof previewSchema.parse>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.templates.preview(organizationId, {
      templateId: dto.templateId,
      document: dto.document,
      data: dto.data,
      format: dto.format,
      scale: dto.scale,
    });
    res
      .status(200)
      .setHeader('content-type', result.contentType)
      .setHeader('x-opencred-degraded-rendering', String(result.degraded))
      .send(result.buffer);
  }

  @Post('validate')
  @RequirePermissions('templates:read')
  @ApiOperation({ summary: 'Validate a template document without saving it' })
  validate(@Body() body: unknown) {
    const parsed = templateDocumentSchema.safeParse((body as { document?: unknown })?.document ?? body);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }
    return { valid: true, errors: [] };
  }

  @Get(':id')
  @RequirePermissions('templates:read')
  get(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.templates.get(organizationId, id);
  }

  @Post()
  @RequirePermissions('templates:write')
  create(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(createSchema)) dto: ReturnType<typeof createSchema.parse>,
  ) {
    return this.templates.create(organizationId, dto, principal);
  }

  @Patch(':id')
  @RequirePermissions('templates:write')
  update(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(updateSchema)) dto: ReturnType<typeof updateSchema.parse>,
  ) {
    return this.templates.update(organizationId, id, dto, principal);
  }

  @Post(':id/duplicate')
  @RequirePermissions('templates:write')
  duplicate(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.templates.duplicate(organizationId, id, principal);
  }

  @Delete(':id')
  @RequirePermissions('templates:write')
  @ApiOperation({
    summary: 'Archive a template',
    description:
      'Templates are archived, never deleted: issued credentials reference them and must stay reproducible.',
  })
  archive(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.templates.archive(organizationId, id, principal);
  }
}
