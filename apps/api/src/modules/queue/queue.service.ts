import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { loadConfig } from '../../config';

/**
 * Background work.
 *
 * BullMQ over Valkey. Everything slow or failure-prone runs here rather than
 * inline: rendering, email, webhook delivery, exports and the scheduled
 * sweeps. That is what makes FR-ISS-01 achievable — the API returns as soon as
 * a batch is accepted, and horizontal worker capacity, not request timeout, is
 * what determines throughput (§9.5).
 */

/**
 * Queue names are bare; the `opencred` namespace is applied through BullMQ's
 * `prefix` option instead. BullMQ rejects `:` inside a queue name because it
 * builds its own Redis keys with it, so namespacing has to go through the
 * documented mechanism rather than into the name.
 */
export const QUEUE_PREFIX = 'opencred';

export const QUEUES = {
  issuance: 'issuance',
  render: 'render',
  email: 'email',
  webhook: 'webhook',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface IssueCredentialJob {
  credentialId: string;
  organizationId: string;
  /** Skip delivery email; used by dry runs and by callers sending their own. */
  suppressEmail?: boolean;
}

export interface BatchJob {
  batchId: string;
  organizationId: string;
}

export interface EmailJob {
  credentialId: string;
  organizationId: string;
}

export interface WebhookJob {
  deliveryId: string;
}

export interface MaintenanceJob {
  task: 'expire-credentials' | 'purge-tokens' | 'dispatch-scheduled-batches' | 'retry-webhooks';
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly config = loadConfig();
  private readonly connections: Redis[] = [];
  private readonly queues = new Map<string, Queue>();
  private readonly events = new Map<string, QueueEvents>();

  createConnection(): Redis {
    const connection = new IORedis(this.config.VALKEY_URL, {
      // BullMQ requires this: blocking commands must not be retried by the
      // client or jobs get delivered twice.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    connection.on('error', (err) => this.logger.error(`valkey error: ${err.message}`));
    this.connections.push(connection);
    return connection;
  }

  queue(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;

    const queue = new Queue(name, {
      connection: this.createConnection(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        // Successful jobs are trimmed aggressively; failures are kept for a
        // week so an operator can see what actually went wrong.
        removeOnComplete: { count: 1_000, age: 3_600 },
        removeOnFail: { age: 7 * 24 * 3_600 },
      },
    });
    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Job ids use `-` rather than `:` as the separator. BullMQ reserves `:` for
   * its own Redis key structure and rejects it in both queue names and custom
   * job ids.
   */
  async enqueueIssuance(job: IssueCredentialJob, options: JobsOptions = {}): Promise<void> {
    await this.queue(QUEUES.issuance).add('issue', job, {
      // Idempotency at the queue level: a retried API call that re-enqueues the
      // same credential collapses into one job.
      jobId: `credential-${job.credentialId}`,
      ...options,
    });
  }

  async enqueueIssuanceBulk(jobs: IssueCredentialJob[]): Promise<void> {
    if (jobs.length === 0) return;
    // Chunked, because a 10,000-job single pipeline is a large Valkey command
    // and blocks other traffic on the connection while it is written.
    const CHUNK = 500;
    for (let i = 0; i < jobs.length; i += CHUNK) {
      await this.queue(QUEUES.issuance).addBulk(
        jobs.slice(i, i + CHUNK).map((job) => ({
          name: 'issue',
          data: job,
          opts: { jobId: `credential-${job.credentialId}` },
        })),
      );
    }
  }

  async enqueueEmail(job: EmailJob): Promise<void> {
    await this.queue(QUEUES.email).add('deliver', job, {
      jobId: `email-${job.credentialId}`,
    });
  }

  async enqueueWebhook(job: WebhookJob, delayMs = 0): Promise<void> {
    await this.queue(QUEUES.webhook).add('deliver', job, {
      jobId: `webhook-${job.deliveryId}-${Date.now()}`,
      delay: delayMs,
      // Retries are driven by our own delivery ledger (24h of backoff, per
      // §9.1), not by BullMQ's attempt counter, so that the retry schedule is
      // visible to the customer in the deliveries UI.
      attempts: 1,
    });
  }

  async enqueueBatch(job: BatchJob, runAt?: Date): Promise<void> {
    await this.queue(QUEUES.issuance).add('batch', job, {
      jobId: `batch-${job.batchId}`,
      ...(runAt ? { delay: Math.max(0, runAt.getTime() - Date.now()) } : {}),
    });
  }

  /**
   * Repeatable maintenance jobs.
   *
   * Registered idempotently at boot on every API instance; BullMQ deduplicates
   * by repeat key, so N replicas do not produce N sweeps.
   */
  async registerRepeatables(): Promise<void> {
    const queue = this.queue(QUEUES.maintenance);
    const schedule: Array<{ task: MaintenanceJob['task']; pattern: string }> = [
      // Materialise expiry so verification is correct even between reads.
      { task: 'expire-credentials', pattern: '*/10 * * * *' },
      // FR-ISS-03: fire batches queued for a future moment, within 60 seconds.
      { task: 'dispatch-scheduled-batches', pattern: '* * * * *' },
      { task: 'retry-webhooks', pattern: '* * * * *' },
      { task: 'purge-tokens', pattern: '17 3 * * *' },
    ];

    for (const entry of schedule) {
      await queue.add(
        entry.task,
        { task: entry.task },
        { repeat: { pattern: entry.pattern }, jobId: `maintenance-${entry.task}` },
      );
    }
    this.logger.log(`registered ${schedule.length} maintenance schedules`);
  }

  async queueDepths(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const name of Object.values(QUEUES)) {
      const counts = await this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
      out[name] = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      out[`${name}:failed`] = counts.failed ?? 0;
    }
    return out;
  }

  async ping(): Promise<boolean> {
    try {
      const connection = this.connections[0] ?? this.createConnection();
      const reply = await connection.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const events of this.events.values()) await events.close().catch(() => undefined);
    for (const queue of this.queues.values()) await queue.close().catch(() => undefined);
    for (const connection of this.connections) connection.disconnect();
  }
}
