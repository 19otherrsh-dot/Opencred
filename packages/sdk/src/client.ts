import type {
  BulkVerificationRow,
  CredentialSummary,
  IssueRequest,
  IssueResult,
  Page,
  Template,
  VerificationResult,
} from './types';

/**
 * The OpenCred API client.
 *
 * Zero runtime dependencies — it is `fetch` plus the retry and idempotency
 * behaviour that every integrator would otherwise write themselves, usually
 * incorrectly. The two things it gets right that hand-rolled clients typically
 * do not:
 *
 *  - **It never retries a non-idempotent request that might have succeeded.**
 *    A POST that times out may well have issued the credential. Retrying it
 *    blind issues a second one. So issuance is only retried when the caller
 *    supplied an idempotency key, which makes the retry safe by construction.
 *  - **It honours `Retry-After`.** Backing off on a schedule the server did not
 *    ask for is how a rate-limited integration stays rate-limited.
 */

export class OpenCredError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'OpenCredError';
  }

  /** True for errors where retrying the same request could plausibly work. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface OpenCredOptions {
  /** API root, for example `https://credentials.example.edu`. */
  baseUrl: string;
  /** An API key (`ock_…`) or a session access token. */
  apiKey: string;
  /** Total attempts for retryable requests, including the first. Default 4. */
  maxAttempts?: number;
  /** Per-request timeout in milliseconds. Default 30 000. */
  timeoutMs?: number;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Appended to the User-Agent, so an operator can see which connector is calling. */
  userAgent?: string;
  /** Called before each retry. Useful for logging and for tests. */
  onRetry?: (info: { attempt: number; delayMs: number; error: OpenCredError }) => void;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Retry even though this is a mutation — only where the call is idempotent. */
  retryable?: boolean;
  /** Skip authentication, for the public verification endpoints. */
  anonymous?: boolean;
  raw?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OpenCred {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly onRetry?: OpenCredOptions['onRetry'];

  constructor(options: OpenCredOptions) {
    if (!options.baseUrl) throw new Error('OpenCred: baseUrl is required');
    if (!options.apiKey) throw new Error('OpenCred: apiKey is required');

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent
      ? `opencred-sdk/1.0.0 ${options.userAgent}`
      : 'opencred-sdk/1.0.0';
    this.onRetry = options.onRetry;
  }

  // --- transport ------------------------------------------------------------

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async once<T>(path: string, options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': this.userAgent,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.anonymous ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // A timeout or a socket error is transient by definition: we never got an
      // answer, so we do not know whether the server acted.
      throw new OpenCredError(
        0,
        (error as Error).name === 'AbortError' ? 'timeout' : 'network_error',
        (error as Error).message,
      );
    } finally {
      clearTimeout(timer);
    }

    if (options.raw) {
      if (!response.ok) throw await this.toError(response);
      return response as unknown as T;
    }

    if (response.status === 204) return undefined as T;
    if (!response.ok) throw await this.toError(response);

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) return (await response.json()) as T;
    return (await response.text()) as unknown as T;
  }

  private async toError(response: Response): Promise<OpenCredError> {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON body */
    }

    const error = new OpenCredError(
      response.status,
      (payload.error as string) ?? 'request_failed',
      (payload.message as string) ?? `Request failed with status ${response.status}`,
      payload.details,
      (payload.requestId as string) ?? response.headers.get('x-request-id') ?? undefined,
    );

    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) (error as { retryAfterSeconds?: number }).retryAfterSeconds = Number(retryAfter);

    return error;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const retryable = options.retryable ?? method === 'GET';

    let lastError: OpenCredError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.once<T>(path, options);
      } catch (error) {
        lastError = error as OpenCredError;

        const canRetry =
          retryable && lastError.isTransient === true && attempt < this.maxAttempts;
        const isNetwork = lastError.status === 0;

        if (!(canRetry || (retryable && isNetwork && attempt < this.maxAttempts))) {
          throw lastError;
        }

        // Honour the server's own backoff when it gave one; otherwise
        // exponential with jitter, so a fleet of connectors does not retry in
        // lockstep and re-create the spike that rate-limited them.
        const suggested = (lastError as { retryAfterSeconds?: number }).retryAfterSeconds;
        const delayMs =
          suggested !== undefined && Number.isFinite(suggested)
            ? suggested * 1000
            : Math.min(30_000, 2 ** (attempt - 1) * 500) + Math.floor(Math.random() * 250);

        this.onRetry?.({ attempt, delayMs, error: lastError });
        await sleep(delayMs);
      }
    }

    throw lastError ?? new OpenCredError(0, 'unknown', 'request failed');
  }

  // --- credentials ----------------------------------------------------------

  /**
   * Issue one credential.
   *
   * Retried automatically **only** when `idempotencyKey` is set, because that
   * is the only case where a retry cannot produce a duplicate.
   */
  async issue(request: IssueRequest): Promise<IssueResult> {
    return this.request<IssueResult>('/v1/credentials', {
      method: 'POST',
      body: request,
      retryable: Boolean(request.idempotencyKey),
    });
  }

  async getCredential(idOrPublicId: string): Promise<CredentialSummary & Record<string, unknown>> {
    return this.request(`/v1/credentials/${encodeURIComponent(idOrPublicId)}`);
  }

  async listCredentials(
    query: {
      status?: string;
      templateId?: string;
      batchId?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<Page<CredentialSummary>> {
    return this.request('/v1/credentials', { query });
  }

  /** Walks every page. Prefer this to hand-rolled cursor loops. */
  async *iterateCredentials(
    query: Omit<Parameters<OpenCred['listCredentials']>[0], 'cursor'> = {},
  ): AsyncGenerator<CredentialSummary> {
    let cursor: string | undefined;
    do {
      const page = await this.listCredentials({ ...query, cursor });
      for (const credential of page.data) yield credential;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async revoke(idOrPublicId: string, reason?: string): Promise<{ revoked: boolean }> {
    return this.request(`/v1/credentials/${encodeURIComponent(idOrPublicId)}/revoke`, {
      method: 'POST',
      body: { reason },
      // Revoking twice is harmless and the server treats it as a no-op.
      retryable: true,
    });
  }

  async update(
    idOrPublicId: string,
    patch: {
      recipientName?: string;
      recipientEmail?: string;
      title?: string;
      description?: string;
      data?: Record<string, string | number | null>;
      expiresAt?: string | null;
      reason?: string;
      notify?: boolean;
    },
  ): Promise<{ id: string; publicId: string }> {
    return this.request(`/v1/credentials/${encodeURIComponent(idOrPublicId)}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  /** The rendered PDF or PNG, as bytes. */
  async download(idOrPublicId: string, format: 'pdf' | 'png' = 'pdf'): Promise<ArrayBuffer> {
    const response = await this.request<Response>(
      `/v1/credentials/${encodeURIComponent(idOrPublicId)}/download`,
      { query: { format }, raw: true },
    );
    return response.arrayBuffer();
  }

  // --- templates ------------------------------------------------------------

  async listTemplates(): Promise<Template[]> {
    return this.request('/v1/templates');
  }

  /**
   * Find a template by name, or create it from a starter-library design.
   *
   * The single most common connector need: an integration should be able to set
   * itself up on first run rather than making an administrator paste a UUID.
   */
  async ensureTemplate(name: string, fromLibrary?: string): Promise<Template> {
    const existing = (await this.listTemplates()).find(
      (t) => t.name.toLowerCase() === name.toLowerCase() && !t.archivedAt,
    );
    if (existing) return existing;

    return this.request<Template>('/v1/templates', {
      method: 'POST',
      body: { name, ...(fromLibrary ? { fromLibrary } : {}) },
    });
  }

  // --- verification (no authentication required) ----------------------------

  async verify(publicId: string): Promise<VerificationResult> {
    return this.request(`/v1/public/credentials/${encodeURIComponent(publicId)}`, {
      anonymous: true,
    });
  }

  async verifyMany(publicIds: string[]): Promise<BulkVerificationRow[]> {
    const result = await this.request<{ results: BulkVerificationRow[] }>(
      '/v1/public/verify/bulk',
      { method: 'POST', body: { credentialIds: publicIds }, anonymous: true, retryable: true },
    );
    return result.results;
  }

  /** Verify a credential document directly, including one we did not issue. */
  async verifyDocument(
    credential: Record<string, unknown>,
    options: { checkStatus?: boolean } = {},
  ): Promise<{ verified: boolean; errors: string[]; hash: string }> {
    return this.request('/v1/public/verify', {
      method: 'POST',
      body: { credential, checkStatus: options.checkStatus ?? true },
      anonymous: true,
      retryable: true,
    });
  }

  /** The signed Open Badges 3.0 document. */
  async getCredentialDocument(publicId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/public/credentials/${encodeURIComponent(publicId)}/credential.json`, {
      anonymous: true,
    });
  }

  // --- webhooks -------------------------------------------------------------

  async createWebhook(
    url: string,
    events: string[] = [],
    description?: string,
  ): Promise<{ id: string; url: string; secret: string; events: string[] }> {
    return this.request('/v1/webhooks', {
      method: 'POST',
      body: { url, events, description },
    });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/v1/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // --- introspection --------------------------------------------------------

  /** Which workspace and role this key belongs to. Useful as a health check. */
  async whoami(): Promise<Record<string, unknown>> {
    return this.request('/v1/auth/me');
  }

  /** What this deployment is, what it supports, and what it talks to. */
  async instance(): Promise<Record<string, unknown>> {
    return this.request('/v1/instance', { anonymous: true });
  }
}
