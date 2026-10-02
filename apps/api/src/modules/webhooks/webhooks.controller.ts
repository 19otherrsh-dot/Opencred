import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '@opencred/schema';
import { zodPipe } from '../../common/zod.pipe';
import {
  CurrentPrincipal,
  OrgId,
  RequirePermissions,
  type AuthPrincipal,
} from '../../common/request-context';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { WebhooksService } from './webhooks.service';

const createSchema = z.object({
  url: z.string().url().max(2000),
  description: z.string().max(300).optional(),
  /** An empty list means "every event", which is the common case. */
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length).default([]),
});

const updateSchema = z.object({
  url: z.string().url().max(2000).optional(),
  description: z.string().max(300).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
  active: z.boolean().optional(),
});

@ApiTags('Webhooks')
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('events')
  @RequirePermissions('webhooks:manage')
  @ApiOperation({ summary: 'The event types an endpoint can subscribe to' })
  events() {
    return {
      events: WEBHOOK_EVENTS,
      delivery: {
        guarantee: 'at-least-once',
        retrySchedule: '12 attempts with exponential backoff over roughly 24 hours',
        timeoutMs: 10_000,
        signatureHeader: 'x-opencred-signature',
        signatureFormat: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">',
        note: 'Consumers must be idempotent; every payload carries a stable `id`.',
      },
    };
  }

  @Get()
  @RequirePermissions('webhooks:manage')
  async list(@OrgId() organizationId: string) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        description: true,
        events: true,
        active: true,
        failureCount: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        createdAt: true,
      },
    });
    return endpoints;
  }

  @Post()
  @RequirePermissions('webhooks:manage')
  @ApiOperation({
    summary: 'Register a webhook endpoint',
    description: 'The signing secret is returned once at creation and is never retrievable again.',
  })
  async create(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(zodPipe(createSchema)) dto: ReturnType<typeof createSchema.parse>,
  ) {
    const secret = this.webhooks.generateSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: dto.url,
        description: dto.description ?? null,
        events: dto.events,
        secret,
      },
    });

    await this.audit.record({
      organizationId,
      principal,
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: endpoint.id,
      metadata: { url: dto.url, events: dto.events },
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      active: endpoint.active,
      secret,
    };
  }

  @Patch(':id')
  @RequirePermissions('webhooks:manage')
  async update(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Body(zodPipe(updateSchema)) dto: ReturnType<typeof updateSchema.parse>,
  ) {
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('webhook endpoint not found');

    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...dto,
        // Re-enabling a disabled endpoint clears the failure streak; otherwise
        // an old outage keeps a healthy endpoint looking broken.
        ...(dto.active === true ? { failureCount: 0 } : {}),
      },
      select: { id: true, url: true, events: true, active: true, description: true },
    });
  }

  @Delete(':id')
  @RequirePermissions('webhooks:manage')
  async remove(
    @OrgId() organizationId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id') id: string,
  ) {
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('webhook endpoint not found');

    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit.record({
      organizationId,
      principal,
      action: 'webhook.deleted',
      targetType: 'webhook',
      targetId: id,
    });
    return { deleted: true };
  }

  @Post(':id/test')
  @HttpCode(202)
  @RequirePermissions('webhooks:manage')
  @ApiOperation({ summary: 'Send a signed test event to this endpoint' })
  async test(@OrgId() organizationId: string, @Param('id') id: string) {
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('webhook endpoint not found');
    return this.webhooks.sendTestEvent(organizationId, id);
  }

  @Get(':id/deliveries')
  @RequirePermissions('webhooks:manage')
  @ApiOperation({
    summary: 'Delivery attempts for this endpoint',
    description: 'Includes the response status and body we received, so a failing integration is debuggable.',
  })
  async deliveries(
    @OrgId() organizationId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.prisma.webhookDelivery.findMany({
      where: { organizationId, endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseStatus: true,
        responseBody: true,
        error: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }
}
