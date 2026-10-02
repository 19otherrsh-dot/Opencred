import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import {
  QUEUES,
  QUEUE_PREFIX,
  QueueService,
  type BatchJob,
  type EmailJob,
  type IssueCredentialJob,
  type MaintenanceJob,
  type WebhookJob,
} from './modules/queue/queue.service';
import { IssuanceService } from './modules/credentials/issuance.service';
import { BatchesService } from './modules/batches/batches.service';
import { WebhooksService } from './modules/webhooks/webhooks.service';
import { DeliveryService } from './modules/mail/delivery.service';
import { TokenService } from './modules/auth/token.service';
import { PrismaService } from './common/prisma.service';
import { StorageService } from './modules/storage/storage.service';
import { RenderService } from './modules/render/render.service';

/**
 * The worker process.
 *
 * Runs separately from the API on purpose. Rendering is CPU-bound and Chromium
 * is memory-hungry; sharing a process with the request path means a large batch
 * degrades verification latency for everyone. Separate processes let the two
 * scale on their own signals: request rate for the API, queue depth for the
 * workers (section 9.5).
 *
 * `OPENCRED_ROLE=all` runs both in one process, which is what a small
 * self-hosted install wants and what `docker compose up` does by default.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('worker');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: config.isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
  });

  const queues = app.get(QueueService);
  const issuance = app.get(IssuanceService);
  const batches = app.get(BatchesService);
  const webhooks = app.get(WebhooksService);
  const delivery = app.get(DeliveryService);
  const tokens = app.get(TokenService);
  const storage = app.get(StorageService);
  const render = app.get(RenderService);
  const prisma = app.get(PrismaService);

  await storage.ensureBucket().catch(() => undefined);

  if (!(await render.isAvailable())) {
    logger.warn(
      'Chromium is not available: credentials will render as SVG rather than PDF/PNG. ' +
        'Install it with `npx playwright install --with-deps chromium`.',
    );
  }

  const workers: Worker[] = [];

  // --- Issuance -------------------------------------------------------------
  workers.push(
    new Worker(
      QUEUES.issuance,
      async (job: Job<IssueCredentialJob | BatchJob>) => {
        if (job.name === 'batch') {
          const data = job.data as BatchJob;
          const dispatched = await batches.dispatchScheduled(data.batchId);
          logger.log(`scheduled batch ${data.batchId} dispatched ${dispatched} credentials`);
          return;
        }

        const data = job.data as IssueCredentialJob;
        await issuance.process(data.credentialId, { suppressEmail: data.suppressEmail });

        // Batch progress is refreshed opportunistically rather than on every
        // credential: the counter query is cheap but not free, and a batch
        // progress bar does not need per-row precision.
        const credential = await prisma.credential.findUnique({
          where: { id: data.credentialId },
          select: { batchId: true },
        });
        if (credential?.batchId && Math.random() < 0.05) {
          await batches.refreshProgress(credential.batchId);
        }
      },
      {
        connection: queues.createConnection(),
        prefix: QUEUE_PREFIX,
        concurrency: config.ISSUANCE_CONCURRENCY,
        // Ordering does not matter and throughput does, so jobs are taken as
        // fast as the renderer allows.
        autorun: true,
      },
    ),
  );

  // --- Email ----------------------------------------------------------------
  workers.push(
    new Worker(
      QUEUES.email,
      async (job: Job<EmailJob>) => {
        await delivery.deliver(job.data.credentialId);
      },
      {
        connection: queues.createConnection(),
        prefix: QUEUE_PREFIX,
        // SMTP providers rate-limit hard; more concurrency here produces
        // throttling responses, not more delivered mail.
        concurrency: 4,
        limiter: { max: 100, duration: 60_000 },
      },
    ),
  );

  // --- Webhooks -------------------------------------------------------------
  workers.push(
    new Worker(
      QUEUES.webhook,
      async (job: Job<WebhookJob>) => {
        await webhooks.attemptDelivery(job.data.deliveryId);
      },
      { connection: queues.createConnection(), prefix: QUEUE_PREFIX, concurrency: config.WEBHOOK_CONCURRENCY },
    ),
  );

  // --- Maintenance ----------------------------------------------------------
  workers.push(
    new Worker(
      QUEUES.maintenance,
      async (job: Job<MaintenanceJob>) => {
        switch (job.data.task) {
          case 'expire-credentials': {
            const count = await issuance.expireDue();
            if (count > 0) logger.log(`expired ${count} credentials`);
            return;
          }
          case 'dispatch-scheduled-batches': {
            const count = await batches.dispatchDueScheduled();
            if (count > 0) logger.log(`dispatched ${count} scheduled credentials`);
            return;
          }
          case 'retry-webhooks': {
            const count = await webhooks.retryDue();
            if (count > 0) logger.debug(`re-queued ${count} webhook deliveries`);
            return;
          }
          case 'purge-tokens': {
            const count = await tokens.purgeExpired();
            logger.log(`purged ${count} expired refresh tokens`);
            return;
          }
          default:
            logger.warn(`unknown maintenance task "${(job.data as MaintenanceJob).task}"`);
        }
      },
      { connection: queues.createConnection(), prefix: QUEUE_PREFIX, concurrency: 1 },
    ),
  );

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      logger.error(
        `${worker.name} job ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? 0}): ${err.message}`,
      );
    });
    worker.on('error', (err) => logger.error(`${worker.name} worker error: ${err.message}`));
  }

  logger.log(
    `OpenCred workers running: issuance x${config.ISSUANCE_CONCURRENCY}, email x4, ` +
      `webhooks x${config.WEBHOOK_CONCURRENCY}, maintenance x1`,
  );

  /**
   * Graceful shutdown.
   *
   * Workers are closed before the app context so that in-flight jobs finish and
   * are not left in the active set. A credential that was mid-render when a pod
   * was recycled would otherwise stay stuck until its lock expired.
   */
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, draining workers...`);
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('OpenCred worker failed to start:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
