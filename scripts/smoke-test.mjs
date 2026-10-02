#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Exercises the whole product against a running API: signup, issuance,
 * signing, verification, tamper detection, bulk CSV issuance, post-issuance
 * editing, revocation, status lists, DID resolution and data export.
 *
 * This is deliberately a black-box test that speaks only HTTP and the public
 * credential format. If it passes, an integrator following the published API
 * docs can do everything it does.
 *
 *   node scripts/smoke-test.mjs [--api http://localhost:4000]
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { verifyCredential, verifyDocument } from '../packages/credentials/dist/index.js';

const API = argValue('--api') ?? process.env.API_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;
const failures = [];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  FAIL ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

let token = null;

async function call(path, { method = 'GET', body, headers = {}, raw = false, formData } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(formData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (raw) return response;

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

/** Poll until a credential leaves the `draft` state, or give up. */
async function waitForIssuance(publicId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await call(`/v1/public/credentials/${publicId}`);
    if (response.status === 200) return response.body;
    await sleep(500);
  }
  return null;
}

async function main() {
  process.stdout.write(`OpenCred smoke test against ${API}\n`);

  // ---------------------------------------------------------------- health --
  section('Instance');
  const health = await call('/healthz');
  check('healthz responds', health.status === 200, `status ${health.status}`);

  const ready = await call('/readyz');
  check('readyz reports the database and queue', ready.body?.checks?.database === true && ready.body?.checks?.queue === true, JSON.stringify(ready.body?.checks));

  const instance = await call('/v1/instance');
  check('instance advertises Open Badges 3.0', instance.body?.capabilities?.openBadges3 === true);
  check('instance advertises W3C VC support', instance.body?.capabilities?.w3cVerifiableCredentials === true);
  process.stdout.write(`       rendering: ${instance.body?.capabilities?.rendering}\n`);

  // --------------------------------------------------------------- pricing --
  section('Pricing (FR-BIL-03)');
  const plans = await call('/v1/billing/plans');
  check('plan catalogue is public', plans.status === 200);
  check('no plan charges a setup fee', plans.body?.plans?.every((p) => p.setupFeeCents === 0));
  check('no plan requires an annual contract', plans.body?.plans?.every((p) => p.annualContractRequired === false));
  const enterprise = plans.body?.plans?.find((p) => p.id === 'enterprise');
  check('enterprise publishes a starting price', typeof enterprise?.startingAtCents === 'number', 'enterprise pricing is sales-gated');

  // ------------------------------------------------------------ onboarding --
  section('Signup and workspace (FR-ID-01)');
  const stamp = Date.now();
  const email = `smoke-${stamp}@opencred.test`;
  const register = await call('/v1/auth/register', {
    method: 'POST',
    body: {
      organizationName: `Smoke Test College ${stamp}`,
      name: 'Smoke Tester',
      email,
      password: 'a-sufficiently-long-password',
    },
  });
  check('workspace created', register.status === 201 || register.status === 200, JSON.stringify(register.body).slice(0, 200));
  token = register.body?.accessToken;
  check('session issued', typeof token === 'string');
  const orgSlug = register.body?.organization?.slug;

  const me = await call('/v1/auth/me');
  check('caller is the owner', me.body?.role === 'owner');

  // --------------------------------------------------------------- library --
  section('Template library (FR-DES-03)');
  const library = await call('/v1/templates/library');
  check('library has at least 150 templates', (library.body?.templates?.length ?? 0) >= 150, `${library.body?.templates?.length} found`);

  const templates = await call('/v1/templates');
  check('new workspace is seeded with starter templates', (templates.body?.length ?? 0) >= 1, `${templates.body?.length} templates`);
  check('seeded templates include a certificate and a badge', templates.body?.some((t) => t.kind === 'certificate') && templates.body?.some((t) => t.kind === 'badge'));
  const templateId = templates.body?.find((t) => t.kind === 'certificate')?.id;

  // ---------------------------------------------------------------- RBAC ----
  section('Role-based access control (FR-ID-02)');
  const keyResponse = await call('/v1/org/api-keys', {
    method: 'POST',
    body: { name: 'smoke-viewer', role: 'viewer' },
  });
  check('API key minted', keyResponse.status === 201 || keyResponse.status === 200);
  const viewerKey = keyResponse.body?.secret;
  check('secret returned once', typeof viewerKey === 'string' && viewerKey.startsWith('ock_'));

  const viewerIssue = await call('/v1/credentials', {
    method: 'POST',
    headers: { authorization: `Bearer ${viewerKey}` },
    body: {
      templateId,
      recipient: { name: 'Should Fail', email: 'nope@example.com' },
      data: { course: 'Nope' },
    },
  });
  check('viewer key cannot issue', viewerIssue.status === 403, `got ${viewerIssue.status}`);

  const viewerRead = await call('/v1/templates', { headers: { authorization: `Bearer ${viewerKey}` } });
  check('viewer key can read', viewerRead.status === 200);

  const noAuth = await call('/v1/credentials', { method: 'POST', headers: { authorization: '' }, body: {} });
  check('unauthenticated issuance is rejected', noAuth.status === 401, `got ${noAuth.status}`);

  // ------------------------------------------------------------- issuance ---
  section('Single issuance (FR-ISS-02, FR-ISS-04)');
  const idempotencyKey = `smoke-${stamp}`;
  const issue = await call('/v1/credentials', {
    method: 'POST',
    body: {
      templateId,
      recipient: { name: 'Ada Lovelace', email: `ada-${stamp}@example.com`, externalId: `EXT-${stamp}` },
      title: 'Analytical Engine Programming',
      data: { course: 'Analytical Engine Programming', grade: 'Distinction', hours: '120' },
      achievement: { achievementType: 'Certificate', skills: ['Algorithms', 'Computation'] },
      idempotencyKey,
      suppressEmail: true,
    },
  });
  check('issuance accepted', issue.status === 202, `got ${issue.status}: ${JSON.stringify(issue.body).slice(0, 200)}`);
  const publicId = issue.body?.publicId;
  check('public identifier returned', typeof publicId === 'string' && publicId.length >= 8);

  const replay = await call('/v1/credentials', {
    method: 'POST',
    body: {
      templateId,
      recipient: { name: 'Ada Lovelace', email: `ada-${stamp}@example.com` },
      data: { course: 'Analytical Engine Programming' },
      idempotencyKey,
    },
  });
  check('idempotency key prevents a duplicate', replay.body?.deduplicated === true && replay.body?.publicId === publicId);

  const missingField = await call('/v1/credentials', {
    method: 'POST',
    body: {
      templateId,
      recipient: { name: 'No Course', email: `nocourse-${stamp}@example.com` },
      data: {},
    },
  });
  check('missing merge fields are rejected before issuance', missingField.status === 400, `got ${missingField.status}`);

  // ---------------------------------------------------------- verification --
  section('Verification (FR-VER-01, FR-VER-02, FR-VER-03)');
  const verified = await waitForIssuance(publicId);
  check('credential becomes publicly verifiable', verified !== null, 'timed out waiting for the worker');

  if (verified) {
    check('reported valid', verified.valid === true, JSON.stringify(verified.errors));
    check('signature check passed', verified.checks?.signatureValid === true);
    check('not revoked', verified.checks?.notRevoked === true);
    check('not expired', verified.checks?.notExpired === true);
    check('issuer DID present', typeof verified.issuer?.did === 'string' && verified.issuer.did.startsWith('did:web:'));
    check('recipient email hidden by default', verified.recipient?.email === null, 'public page leaked the recipient address');
  }

  const document = await call(`/v1/public/credentials/${publicId}/credential.json`);
  check('signed credential document served', document.status === 200);
  const credential = document.body;

  check('is an Open Badges 3.0 credential', Array.isArray(credential?.type) && credential.type.includes('OpenBadgeCredential'));
  check('is a W3C Verifiable Credential', Array.isArray(credential?.type) && credential.type.includes('VerifiableCredential'));
  check('uses the VC 2.0 context', credential?.['@context']?.[0] === 'https://www.w3.org/ns/credentials/v2');
  check('uses the Open Badges 3.0 context', credential?.['@context']?.includes('https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'));
  check('carries a data integrity proof', credential?.proof?.type === 'DataIntegrityProof');
  check('uses the eddsa-jcs-2022 cryptosuite', credential?.proof?.cryptosuite === 'eddsa-jcs-2022');
  check('carries a bitstring status list entry', credential?.credentialStatus?.type === 'BitstringStatusListEntry');
  check(
    'recipient email is hashed, not embedded',
    credential?.credentialSubject?.identifier?.[0]?.hashed === true &&
      !JSON.stringify(credential).includes(`ada-${stamp}@example.com`),
    'plaintext recipient address found inside the signed credential',
  );

  // --- Offline verification, the way a third party would do it --------------
  section('Independent verification');
  const didUrl = `/v1/public/issuers/${orgSlug}/did.json`;
  const didDocument = await call(didUrl);
  check('DID document resolves', didDocument.status === 200 && Array.isArray(didDocument.body?.verificationMethod));

  const offline = await verifyCredential(credential, {
    fetchDocument: async () => didDocument.body,
    fetchStatusList: async (url) => {
      const path = new URL(url).pathname;
      const list = await call(path);
      return list.body;
    },
  });
  check('verifies offline against the published DID document', offline.verified === true, offline.errors.join('; '));
  check('status list resolved and clean', offline.checks.status.checked === true && offline.checks.status.revoked === false);

  const tampered = JSON.parse(JSON.stringify(credential ?? {}));
  if (tampered?.credentialSubject?.achievement) {
    tampered.credentialSubject.achievement.name = 'Nobel Prize in Physics';
  }
  const tamperResult = await verifyDocument(tampered, { fetchDocument: async () => didDocument.body });
  check('tampering invalidates the signature', tamperResult.verified === false, 'a modified credential still verified');

  const submitted = await call('/v1/public/verify', {
    method: 'POST',
    body: { credential: tampered, checkStatus: false },
  });
  check('the public verify endpoint rejects the tampered copy', submitted.body?.verified === false);

  // --------------------------------------------------------- bulk issuance --
  section('Bulk issuance (FR-REC-01, FR-ISS-01)');
  const rows = Array.from({ length: 25 }, (_, i) => `Student ${i + 1},student${i + 1}-${stamp}@example.com,Data Engineering,Merit`);
  // Two deliberately broken rows: the validator must find both.
  rows.push('Broken Email,not-an-email,Data Engineering,Pass');
  rows.push(`,duplicate${stamp}@example.com,Data Engineering,Pass`);
  const csv = ['Full Name,Email Address,Course,Grade', ...rows].join('\n');

  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'cohort.csv');
  form.set('templateId', templateId);
  form.set('name', 'Smoke cohort');

  const upload = await call('/v1/batches/upload', { method: 'POST', formData: form });
  check('CSV uploaded', upload.status === 200, JSON.stringify(upload.body).slice(0, 200));
  check('columns auto-mapped', upload.body?.suggestedMapping?.['recipient.email'] === 'Email Address' && upload.body?.suggestedMapping?.['recipient.name'] === 'Full Name');
  check('required fields reported', Array.isArray(upload.body?.requiredFields));

  const batchId = upload.body?.batchId;
  const validation = await call(`/v1/batches/${batchId}/validate`, {
    method: 'POST',
    body: { mapping: upload.body?.suggestedMapping ?? {}, defaults: {} },
  });
  check('validation ran on every row', validation.body?.totalRows === 27, `${validation.body?.totalRows} rows`);
  check('invalid email detected', validation.body?.issues?.some((i) => i.code === 'invalid_email'));
  check('missing name detected', validation.body?.issues?.some((i) => i.code === 'missing' && i.field === 'recipient.name'));
  check('valid rows counted', validation.body?.validRows === 25, `${validation.body?.validRows} valid`);

  const strict = await call(`/v1/batches/${batchId}/issue`, { method: 'POST', body: { skipInvalidRows: false } });
  check('issuing with known-bad rows is refused by default', strict.status === 400, `got ${strict.status}`);

  const issued = await call(`/v1/batches/${batchId}/issue`, {
    method: 'POST',
    body: { skipInvalidRows: true, suppressEmail: true },
  });
  check('batch accepted', issued.status === 202, JSON.stringify(issued.body).slice(0, 200));
  check('25 credentials queued, 2 skipped', issued.body?.queued === 25 && issued.body?.skipped === 2, JSON.stringify(issued.body));

  // ------------------------------------------------- post-issuance editing --
  section('Post-issuance editing (FR-ISS-05)');
  const before = await call(`/v1/credentials/${publicId}`);
  const credentialId = before.body?.id;
  const patch = await call(`/v1/credentials/${credentialId}`, {
    method: 'PATCH',
    body: { recipientName: 'Ada King, Countess of Lovelace', reason: 'name correction', notify: false },
  });
  check('correction accepted', patch.status === 200, JSON.stringify(patch.body).slice(0, 200));

  let corrected = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const check2 = await call(`/v1/public/credentials/${publicId}`);
    if (check2.body?.recipient?.name?.includes('Countess')) {
      corrected = check2.body;
      break;
    }
  }
  check('correction applied and re-signed', corrected !== null, 'timed out waiting for the re-render');
  check('public identifier preserved', corrected?.publicId === publicId, 'the QR code would have broken');
  if (corrected) check('still verifies after the edit', corrected.valid === true, JSON.stringify(corrected.errors));

  // ------------------------------------------------------------ revocation --
  section('Revocation (FR-ISS-06)');
  const revoke = await call(`/v1/credentials/${credentialId}/revoke`, {
    method: 'POST',
    body: { reason: 'issued in error during a smoke test' },
  });
  check('revocation accepted', revoke.status === 200);

  const afterRevoke = await call(`/v1/public/credentials/${publicId}`);
  check('verification page shows revoked immediately', afterRevoke.body?.status === 'revoked' && afterRevoke.body?.valid === false);
  check('revocation reason surfaced', typeof afterRevoke.body?.credential?.revocationReason === 'string');

  const revokedDocument = await call(`/v1/public/credentials/${publicId}/credential.json`);
  const revokedOffline = await verifyCredential(revokedDocument.body, {
    fetchDocument: async () => didDocument.body,
    fetchStatusList: async (url) => (await call(new URL(url).pathname)).body,
  });
  check(
    'a third party sees the revocation through the status list',
    revokedOffline.verified === false && revokedOffline.checks.status.revoked === true,
    JSON.stringify(revokedOffline.checks.status),
  );

  // -------------------------------------------------------------- analytics --
  section('Analytics and export (FR-ANA, FR-REC-04)');
  const overview = await call('/v1/analytics/overview');
  check('analytics overview available', overview.status === 200 && typeof overview.body?.credentials?.total === 'number');

  const events = await call(`/v1/analytics/credentials/${credentialId}/events`);
  check('per-credential event history recorded', Array.isArray(events.body) && events.body.length > 0, `${events.body?.length} events`);
  check('edit and revocation are in the history', events.body?.some((e) => e.type === 'edited') && events.body?.some((e) => e.type === 'revoked'));

  const exportResponse = await call('/v1/credentials/export.csv', { raw: true });
  const exportText = await exportResponse.text();
  check('CSV export streams without contacting support', exportResponse.status === 200 && exportText.split('\n').length > 2, `${exportText.split('\n').length} lines`);
  check('export includes the credential hash', exportText.includes('credential_hash'));

  // ------------------------------------------------------- bulk verification --
  section('Bulk verification (FR-VER-05)');
  const bulk = await call('/v1/public/verify/bulk', {
    method: 'POST',
    body: { credentialIds: [publicId, 'doesnotexist99'] },
  });
  check('bulk verification answers for every id', bulk.body?.results?.length === 2);
  check('unknown ids are reported as not found', bulk.body?.results?.some((r) => r.found === false));

  // ------------------------------------------------------------- webhooks ---
  section('Webhooks (FR-INT-02)');
  const webhookEvents = await call('/v1/webhooks/events');
  check('event catalogue documented', Array.isArray(webhookEvents.body?.events) && webhookEvents.body.events.includes('credential.issued'));
  check('delivery guarantee stated', webhookEvents.body?.delivery?.guarantee === 'at-least-once');

  // -------------------------------------------------------------- API docs --
  section('Developer experience (FR-INT-01)');
  const openapi = await call('/docs/openapi.json');
  check('OpenAPI document generated from the server', openapi.status === 200 && typeof openapi.body?.paths === 'object');
  const pathCount = Object.keys(openapi.body?.paths ?? {}).length;
  check('documents a substantial API surface', pathCount >= 30, `${pathCount} paths`);

  // ---------------------------------------------------------------- result --
  process.stdout.write(`\n${'='.repeat(60)}\n`);
  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  if (failures.length > 0) {
    process.stdout.write('\nFailures:\n');
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  }
  process.stdout.write(`${'='.repeat(60)}\n`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`smoke test crashed: ${err?.stack ?? err}\n`);
  process.exit(2);
});
