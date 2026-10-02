# @opencred/sdk

Typed client and connector toolkit for the OpenCred API. **Zero runtime
dependencies** — it is `fetch` plus the parts every integrator would otherwise
write themselves.

```bash
npm install @opencred/sdk
```

## Issue a credential

```ts
import { OpenCred } from '@opencred/sdk';

const opencred = new OpenCred({
  baseUrl: 'https://credentials.example.edu',
  apiKey: process.env.OPENCRED_API_KEY!,
});

const result = await opencred.issue({
  templateId: 'tmpl_8f2b…',
  recipient: { name: 'Ada Lovelace', email: 'ada@example.com' },
  data: { course: 'Advanced Data Engineering', grade: 'Distinction' },
  idempotencyKey: 'course-42-user-1071',
});

console.log(result.publicId, result.deduplicated);
```

## The retry rule worth understanding

The client retries transient failures — but **it will not retry an issuance
that has no idempotency key**, and that is deliberate.

A `POST` that times out may well have issued the credential; you got no answer,
so you cannot know. Retrying blind issues a second certificate to the same
person, and the first anyone hears about it is the recipient. With an
idempotency key the retry is safe by construction, so the client retries freely.

```ts
// Retried on 5xx/429/network failure — safe, the key makes it idempotent.
await opencred.issue({ …, idempotencyKey: `course-${courseId}-user-${userId}` });

// Never retried. One attempt, and a transient failure surfaces to you.
await opencred.issue({ … });
```

`Retry-After` is honoured when the server sends it. Otherwise backoff is
exponential with jitter, so a fleet of connectors does not retry in lockstep and
recreate the spike that rate-limited them.

## Verify

Verification needs no credentials at all — that is the point of the product.

```ts
const result = await opencred.verify('k7m2q9xb4t');
if (!result.valid) console.log(result.status, result.errors);

// A column of IDs off candidate CVs, in one call
const rows = await opencred.verifyMany(['k7m2q9xb4t', 'j4h8p2mq7v']);

// Or a credential document you were handed — including one we did not issue
const check = await opencred.verifyDocument(credentialJson);
```

## Webhooks

```ts
import express from 'express';
import { verifyWebhook } from '@opencred/sdk';

const app = express();

// The RAW body. Not express.json().
app.post('/hooks/opencred', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook({
      payload: req.body,
      signature: req.get('x-opencred-signature'),
      secret: process.env.OPENCRED_WEBHOOK_SECRET!,
    });

    if (event.type === 'credential.issued') {
      // Deliveries are at-least-once. Make this idempotent on event.id.
    }

    res.sendStatus(200);
  } catch {
    res.sendStatus(401);
  }
});
```

`verifyWebhook` throws rather than returning `false`, so a handler that forgets
to check the result still fails closed. Use `tryVerifyWebhook` if you would
rather branch.

**Verify the raw bytes, not the parsed object.** `JSON.parse` followed by
`JSON.stringify` does not round-trip byte-for-byte — key order and number
formatting can both change — so re-serialising before hashing produces a
mismatch that looks like an attack and is not. This is the mistake almost
everyone makes once.

## Building a connector

A connector turns an event in another system into an issued credential. Extend
`Connector`, implement `map()`, and the toolkit handles idempotency, partial
failure and concurrency.

```ts
import { Connector, type IssueRequest } from '@opencred/sdk';

interface Completion {
  studentName: string;
  studentEmail: string;
  studentId: string;
  courseId: number;
  courseName: string;
  finalGrade: string | null;
  completedAt: string;
}

class CourseCompletionConnector extends Connector<Completion> {
  get name() {
    return 'acme-lms';
  }

  map(source: Completion): IssueRequest {
    return {
      templateId: process.env.OPENCRED_TEMPLATE_ID!,
      recipient: {
        name: source.studentName,
        email: source.studentEmail,
        externalId: source.studentId,
      },
      title: source.courseName,
      data: {
        course: source.courseName,
        ...(source.finalGrade ? { grade: source.finalGrade } : {}),
      },
      issuedAt: source.completedAt,
      achievement: { achievementType: 'CertificateOfCompletion' },
    };
  }

  // Override this. The default keys on template + email, which is right for
  // "one credential per person per course" and wrong for anything that can
  // legitimately be issued twice.
  idempotencyKeyFor(source: Completion): string {
    return `acme-lms:${source.courseId}:${source.studentId}`;
  }

  shouldSkip(source: Completion): string | null {
    if (!source.studentEmail) return 'no email address';
    if (source.studentEmail.endsWith('@test.invalid')) return 'test account';
    return null;
  }
}
```

Then run it:

```ts
const connector = new CourseCompletionConnector({
  baseUrl: process.env.OPENCRED_URL!,
  apiKey: process.env.OPENCRED_API_KEY!,
  concurrency: 4,
});

// Fail loudly at start-up rather than when a cohort completes
const ready = await connector.preflight();
if (!ready.ok) throw new Error(`OpenCred unreachable: ${ready.error}`);
console.log(`Issuing into ${ready.workspace} as ${ready.role}`);

const outcome = await connector.run(completions);
console.log(
  `${outcome.issued.length} issued, ${outcome.deduplicated} already existed, ` +
    `${outcome.skipped.length} skipped, ${outcome.failed.length} failed`,
);
```

`run()` never throws for an individual record. One malformed address out of
three hundred issues the other 299 and reports the one, because aborting a
cohort over one bad row is not an acceptable failure mode.

Use `--dry-run` behaviour via `dryRun: true` to see what *would* happen before
issuing anything real.

## Things worth knowing

**Use an `issuer` key.** It can issue and revoke and nothing else. A long-lived
machine credential that can also change billing is a blast radius nobody needs.
Keys can never be minted as `owner`.

**Pagination.** `iterateCredentials()` walks every page for you:

```ts
for await (const credential of opencred.iterateCredentials({ status: 'issued' })) {
  … 
}
```

**Self-hosted installs are first-class.** `baseUrl` is a required constructor
argument, not a default pointing at a vendor. Most institutions running this
will be running their own.

**Errors are typed.** `OpenCredError` carries `status`, a stable `code`, and the
`requestId` an operator needs to find the request in the logs. `isTransient`
tells you whether retrying could plausibly help.

## Licence

AGPL-3.0-or-later, like the platform.
