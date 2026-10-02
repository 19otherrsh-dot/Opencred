import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { API_KEY_ROLES, brandingSettingsSchema, roleSchema } from '@opencred/schema';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { AuditService } from '../../common/audit.service';
import { IssuerService } from '../issuer/issuer.service';
import { OrgService } from './org.service';

const updateOrgSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  website: z.string().url().max(2000).nullable().optional(),
  contactEmail: z.string().email().max(320).nullable().optional(),
});

const inviteSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().max(200).optional(),
  role: roleSchema,
});

const roleUpdateSchema = z.object({ role: roleSchema });

const apiKeySchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(API_KEY_ROLES as unknown as [string, ...string[]]).default('issuer'),
  expiresInDays: z.number().int().min(1).max(3_650).optional(),
});

const smtpSchema = z.object({
  enabled: z.boolean(),
  host: z.string().max(253),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
  user: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  from: z.string().max(320),
});

@ApiTags('Organization')
@Controller('v1/org')
export class OrgController {
  constructor(
    private readonly org: OrgService,
    private readonly audit: AuditService,
    private readonly issuer: IssuerService,
  ) {}

  @Get()
  @RequirePermissions('org:read')
  get(@OrgId() organizationId: string) {
    return this.org.get(organizationId);
  }

  @Patch()
  @RequirePermissions('org:update')
  update(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(updateOrgSchema)) dto: ReturnType<typeof updateOrgSchema.parse>,
  ) {
    return this.org.update(organizationId, dto, principal);
  }

  // --- Branding -------------------------------------------------------------

  @Get('branding')
  @RequirePermissions('org:read')
  branding(@OrgId() organizationId: string) {
    return this.org.branding(organizationId);
  }

  @Patch('branding')
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Update the brand kit, custom domain and white-label settings' })
  updateBranding(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(brandingSettingsSchema.partial())) dto: unknown,
  ) {
    return this.org.updateBranding(organizationId, dto, principal);
  }

  @Post('branding/verify-domain')
  @HttpCode(200)
  @RequirePermissions('org:update')
  @ApiOperation({ summary: 'Check the DNS records for a custom verification domain (FR-BRD-01)' })
  verifyDomain(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.org.verifyCustomDomain(organizationId, principal);
  }

  // --- Email ----------------------------------------------------------------

  @Get('email')
  @RequirePermissions('org:read')
  emailSettings(@OrgId() organizationId: string) {
    return this.org.emailSettings(organizationId);
  }

  @Patch('email')
  @RequirePermissions('org:update')
  @ApiOperation({
    summary: 'Configure your own SMTP provider (FR-ISS-07)',
    description:
      'Send credential emails from your own domain through SES, SendGrid, Postal or any SMTP server. ' +
      'Omit `password` to keep the stored one.',
  })
  updateEmail(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(smtpSchema)) dto: ReturnType<typeof smtpSchema.parse>,
  ) {
    return this.org.updateEmailSettings(organizationId, dto, principal);
  }

  // --- Members --------------------------------------------------------------

  @Get('members')
  @RequirePermissions('members:read')
  members(@OrgId() organizationId: string) {
    return this.org.members(organizationId);
  }

  @Post('members')
  @RequirePermissions('members:manage')
  invite(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(inviteSchema)) dto: ReturnType<typeof inviteSchema.parse>,
  ) {
    return this.org.invite(organizationId, dto, principal);
  }

  @Patch('members/:id')
  @RequirePermissions('members:manage')
  setRole(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body(zodPipe(roleUpdateSchema)) dto: ReturnType<typeof roleUpdateSchema.parse>,
  ) {
    return this.org.setRole(organizationId, id, dto.role, principal);
  }

  @Delete('members/:id')
  @RequirePermissions('members:manage')
  removeMember(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.org.removeMember(organizationId, id, principal);
  }

  // --- API keys -------------------------------------------------------------

  @Get('api-keys')
  @RequirePermissions('apikeys:manage')
  apiKeys(@OrgId() organizationId: string) {
    return this.org.apiKeys(organizationId);
  }

  @Post('api-keys')
  @RequirePermissions('apikeys:manage')
  @ApiOperation({
    summary: 'Create an API key',
    description: 'The secret is returned once and stored only as a hash. It cannot be retrieved again.',
  })
  createApiKey(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(apiKeySchema)) dto: ReturnType<typeof apiKeySchema.parse>,
  ) {
    return this.org.createApiKey(
      organizationId,
      { name: dto.name, role: roleSchema.parse(dto.role), expiresInDays: dto.expiresInDays },
      principal,
    );
  }

  @Delete('api-keys/:id')
  @RequirePermissions('apikeys:manage')
  revokeApiKey(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    return this.org.revokeApiKey(organizationId, id, principal);
  }

  // --- Issuer keys ----------------------------------------------------------

  @Get('issuer-key')
  @RequirePermissions('org:read')
  @ApiOperation({ summary: 'The organisation signing key and DID (FR-STD-03)' })
  async issuerKey(@OrgId() organizationId: string) {
    const org = await this.org.get(organizationId);
    const key = await this.issuer.ensureKey(organizationId);
    return {
      did: org.did,
      didDocumentUrl: org.didDocumentUrl,
      keyId: key.keyId,
      algorithm: 'Ed25519',
      publicKeyMultibase: key.publicKeyMultibase,
    };
  }

  @Post('issuer-key/rotate')
  @HttpCode(200)
  @RequirePermissions('org:update')
  @ApiOperation({
    summary: 'Rotate the signing key',
    description:
      'New credentials are signed with the new key. The previous key stays published in the DID ' +
      'document so credentials already issued continue to verify.',
  })
  async rotateKey(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    const result = await this.issuer.rotateKey(organizationId);
    await this.audit.record({
      organizationId,
      principal,
      action: 'issuer_key.rotated',
      metadata: { newKeyId: result.keyId },
    });
    return result;
  }

  // --- Audit log (FR-ID-05) -------------------------------------------------

  @Get('audit-log')
  @RequirePermissions('auditlog:read')
  @ApiOperation({
    summary: 'The append-only audit log',
    description: 'Records every mutating administrative action. There is no endpoint that edits or deletes it.',
  })
  auditLog(
    @OrgId() organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list(organizationId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      action,
    });
  }

  // --- Assets ---------------------------------------------------------------

  @Get('assets')
  @RequirePermissions('org:read')
  assets(@OrgId() organizationId: string) {
    return this.org.listAssets(organizationId);
  }

  @Post('assets')
  @RequirePermissions('templates:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadAsset(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body('purpose') purpose: string | undefined,
  ) {
    if (!file) throw new BadRequestException('no file uploaded');
    return this.org.uploadAsset(organizationId, file, purpose ?? 'brand', principal);
  }

  @Get('assets/:id')
  @RequirePermissions('org:read')
  async assetBytes(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.org.assetBytes(organizationId, id);
    res
      .status(200)
      .setHeader('content-type', asset.contentType)
      .setHeader('cache-control', 'private, max-age=3600')
      .send(asset.buffer);
  }
}
