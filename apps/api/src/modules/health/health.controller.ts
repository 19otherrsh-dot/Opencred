import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { LOCALES, LOCALE_NAMES, LOCALE_REVIEW, direction } from '@opencred/i18n';
import { Public } from '../../common/request-context';
import { PrismaService } from '../../common/prisma.service';
import { QueueService } from '../queue/queue.service';
import { RenderService } from '../render/render.service';
import { loadConfig } from '../../config';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

/**
 * Liveness, readiness and metrics.
 *
 * `/healthz` answers "is this process alive" and never touches a dependency —
 * an orchestrator restarting the API because Postgres blipped would turn a
 * database hiccup into an outage. `/readyz` answers "should traffic come here",
 * and that one does check dependencies.
 */
@ApiTags('Operations')
@Public()
@Controller()
export class HealthController {
  private readonly config = loadConfig();
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly render: RenderService,
  ) {}

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return {
      status: 'ok',
      edition: this.config.edition,
      version: process.env.npm_package_version ?? '1.0.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe: checks the database, queue and renderer' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, queue, renderer] = await Promise.all([
      this.prisma.ping(),
      this.queue.ping(),
      this.render.isAvailable(),
    ]);

    // A missing browser degrades rendering to SVG rather than stopping
    // issuance, so it is reported but does not fail readiness.
    const ready = database && queue;
    if (!ready) res.status(503);

    return {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database,
        queue,
        renderer: renderer ? 'chromium' : 'degraded-svg',
      },
    };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiExcludeEndpoint()
  async metrics(): Promise<string> {
    const depths = await this.queue.queueDepths().catch(() => ({}));
    const custom = Object.entries(depths)
      .map(([name, value]) => {
        const metric = name.endsWith(':failed') ? 'opencred_queue_failed' : 'opencred_queue_depth';
        const queue = name.replace(':failed', '');
        return `${metric}{queue="${queue}"} ${value}`;
      })
      .join('\n');

    return `${await registry.metrics()}\n# HELP opencred_queue_depth Jobs waiting, active or delayed.\n# TYPE opencred_queue_depth gauge\n# HELP opencred_queue_failed Jobs in the failed set.\n# TYPE opencred_queue_failed gauge\n${custom}\n`;
  }

  /**
   * FR-ID-04 evidence, and a small act of transparency.
   *
   * Reports which edition is running, which optional subsystems are enabled,
   * and — for a self-hosted install — that nothing here phones home. An
   * operator should be able to confirm that from the software itself rather
   * than from our marketing.
   */
  @Get('v1/instance')
  @ApiOperation({ summary: 'What this deployment is and what it talks to' })
  async instance() {
    return {
      product: 'OpenCred',
      version: process.env.npm_package_version ?? '1.0.0',
      edition: this.config.edition,
      selfHosted: this.config.isSelfHosted,
      license: this.config.edition === 'enterprise' ? 'AGPL-3.0 core + commercial Enterprise module' : 'AGPL-3.0-or-later',
      source: 'https://github.com/opencred/opencred',
      capabilities: {
        openBadges3: true,
        w3cVerifiableCredentials: true,
        didWeb: true,
        statusList: true,
        anchoring: false,
        rendering: (await this.render.isAvailable()) ? 'chromium' : 'svg-fallback',
        storage: this.config.STORAGE_DRIVER,
        billing: this.config.isSelfHosted ? 'not applicable' : this.config.BILLING_DRIVER,
      },
      /**
       * Localisation, reported with its review status.
       *
       * An operator serving a Spanish verification page deserves to know
       * whether those strings have been through a native speaker. Burying that
       * would be the easy choice on a page whose entire job is to be trusted.
       */
      localisation: {
        surfaces: ['verification page', 'credential not found', 'recipient wallet'],
        locales: LOCALES.map((locale) => ({
          code: locale,
          name: LOCALE_NAMES[locale].native,
          direction: direction(locale),
          review: LOCALE_REVIEW[locale],
        })),
        note:
          'The issuer dashboard is English only. Locales marked "unreviewed" were drafted and ' +
          'have not been checked by a native speaker.',
      },
      outboundConnections: {
        telemetry: this.config.TELEMETRY_ENABLED ? this.config.TELEMETRY_ENDPOINT : 'disabled',
        email: this.config.MAIL_TRANSPORT === 'log' ? 'disabled' : this.config.MAIL_HOST,
        note:
          'This instance makes no other outbound connections. Verification, signing and rendering ' +
          'are entirely local.',
      },
    };
  }
}
