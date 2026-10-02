import { OpenCred, OpenCredError, type OpenCredOptions } from './client';
import type { IssueRequest, IssueResult } from './types';

/**
 * The connector toolkit (FR-INT-05).
 *
 * A "connector" is anything that turns an event in another system — a course
 * completed, a form submitted, a deal closed — into an issued credential. Both
 * first-party integrations (Moodle, n8n) are shaped like this, and the point of
 * publishing it is that a third party can build one without re-deriving the
 * three things that are easy to get wrong:
 *
 *  1. **Idempotency.** Source systems redeliver. A connector that does not
 *     derive a stable key from the source event will eventually issue duplicate
 *     certificates, and will find out from a recipient rather than from a log.
 *  2. **Partial failure.** A batch of 300 completions where row 47 has a
 *     malformed address must issue the other 299, not abort.
 *  3. **Field mapping.** Turning a source record into an `IssueRequest` is the
 *     only part that is genuinely connector-specific. Everything else is here.
 *
 * Implement `map()`, optionally `idempotencyKeyFor()`, and call `run()`.
 */

export interface ConnectorContext {
  client: OpenCred;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ConnectorResult<TSource> {
  issued: Array<{ source: TSource; result: IssueResult }>;
  skipped: Array<{ source: TSource; reason: string }>;
  failed: Array<{ source: TSource; error: OpenCredError | Error }>;
  /** Credentials that already existed for the derived idempotency key. */
  deduplicated: number;
  durationMs: number;
}

export interface ConnectorOptions extends OpenCredOptions {
  /**
   * Concurrent issuance requests. Kept low by default: the API accepts a
   * credential in milliseconds, so parallelism buys little and mostly risks
   * tripping the rate limit.
   */
  concurrency?: number;
  /** Report progress rather than issuing anything. */
  dryRun?: boolean;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export abstract class Connector<TSource> {
  protected readonly options: ConnectorOptions;
  private cachedClient?: OpenCred;

  constructor(options: ConnectorOptions) {
    this.options = options;
  }

  /**
   * Built on first use rather than in the constructor.
   *
   * The User-Agent includes `this.name`, and a subclass's `name` does not exist
   * yet while the base constructor is running — TypeScript rejects reading an
   * abstract member there, and at runtime it would be `undefined`.
   */
  protected get client(): OpenCred {
    if (!this.cachedClient) {
      this.cachedClient = new OpenCred({
        ...this.options,
        userAgent: this.options.userAgent ?? `connector/${this.name}`,
      });
    }
    return this.cachedClient;
  }

  /** Used in the User-Agent and in logs, so an operator can see who is calling. */
  abstract get name(): string;

  /** Turn one source record into an issue request. */
  abstract map(source: TSource): IssueRequest | Promise<IssueRequest>;

  /**
   * A stable key for this source record.
   *
   * Override this. The default derives a key from the template and the
   * recipient email, which is right for "one credential per person per course"
   * and wrong for anything that can legitimately be issued twice — a monthly
   * award, a re-sit. Getting it wrong in that direction *blocks* a legitimate
   * second issuance, which is at least a visible failure rather than a silent
   * duplicate.
   */
  idempotencyKeyFor(source: TSource, request: IssueRequest): string | undefined {
    void source;
    return `${this.name}:${request.templateId}:${request.recipient.email.toLowerCase()}`;
  }

  /**
   * Return a reason to skip this record, or `null` to issue it.
   *
   * Runs before mapping, so a connector can cheaply drop records it should not
   * touch — a test account, an unverified address, a course with no template.
   */
  shouldSkip(source: TSource): string | null | Promise<string | null> {
    void source;
    return null;
  }

  protected log(message: string, meta?: Record<string, unknown>): void {
    if (this.options.log) this.options.log(message, meta);
  }

  /**
   * Issue for a batch of source records.
   *
   * Never throws for an individual record: one bad row does not stop the run.
   * The caller gets a full account of what happened to every record.
   */
  async run(sources: TSource[]): Promise<ConnectorResult<TSource>> {
    const started = Date.now();
    const result: ConnectorResult<TSource> = {
      issued: [],
      skipped: [],
      failed: [],
      deduplicated: 0,
      durationMs: 0,
    };

    const concurrency = Math.max(1, this.options.concurrency ?? 4);
    const queue = [...sources];

    const worker = async () => {
      for (;;) {
        const source = queue.shift();
        if (source === undefined) return;

        try {
          const skip = await this.shouldSkip(source);
          if (skip) {
            result.skipped.push({ source, reason: skip });
            continue;
          }

          const request = await this.map(source);
          const idempotencyKey = request.idempotencyKey ?? this.idempotencyKeyFor(source, request);

          if (this.options.dryRun) {
            result.skipped.push({ source, reason: 'dry run' });
            continue;
          }

          const issued = await this.client.issue({ ...request, idempotencyKey });
          if (issued.deduplicated) result.deduplicated += 1;
          result.issued.push({ source, result: issued });
        } catch (error) {
          result.failed.push({ source, error: error as Error });
          this.log('record failed', {
            connector: this.name,
            error: (error as Error).message,
          });
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));

    result.durationMs = Date.now() - started;
    this.log('run complete', {
      connector: this.name,
      issued: result.issued.length,
      deduplicated: result.deduplicated,
      skipped: result.skipped.length,
      failed: result.failed.length,
      durationMs: result.durationMs,
    });

    return result;
  }

  /** Issue for a single record. Convenience for event-driven connectors. */
  async runOne(source: TSource): Promise<IssueResult | null> {
    const outcome = await this.run([source]);
    if (outcome.failed.length > 0) throw outcome.failed[0].error;
    return outcome.issued[0]?.result ?? null;
  }

  /**
   * Confirm the connector can reach OpenCred and which workspace it will issue
   * into. Worth calling at start-up: the alternative is discovering a wrong key
   * at the moment a cohort completes.
   */
  async preflight(): Promise<{ ok: boolean; workspace?: string; role?: string; error?: string }> {
    try {
      const me = (await this.client.whoami()) as {
        organization?: { name?: string };
        role?: string;
        principal?: { role?: string };
      };
      return {
        ok: true,
        workspace: me.organization?.name,
        role: me.role ?? me.principal?.role,
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
