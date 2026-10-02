import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEvent } from './types';

/**
 * Webhook signature verification.
 *
 * This exists because the alternative is every integrator writing it, and the
 * three mistakes are always the same:
 *
 *  1. Verifying against the *parsed* body. `JSON.parse` then `JSON.stringify`
 *     does not round-trip byte-for-byte — key order and number formatting can
 *     both change — so the HMAC will not match. You must verify the raw bytes.
 *  2. Comparing with `===`, which leaks the signature a character at a time to
 *     an attacker who can time the response.
 *  3. Ignoring the timestamp, which leaves a captured payload replayable
 *     forever.
 *
 * All three are handled here.
 */

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'missing_signature'
      | 'malformed_signature'
      | 'timestamp_out_of_tolerance'
      | 'signature_mismatch',
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface VerifyWebhookOptions {
  /**
   * The **raw** request body, exactly as received. Not the parsed object.
   * In Express: `express.raw({ type: 'application/json' })`.
   */
  payload: string | Buffer;
  /** The `X-OpenCred-Signature` header. */
  signature: string | undefined | null;
  /** The endpoint's signing secret, shown once when the webhook was created. */
  secret: string;
  /** Replay tolerance in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Injected in tests. */
  now?: number;
}

/**
 * Verify a delivery and return the parsed event.
 *
 * Throws `WebhookVerificationError` rather than returning false, so a handler
 * that forgets to check the result still fails closed.
 */
export function verifyWebhook<T = Record<string, unknown>>(
  options: VerifyWebhookOptions,
): WebhookEvent<T> {
  const { signature, secret, payload } = options;
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now();

  if (!signature) {
    throw new WebhookVerificationError('no signature header present', 'missing_signature');
  }

  // `t=<unix seconds>,v1=<hex hmac>`
  const parts: Record<string, string> = {};
  for (const chunk of signature.split(',')) {
    const [key, ...rest] = chunk.trim().split('=');
    if (key) parts[key] = rest.join('=');
  }

  if (!parts.t || !parts.v1) {
    throw new WebhookVerificationError(
      'signature header is not in the form t=…,v1=…',
      'malformed_signature',
    );
  }

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) {
    throw new WebhookVerificationError('signature timestamp is not a number', 'malformed_signature');
  }

  const ageSeconds = Math.abs(now / 1000 - timestamp);
  if (ageSeconds > tolerance) {
    throw new WebhookVerificationError(
      `signature timestamp is ${Math.round(ageSeconds)}s old, outside the ${tolerance}s tolerance`,
      'timestamp_out_of_tolerance',
    );
  }

  const raw = typeof payload === 'string' ? payload : payload.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookVerificationError(
      'signature does not match the payload',
      'signature_mismatch',
    );
  }

  return JSON.parse(raw) as WebhookEvent<T>;
}

/**
 * Non-throwing variant, for handlers that want to log and return 401 rather
 * than let an exception escape.
 */
export function tryVerifyWebhook<T = Record<string, unknown>>(
  options: VerifyWebhookOptions,
): { ok: true; event: WebhookEvent<T> } | { ok: false; error: WebhookVerificationError } {
  try {
    return { ok: true, event: verifyWebhook<T>(options) };
  } catch (error) {
    return { ok: false, error: error as WebhookVerificationError };
  }
}
