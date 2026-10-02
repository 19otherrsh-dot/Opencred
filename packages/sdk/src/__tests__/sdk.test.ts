import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { OpenCred, OpenCredError } from '../client';
import { verifyWebhook, tryVerifyWebhook, WebhookVerificationError } from '../webhooks';
import { Connector } from '../connector';
import type { IssueRequest } from '../types';

/** A scriptable fetch, so the retry rules can be tested without a server. */
function stubFetch(responses: Array<Response | (() => Response)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;

  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;

  return { impl, calls, get callCount() { return index; } };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function client(fetchImpl: typeof fetch, options = {}) {
  return new OpenCred({
    baseUrl: 'https://credentials.example.edu',
    apiKey: 'ock_test_key',
    fetch: fetchImpl,
    maxAttempts: 3,
    ...options,
  });
}

// --- construction ----------------------------------------------------------

test('the client refuses to be constructed without a base URL or key', () => {
  assert.throws(() => new OpenCred({ baseUrl: '', apiKey: 'k' }), /baseUrl is required/);
  assert.throws(
    () => new OpenCred({ baseUrl: 'https://x', apiKey: '' }),
    /apiKey is required/,
  );
});

test('a trailing slash on the base URL does not produce a double slash', async () => {
  const stub = stubFetch([json([])]);
  const sdk = new OpenCred({
    baseUrl: 'https://credentials.example.edu/',
    apiKey: 'k',
    fetch: stub.impl,
  });
  await sdk.listTemplates();
  assert.equal(stub.calls[0].url, 'https://credentials.example.edu/v1/templates');
});

test('requests carry bearer auth and an identifying user agent', async () => {
  const stub = stubFetch([json([])]);
  await client(stub.impl, { userAgent: 'my-connector/2.0' }).listTemplates();

  const headers = stub.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer ock_test_key');
  assert.match(headers['user-agent'], /opencred-sdk\/1\.0\.0 my-connector\/2\.0/);
});

test('public verification endpoints are called without credentials', async () => {
  const stub = stubFetch([json({ valid: true })]);
  await client(stub.impl).verify('k7m2q9xb4t');

  const headers = stub.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, undefined, 'a verifier must not need our key');
});

// --- the retry rules -------------------------------------------------------

test('issuance WITHOUT an idempotency key is never retried', async () => {
  // The important one. A POST that timed out may already have issued the
  // credential; retrying blind would issue a second.
  const stub = stubFetch([json({ error: 'internal_error', message: 'boom' }, 500)]);

  await assert.rejects(
    client(stub.impl).issue({
      templateId: 't',
      recipient: { name: 'A', email: 'a@example.com' },
    }),
    (error: OpenCredError) => error.status === 500,
  );

  assert.equal(stub.callCount, 1, 'must not retry a non-idempotent issuance');
});

test('issuance WITH an idempotency key is retried and succeeds', async () => {
  const stub = stubFetch([
    json({ error: 'internal_error', message: 'boom' }, 500),
    json({ id: 'c1', publicId: 'k7m2q9xb4t', status: 'draft', deduplicated: false }),
  ]);

  const result = await client(stub.impl).issue({
    templateId: 't',
    recipient: { name: 'A', email: 'a@example.com' },
    idempotencyKey: 'course-42-user-7',
  });

  assert.equal(result.publicId, 'k7m2q9xb4t');
  assert.equal(stub.callCount, 2);
});

test('a 4xx is never retried, even when idempotent', async () => {
  const stub = stubFetch([json({ error: 'missing_merge_fields', message: 'need course' }, 400)]);

  await assert.rejects(
    client(stub.impl).issue({
      templateId: 't',
      recipient: { name: 'A', email: 'a@example.com' },
      idempotencyKey: 'k',
    }),
    (error: OpenCredError) => error.code === 'missing_merge_fields' && !error.isTransient,
  );

  assert.equal(stub.callCount, 1, 'retrying a validation error just wastes time');
});

test('Retry-After from the server is honoured over our own backoff', async () => {
  const stub = stubFetch([
    json({ error: 'rate_limited', message: 'slow down' }, 429, { 'retry-after': '0' }),
    json([]),
  ]);

  const delays: number[] = [];
  const sdk = client(stub.impl, { onRetry: (i: { delayMs: number }) => delays.push(i.delayMs) });

  await sdk.listTemplates();
  assert.equal(delays[0], 0, 'must use the server-supplied delay, not exponential backoff');
});

test('attempts are capped', async () => {
  const stub = stubFetch([json({ error: 'internal_error', message: 'boom' }, 500)]);
  await assert.rejects(client(stub.impl, { maxAttempts: 3 }).listTemplates());
  assert.equal(stub.callCount, 3);
});

test('a network failure is transient and surfaces a typed error', async () => {
  const failing = (async () => {
    throw new Error('socket hang up');
  }) as unknown as typeof fetch;

  await assert.rejects(
    client(failing, { maxAttempts: 2 }).listTemplates(),
    (error: OpenCredError) => error.status === 0 && error.code === 'network_error',
  );
});

test('errors carry the request id so an operator can find the request', async () => {
  const stub = stubFetch([
    json({ error: 'internal_error', message: 'boom', requestId: 'req_abc' }, 500),
  ]);

  await assert.rejects(
    client(stub.impl, { maxAttempts: 1 }).listTemplates(),
    (error: OpenCredError) => error.requestId === 'req_abc',
  );
});

// --- pagination ------------------------------------------------------------

test('iterateCredentials walks every page', async () => {
  const stub = stubFetch([
    json({ data: [{ id: '1' }, { id: '2' }], nextCursor: 'c1' }),
    json({ data: [{ id: '3' }], nextCursor: null }),
  ]);

  const seen: string[] = [];
  for await (const credential of client(stub.impl).iterateCredentials()) {
    seen.push(credential.id);
  }

  assert.deepEqual(seen, ['1', '2', '3']);
  assert.match(stub.calls[1].url, /cursor=c1/);
});

// --- templates -------------------------------------------------------------

test('ensureTemplate reuses an existing template rather than creating duplicates', async () => {
  const stub = stubFetch([
    json([{ id: 't1', name: 'Course Certificate', archivedAt: null }]),
  ]);

  const template = await client(stub.impl).ensureTemplate('course certificate');
  assert.equal(template.id, 't1');
  assert.equal(stub.callCount, 1, 'must not POST when a match already exists');
});

test('ensureTemplate ignores archived templates and creates a fresh one', async () => {
  const stub = stubFetch([
    json([{ id: 'old', name: 'Course Certificate', archivedAt: '2026-01-01T00:00:00Z' }]),
    json({ id: 'new', name: 'Course Certificate' }),
  ]);

  const template = await client(stub.impl).ensureTemplate('Course Certificate', 'modern-minimal-cobalt');
  assert.equal(template.id, 'new');
  assert.equal(JSON.parse(String(stub.calls[1].init.body)).fromLibrary, 'modern-minimal-cobalt');
});

// --- webhook verification --------------------------------------------------

const SECRET = 'whsec_test';

function signedDelivery(body: unknown, atMs = Date.now(), secret = SECRET) {
  const raw = JSON.stringify(body);
  const t = Math.floor(atMs / 1000).toString();
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return { raw, signature: `t=${t},v1=${v1}` };
}

test('a correctly signed delivery verifies and returns the parsed event', () => {
  const body = { id: 'evt_1', type: 'credential.issued', data: { publicId: 'k7m2q9xb4t' } };
  const { raw, signature } = signedDelivery(body);

  const event = verifyWebhook({ payload: raw, signature, secret: SECRET });
  assert.equal(event.id, 'evt_1');
  assert.equal(event.type, 'credential.issued');
});

test('verification works on a Buffer body, which is what a raw body parser gives you', () => {
  const body = { id: 'evt_1', type: 'credential.issued' };
  const { raw, signature } = signedDelivery(body);

  const event = verifyWebhook({ payload: Buffer.from(raw, 'utf8'), signature, secret: SECRET });
  assert.equal(event.id, 'evt_1');
});

test('a tampered payload is rejected', () => {
  const { signature } = signedDelivery({ id: 'evt_1', amount: 1 });
  assert.throws(
    () => verifyWebhook({ payload: JSON.stringify({ id: 'evt_1', amount: 1000 }), signature, secret: SECRET }),
    (e: WebhookVerificationError) => e.reason === 'signature_mismatch',
  );
});

test('the wrong secret is rejected', () => {
  const { raw, signature } = signedDelivery({ id: 'evt_1' }, Date.now(), 'whsec_other');
  assert.throws(
    () => verifyWebhook({ payload: raw, signature, secret: SECRET }),
    (e: WebhookVerificationError) => e.reason === 'signature_mismatch',
  );
});

test('an old delivery is rejected, so a captured payload cannot be replayed', () => {
  const { raw, signature } = signedDelivery({ id: 'evt_1' }, Date.now() - 10 * 60_000);
  assert.throws(
    () => verifyWebhook({ payload: raw, signature, secret: SECRET }),
    (e: WebhookVerificationError) => e.reason === 'timestamp_out_of_tolerance',
  );
});

test('a missing or malformed signature header is rejected', () => {
  assert.throws(
    () => verifyWebhook({ payload: '{}', signature: undefined, secret: SECRET }),
    (e: WebhookVerificationError) => e.reason === 'missing_signature',
  );
  assert.throws(
    () => verifyWebhook({ payload: '{}', signature: 'garbage', secret: SECRET }),
    (e: WebhookVerificationError) => e.reason === 'malformed_signature',
  );
});

test('tryVerifyWebhook reports failure without throwing', () => {
  const outcome = tryVerifyWebhook({ payload: '{}', signature: undefined, secret: SECRET });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.reason, 'missing_signature');
});

// --- connector -------------------------------------------------------------

interface Completion {
  studentName: string;
  studentEmail: string;
  courseId: number;
  courseName: string;
}

class TestConnector extends Connector<Completion> {
  get name() {
    return 'test-lms';
  }

  map(source: Completion): IssueRequest {
    return {
      templateId: 'tmpl_1',
      recipient: { name: source.studentName, email: source.studentEmail },
      data: { course: source.courseName },
    };
  }

  idempotencyKeyFor(source: Completion): string {
    return `test-lms:${source.courseId}:${source.studentEmail}`;
  }

  shouldSkip(source: Completion): string | null {
    return source.studentEmail.endsWith('@test.invalid') ? 'test account' : null;
  }
}

const completion = (i: number): Completion => ({
  studentName: `Student ${i}`,
  studentEmail: `student${i}@example.com`,
  courseId: 42,
  courseName: 'Data Engineering',
});

test('a connector issues for every record and derives a stable idempotency key', async () => {
  const stub = stubFetch([
    () => json({ id: 'c', publicId: 'p', status: 'draft', deduplicated: false }),
  ]);

  const connector = new TestConnector({
    baseUrl: 'https://x',
    apiKey: 'k',
    fetch: stub.impl,
    concurrency: 1,
  });

  const result = await connector.run([completion(1), completion(2)]);

  assert.equal(result.issued.length, 2);
  assert.equal(result.failed.length, 0);

  const sent = JSON.parse(String(stub.calls[0].init.body));
  assert.equal(sent.idempotencyKey, 'test-lms:42:student1@example.com');
});

test('one bad record does not abort the run', async () => {
  let call = 0;
  const impl = (async () => {
    call += 1;
    return call === 2
      ? json({ error: 'missing_merge_fields', message: 'no course' }, 400)
      : json({ id: 'c', publicId: 'p', status: 'draft', deduplicated: false });
  }) as unknown as typeof fetch;

  const connector = new TestConnector({
    baseUrl: 'https://x',
    apiKey: 'k',
    fetch: impl,
    concurrency: 1,
  });

  const result = await connector.run([completion(1), completion(2), completion(3)]);

  assert.equal(result.issued.length, 2, 'the other records must still be issued');
  assert.equal(result.failed.length, 1);
});

test('skipped records are reported rather than silently dropped', async () => {
  const stub = stubFetch([json({ id: 'c', publicId: 'p', status: 'draft', deduplicated: false })]);
  const connector = new TestConnector({ baseUrl: 'https://x', apiKey: 'k', fetch: stub.impl });

  const result = await connector.run([
    completion(1),
    { ...completion(2), studentEmail: 'bot@test.invalid' },
  ]);

  assert.equal(result.issued.length, 1);
  assert.deepEqual(result.skipped.map((s) => s.reason), ['test account']);
});

test('deduplicated responses are counted separately from fresh issuances', async () => {
  const stub = stubFetch([json({ id: 'c', publicId: 'p', status: 'issued', deduplicated: true })]);
  const connector = new TestConnector({ baseUrl: 'https://x', apiKey: 'k', fetch: stub.impl });

  const result = await connector.run([completion(1)]);
  assert.equal(result.deduplicated, 1);
});

test('a dry run issues nothing', async () => {
  const stub = stubFetch([json({})]);
  const connector = new TestConnector({
    baseUrl: 'https://x',
    apiKey: 'k',
    fetch: stub.impl,
    dryRun: true,
  });

  const result = await connector.run([completion(1), completion(2)]);
  assert.equal(result.issued.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(stub.callCount, 0, 'a dry run must not call the API at all');
});

test('preflight reports the workspace a key belongs to', async () => {
  const stub = stubFetch([json({ organization: { name: 'Example University' }, role: 'issuer' })]);
  const connector = new TestConnector({ baseUrl: 'https://x', apiKey: 'k', fetch: stub.impl });

  const check = await connector.preflight();
  assert.equal(check.ok, true);
  assert.equal(check.workspace, 'Example University');
  assert.equal(check.role, 'issuer');
});

test('preflight fails softly on a bad key rather than throwing at start-up', async () => {
  const stub = stubFetch([json({ error: 'unauthorized', message: 'invalid API key' }, 401)]);
  const connector = new TestConnector({ baseUrl: 'https://x', apiKey: 'bad', fetch: stub.impl });

  const check = await connector.preflight();
  assert.equal(check.ok, false);
  assert.match(check.error ?? '', /invalid API key/);
});
