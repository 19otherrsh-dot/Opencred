import { Injectable, Logger } from '@nestjs/common';
import { planFor, type WebhookEventType } from '@opencred/schema';
import { PrismaService } from '../../common/prisma.service';
import { CryptoService } from '../../common/crypto.service';
import { randomToken } from '../../common/ids';
import { QueueService } from '../queue/queue.service';

/**
 * FR-INT-02 — outbound webhooks.
 *
 * Delivery guarantees, stated plainly because integrators need to design
 * against them: at-least-once, with exponential backoff for 24 hours (§9.1).
 * Consumers must therefore be idempotent, and every payload carries a stable
 * `id` for exactly that purpose.
 *
 * Each attempt is a row in `webhook_deliveries`, which is what makes the
 * customer-facing delivery log real rather than a summary — "we tried, here is
 * the response body your endpoint returned" is the single most useful thing an
 * integrations UI can show.
 */

/** Backoff schedule in minutes, spanning ~24 hours across 12 attempts. */
const RETRY_SCHEDULE_MINUTES = [0, 1, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1_280];

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly queue: QueueService,
  ) {}

  generateSecret(): string {
    return `whsec_${randomToken(24)}`;
  }

  /**
   * Fan a domain event out to every subscribed endpoint.
   *
   * Never throws: a webhook configuration problem must not fail the issuance
   * that produced the event.
   */
  async dispatch(
    organizationId: string,
    event: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { plan: true },
      });
      if (!org || !planFor(org.plan).features.webhooks) return;

      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { organizationId, active: true },
      });

      const subscribed = endpoints.filter(
        (e) => e.events.length === 0 || e.events.includes(event),
      );
      if (subscribed.length === 0) return;

      for (const endpoint of subscribed) {
        const delivery = await this.prisma.webhookDelivery.create({
          data: {
            organizationId,
            endpointId: endpoint.id,
            event,
            payload: {
              id: `evt_${randomToken(12)}`,
              type: event,
              createdAt: new Date().toISOString(),
              organizationId,
              data: payload,
            } as never,
            status: 'pending',
            nextAttemptAt: new Date(),
          },
        });
        await this.queue.enqueueWebhook({ deliveryId: delivery.id });
      }
    } catch (err) {
      this.logger.error(`webhook dispatch for "${event}" failed: ${(err as Error).message}`);
    }
  }

  /**
   * Attempt one delivery. Called by the webhook worker.
   *
   * Signature scheme mirrors the widely-understood Stripe format:
   *
   *     X-OpenCred-Signature: t=<unix>,v1=<hex hmac of "t.body">
   *
   * The timestamp is inside the signed material specifically so a captured
   * payload cannot be replayed against the consumer indefinitely.
   */
  async attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || delivery.status === 'delivered') return;

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.crypto.webhookSignature(delivery.endpoint.secret, timestamp, body);
    const attempt = delivery.attempts + 1;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'OpenCred-Webhooks/1.0',
          'x-opencred-event': delivery.event,
          'x-opencred-delivery': delivery.id,
          'x-opencred-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      // Response bodies are truncated before storage: a misconfigured endpoint
      // returning a 2 MB HTML error page must not fill the database.
      const responseBody = (await response.text().catch(() => '')).slice(0, 2_000);

      if (response.ok) {
        await this.prisma.$transaction([
          this.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'delivered',
              attempts: attempt,
              responseStatus: response.status,
              responseBody,
              deliveredAt: new Date(),
              nextAttemptAt: null,
              error: null,
            },
          }),
          this.prisma.webhookEndpoint.update({
            where: { id: delivery.endpointId },
            data: { lastSuccessAt: new Date(), failureCount: 0 },
          }),
        ]);
        return;
      }

      await this.scheduleRetry(delivery.id, delivery.endpointId, attempt, {
        responseStatus: response.status,
        responseBody,
        error: `endpoint returned ${response.status}`,
      });
    } catch (err) {
      await this.scheduleRetry(delivery.id, delivery.endpointId, attempt, {
        error: (err as Error).name === 'AbortError' ? 'request timed out after 10s' : (err as Error).message,
      });
    }
  }

  private async scheduleRetry(
    deliveryId: string,
    endpointId: string,
    attempt: number,
    detail: { responseStatus?: number; responseBody?: string; error: string },
  ): Promise<void> {
    const exhausted = attempt >= RETRY_SCHEDULE_MINUTES.length;
    const nextAttemptAt = exhausted
      ? null
      : new Date(Date.now() + RETRY_SCHEDULE_MINUTES[attempt] * 60_000);

    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: exhausted ? 'failed' : 'retrying',
          attempts: attempt,
          responseStatus: detail.responseStatus ?? null,
          responseBody: detail.responseBody ?? null,
          error: detail.error,
          nextAttemptAt,
        },
      }),
      this.prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
      }),
    ]);

    if (exhausted) {
      this.logger.warn(`webhook delivery ${deliveryId} exhausted its 24h retry window`);
    }
  }

  /** Re-enqueue deliveries whose backoff has elapsed. Runs every minute. */
  async retryDue(): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'retrying', nextAttemptAt: { lte: new Date() } },
      select: { id: true },
      take: 500,
    });
    for (const delivery of due) await this.queue.enqueueWebhook({ deliveryId: delivery.id });
    return due.length;
  }

  /** Fire a signed test event so an integrator can validate their handler. */
  async sendTestEvent(organizationId: string, endpointId: string): Promise<{ deliveryId: string }> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        organizationId,
        endpointId,
        event: 'credential.issued',
        payload: {
          id: `evt_test_${randomToken(8)}`,
          type: 'credential.issued',
          createdAt: new Date().toISOString(),
          organizationId,
          test: true,
          data: {
            credentialId: '00000000-0000-4000-8000-000000000000',
            publicId: 'testcred01',
            title: 'Test credential',
            recipient: { name: 'Test Recipient', email: 'test@example.com' },
            status: 'issued',
          },
        } as never,
        status: 'pending',
        nextAttemptAt: new Date(),
      },
    });
    await this.queue.enqueueWebhook({ deliveryId: delivery.id });
    return { deliveryId: delivery.id };
  }
}
